require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const multer = require('multer');
const nodemailer = require('nodemailer');

const quota = require('./lib/quota');
const jobs = require('./lib/jobs');

const app = express();
const PORT = process.env.PORT || 3000;
const DRY_RUN = process.env.DRY_RUN === 'true';
const DELAY_MS = 2000;
const MAX_FILE_SIZE = 1024 * 1024;
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- Session secret ----------
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] SESSION_SECRET not set — generated a random one for this process.');
  console.warn('       Sessions will not survive a restart. Set SESSION_SECRET in .env for production.');
}

// ---------- Middleware ----------
app.set('trust proxy', 1);
app.use(express.json());

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false, // 1-hour window starts at connect, doesn't slide
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_MS,
    },
    store: new MemoryStore({
      checkPeriod: 10 * 60 * 1000, // prune expired sessions every 10 min
    }),
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ---------- Multer: memory, .json only, 1MB ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const looksJson =
      file.mimetype === 'application/json' ||
      file.originalname.toLowerCase().endsWith('.json');
    if (!looksJson) return cb(new Error('Only .json files are allowed.'));
    cb(null, true);
  },
});

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeHeader(value) {
  // Prevent CRLF header injection.
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseRecipients(buffer) {
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    return { error: 'File is not valid JSON.' };
  }
  if (!Array.isArray(data)) {
    return { error: 'JSON must be a top-level array of email strings.' };
  }
  if (data.some((v) => typeof v !== 'string')) {
    return { error: 'Every entry in the array must be a string.' };
  }
  return { recipients: data };
}

// Returns { user, pass } or null. Credentials live in the session only.
function getSessionCreds(req) {
  const c = req.session && req.session.gmail;
  if (!c || typeof c.user !== 'string' || typeof c.pass !== 'string') return null;
  if (!c.user || !c.pass) return null;
  return { user: c.user, pass: c.pass };
}

function buildTransporter(creds) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
  });
}

// ---------- Connect / disconnect / status ----------
app.post('/api/connect', (req, res) => {
  const { gmailUser, appPassword } = req.body || {};
  if (typeof gmailUser !== 'string' || !EMAIL_RE.test(gmailUser.trim())) {
    return res.status(400).json({ error: 'Enter a valid Gmail address.' });
  }
  if (typeof appPassword !== 'string' || appPassword.replace(/\s+/g, '').length !== 16) {
    return res.status(400).json({
      error: 'App Password must be 16 characters (spaces are ignored).',
    });
  }

  const user = gmailUser.trim().toLowerCase();
  const pass = appPassword.replace(/\s+/g, '');

  // Optional: verify credentials before storing (skipped in DRY_RUN).
  if (DRY_RUN) {
    req.session.gmail = { user, pass };
    return res.json({ connected: true, email: user, verified: false, dryRun: true });
  }

  const transport = buildTransporter({ user, pass });
  transport.verify((err) => {
    if (err) {
      return res.status(400).json({
        error: 'Gmail rejected these credentials. Check the address and App Password.',
        detail: err.message,
      });
    }
    req.session.gmail = { user, pass };
    return res.json({ connected: true, email: user, verified: true });
  });
});

app.post('/api/disconnect', (req, res) => {
  if (req.session) {
    delete req.session.gmail;
  }
  res.json({ connected: false });
});

app.get('/api/connection', (req, res) => {
  const creds = getSessionCreds(req);
  if (!creds) return res.json({ connected: false });
  res.json({ connected: true, email: creds.user });
});

// ---------- Waitlist ----------
const WAITLIST_PATH = path.join(__dirname, 'data', 'waitlist.json');

