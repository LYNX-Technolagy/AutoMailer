const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('AutoMailer exited before becoming ready.');
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for AutoMailer to start.');
}

test('dry-run campaign completes without creating or consuming real send quota', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automailer-dry-run-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DRY_RUN: 'true',
      SESSION_SECRET: 'test-session-secret-with-sufficient-entropy',
      AUTOMAILER_DATA_DIR: directory,
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 2000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child);

  const connect = await fetch(`${baseUrl}/api/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gmailUser: 'dry-run@example.com',
      appPassword: 'abcd efgh ijkl mnop',
    }),
  });
  assert.equal(connect.status, 200);
  const cookie = connect.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'session cookie should be returned');

  const form = new FormData();
  form.append('subject', 'AutoMailer dry-run test');
  form.append('body', '<p>Test only</p>');
  form.append('file', new Blob([JSON.stringify(['one@example.com', 'two@example.com'])], {
    type: 'application/json',
  }), 'recipients.json');

  const send = await fetch(`${baseUrl}/api/send`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(send.status, 202);
  const { jobId } = await send.json();
  assert.ok(jobId);

  // Wait until the short simulated campaign is complete to exercise terminal-event replay.
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const events = await fetch(`${baseUrl}/api/send/${jobId}/events`, {
    headers: { Cookie: cookie },
  });
  assert.equal(events.status, 200);
  const body = await events.text();
  assert.match(body, /event: done/);

  const quota = await fetch(`${baseUrl}/api/quota`);
  const usage = await quota.json();
  assert.equal(usage.used, 0);
  assert.equal(usage.reserved, 0);
  assert.equal(usage.remaining, 50);
  assert.equal(fs.existsSync(path.join(directory, 'sendlog.json')), false);
});