function readWaitlist() {
  try {
    const raw = fs.readFileSync(WAITLIST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.warn('[waitlist] unreadable, treating as empty:', err.message);
    return [];
  }
}

function writeWaitlist(entries) {
  fs.mkdirSync(path.dirname(WAITLIST_PATH), { recursive: true });
  fs.writeFileSync(WAITLIST_PATH, JSON.stringify(entries, null, 2));
}

app.post('/api/waitlist', (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const normalized = email.trim().toLowerCase();
  const entries = readWaitlist();
  if (entries.some((e) => e.email === normalized)) {
    // Idempotent: duplicate signup is success, not an error.
    return res.json({ ok: true, already: true });
  }
  entries.push({ email: normalized, at: new Date().toISOString() });
  writeWaitlist(entries);
  return res.json({ ok: true });
});

// ---------- POST /api/send ----------
app.post('/api/send', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    const creds = getSessionCreds(req);
    if (!creds) {
      return res.status(401).json({ error: 'Connect your Gmail account first.' });
    }

    if (uploadErr) {
      const msg =
        uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large. Max size is 1MB.'
          : uploadErr.message || 'Upload failed.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Attach a .json file under field "file".' });
    }
    const { subject, body, fromName } = req.body;
    if (typeof subject !== 'string' || subject.trim() === '') {
      return res.status(400).json({ error: 'Subject is required.' });
    }
    if (typeof body !== 'string' || body.trim() === '') {
      return res.status(400).json({ error: 'Body is required.' });
    }

    const parsed = parseRecipients(req.file.buffer);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.recipients.length === 0) {
      return res.status(400).json({ error: 'The array is empty — nothing to send.' });
    }

    // Validate + dedupe.
    const planned = [];
    const skipped = [];
    const seen = new Set();
    for (const entry of parsed.recipients) {
      const email = entry.trim();
      if (!EMAIL_RE.test(email)) {
        skipped.push({ email, status: 'skipped', reason: 'invalid', error: 'Invalid email format.' });
        continue;
      }
      const key = email.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ email, status: 'skipped', reason: 'duplicate', error: 'Duplicate address.' });
        continue;
      }
      seen.add(key);
      planned.push(email);
    }

    if (planned.length === 0 && skipped.length === 0) {
      return res.status(400).json({ error: 'Nothing to send.' });
    }

    // Quota check (successful sends only).
    const usage = quota.getUsage();
    if (planned.length > usage.remaining) {
      return res.status(429).json({
        error: usage.remaining <= 0
          ? `Quota exceeded: ${usage.limit} emails per 24 hours. Try again later.`
          : `Quota exceeded: only ${usage.remaining} send(s) left in the 24-hour window, but ${planned.length} recipient(s) are queued.`,
      });
    }

    // Create job.
    const job = jobs.createJob();

    const preSkipped = skipped.map((s, i) => ({ ...s, index: i }));

    jobs.emit(job, 'start', {
      total: planned.length + skipped.length,
      planned,
      preSkipped,
      quota: usage,
      sender: creds.user,
    });

    // Kick off background send loop.
    runSendLoop(job, {
      creds,
      planned,
      skippedCount: skipped.length,
      subject,
      body,
      fromName: fromName || '',
    }).catch((err) => {
      console.error('[job error]', err);
      jobs.emit(job, 'error', { error: err.message || 'Job failed.' });
      jobs.finish(job, 'error');
    });

    return res.status(202).json({ jobId: job.id });
  });
});

// ---------- Background send loop ----------
async function runSendLoop(job, { creds, planned, skippedCount, subject, body, fromName }) {
  const fromNameSafe = fromName ? sanitizeHeader(fromName).replace(/"/g, '') : '';
  const fromHeader = fromNameSafe
    ? `"${fromNameSafe}" <${creds.user}>`
    : creds.user;
  const textBody = htmlToText(body);

  let transport = null;
  if (!DRY_RUN) {
    transport = buildTransporter(creds);
  }

  for (let i = 0; i < planned.length; i++) {
    const email = planned[i];
    let result;
    try {
      if (DRY_RUN) {
        await sleep(200);
        result = { email, status: 'sent', messageId: `<dry-run-${Date.now()}-${i}@automailer>` };
      } else {
        const info = await transport.sendMail({
          from: fromHeader,
          to: email,
          subject: sanitizeHeader(subject),
          text: textBody,
          html: body,
        });
        result = { email, status: 'sent', messageId: info.messageId };
      }
      quota.recordSuccess();
    } catch (err) {
      result = { email, status: 'failed', error: err.message || 'Send failed.' };
    }

    jobs.emit(job, 'result', { ...result, index: skippedCount + i });

    if (i < planned.length - 1) {
      await sleep(DRY_RUN ? 200 : DELAY_MS);
    }
  }

  const finalQuota = quota.getUsage();
  jobs.emit(job, 'done', { quota: finalQuota });
  jobs.finish(job, 'done');
}

// ---------- SSE: GET /api/send/:jobId/events ----------
app.get('/api/send/:jobId/events', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired.' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);

  const unsubscribe = jobs.subscribe(job, (evt) => {
    try {
      res.write(`event: ${evt.type}\n`);
      res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
    } catch {}
    if (evt.type === 'done' || evt.type === 'error') {
      cleanup();
    }
  });

  function cleanup() {
    clearInterval(heartbeat);
    unsubscribe();
    try { res.end(); } catch {}
  }

  req.on('close', cleanup);
});

// ---------- Quota + health ----------
app.get('/api/quota', (req, res) => {
  res.json(quota.getUsage());
});

app.get('/api/health', (req, res) => {
  const creds = getSessionCreds(req);
  res.json({
    ok: true,
    dryRun: DRY_RUN,
    connected: Boolean(creds),
    quota: quota.getUsage(),
  });
});

// ---------- Error fallback ----------
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`AutoMailer running at http://localhost:${PORT}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no emails will be sent)' : 'LIVE (SMTP enabled)'}`);
});