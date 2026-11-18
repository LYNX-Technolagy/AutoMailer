(() => {
  const chip = document.getElementById('account-chip');
  const chipLabel = document.getElementById('account-chip-label');
  const chipDot = chip ? chip.querySelector('.account-chip__dot') : null;

  const backdrop = document.getElementById('settings-backdrop');
  const modal = document.getElementById('settings-modal');
  const modalSub = document.getElementById('settings-sub');
  const modalHelp = document.getElementById('settings-help');
  const modalClose = document.getElementById('settings-close');

  const connectForm = document.getElementById('connect-form');
  const connectBtn = document.getElementById('connect-btn');
  const connectError = document.getElementById('connect-error');
  const gmailUserInput = document.getElementById('gmail-user');
  const appPasswordInput = document.getElementById('app-password');
  const disconnectBtn = document.getElementById('disconnect-btn');

  const form = document.getElementById('send-form');
  const formSub = document.getElementById('form-sub');
  const fileInput = document.getElementById('file');
  const dropzone = document.getElementById('dropzone');
  const dropzoneInner = dropzone?.querySelector('.dropzone__inner');
  const subjectInput = document.getElementById('subject');
  const bodyInput = document.getElementById('body');
  const fromNameInput = document.getElementById('from-name');
  const sendBtn = document.getElementById('send-btn');
  const results = document.getElementById('results');
  const quotaNote = document.querySelector('.form__note');
  const demoBanner = document.getElementById('demo-banner');

  if (!chip || !backdrop || !modal || !form || !sendBtn || !results) return;

  const DEFAULT_DROPZONE_HTML = dropzoneInner ? dropzoneInner.innerHTML : '';
  const DEFAULT_SUB = 'AutoMailer sends email through your own Gmail account. Your App Password is stored in server memory for this session only, and is cleared after 1 hour of inactivity.';

  let currentEventSource = null;
  let connected = false;
  let connectedEmail = '';
  let lastFocusedBeforeModal = null;
  let helpAutoOpened = false;
  let demoMode = false;

  // ---------- Demo mode ----------
  function enterDemoMode() {
    demoMode = true;
    connected = false;
    if (demoBanner) demoBanner.hidden = false;
    if (chip) chip.hidden = true;           // hide the connect chip
    if (modalHelp) modalHelp.hidden = true; // irrelevant in demo
    if (formSub) formSub.textContent = 'Demo mode — sending is simulated.';
    if (quotaNote) quotaNote.textContent = 'Simulation only — no emails are sent.';
    sendBtn.disabled = false;               // allow the simulated send
  }

  async function checkBackend() {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const data = await r.json();
      if (!data || data.ok !== true) throw new Error('bad health response');
      // Real backend present — normal flow
      if (data.connected) {
        // session may still be alive on reload
        const c = await fetch('/api/connection').then((x) => x.ok ? x.json() : null);
        if (c && c.connected) setConnected(true, c.email);
      }
      refreshQuota();
    } catch {
      enterDemoMode();
    }
  }

  // ---------- Connection state ----------
  function setConnected(isConnected, email) {
    if (demoMode) return; // never in demo
    connected = isConnected;
    connectedEmail = email || '';

    if (isConnected) {
      chipDot?.setAttribute('data-state', 'connected');
      chipLabel.textContent = connectedEmail || 'Connected';
      chip.setAttribute('aria-label', `Gmail connection settings — connected as ${connectedEmail}`);
      sendBtn.disabled = false;
      if (formSub) formSub.textContent = `Sending individually as ${connectedEmail}.`;
      disconnectBtn.hidden = false;
      connectBtn.textContent = 'Switch account';
      modalSub.textContent = `Connected as ${connectedEmail}. Disconnect below to clear your credentials, or enter a different account to switch.`;
      if (modalHelp) modalHelp.hidden = true;
      gmailUserInput.value = connectedEmail;
      appPasswordInput.value = '';
    } else {
      chipDot?.setAttribute('data-state', 'disconnected');
      chipLabel.textContent = 'Connect Gmail';
      chip.setAttribute('aria-label', 'Connect Gmail');
      sendBtn.disabled = true;
      if (formSub) formSub.textContent = 'One email per recipient. No CC, no BCC.';
      disconnectBtn.hidden = true;
      connectBtn.textContent = 'Connect Gmail';
      modalSub.textContent = DEFAULT_SUB;
      if (modalHelp) modalHelp.hidden = false;
    }
  }

  // ---------- Quota ----------
  async function refreshQuota() {
    if (demoMode) return;
    try {
      const r = await fetch('/api/quota');
      if (!r.ok) return;
      const q = await r.json();
      if (quotaNote && typeof q.remaining === 'number') {
        quotaNote.textContent = `${q.remaining} of ${q.limit} remaining in the 24-hour window.`;
      }
    } catch {}
  }

  // ---------- Modal ----------
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  function openModal(opts = {}) {
    if (demoMode) return;
    if (!backdrop.hidden) return;
    lastFocusedBeforeModal = document.activeElement;
    backdrop.hidden = false;
    modal.hidden = false;
    chip.setAttribute('aria-expanded', 'true');

    clearConnectError();
    if (opts.reason === 'expired') {
      showConnectError('Your session expired. Reconnect your Gmail account to continue.');
    }

    if (!connected && !helpAutoOpened && modalHelp) {
      modalHelp.open = true;
      helpAutoOpened = true;
    }

    requestAnimationFrame(() => gmailUserInput?.focus());
    document.addEventListener('keydown', onModalKeydown);
  }

  function closeModal() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    modal.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onModalKeydown);
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const nodes = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
      (el) => !el.hidden && el.offsetParent !== null
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  chip.addEventListener('click', () => openModal());
  modalClose.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

  // ---------- Connect / disconnect ----------
  function showConnectError(message) {
    connectError.textContent = message;
    connectError.hidden = false;
  }
  function clearConnectError() {
    connectError.textContent = '';
    connectError.hidden = true;
  }

  connectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (demoMode) return;
    clearConnectError();

    const gmailUser = gmailUserInput.value.trim();
    const appPassword = appPasswordInput.value.trim();
    if (!gmailUser) return showConnectError('Enter your Gmail address.');
    if (!appPassword) return showConnectError('Enter your App Password.');

    connectBtn.disabled = true;
    const originalText = connectBtn.textContent;
    connectBtn.textContent = 'Connecting…';

    try {
      const r = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmailUser, appPassword }),
      });
      let data = null;
      try { data = await r.json(); } catch {}

      if (!r.ok) {
        showConnectError((data && data.error) || `Connection failed (HTTP ${r.status}).`);
        return;
      }
      appPasswordInput.value = '';
      setConnected(true, data.email);
      closeModal();
    } catch {
      showConnectError('Network error. Is the server running?');
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = originalText;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (demoMode) return;
    try { await fetch('/api/disconnect', { method: 'POST' }); } catch {}
    setConnected(false);
    appPasswordInput.value = '';
    gmailUserInput.value = '';
  });

  // ---------- File selection ----------
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function showSelectedFile(file) {
    if (!dropzoneInner) return;
    dropzoneInner.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'dropzone__text dropzone__text--selected';
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.className = 'dropzone__meta';
    meta.textContent = formatBytes(file.size) + ' · click to replace';
    dropzoneInner.append(name, meta);
  }
  function resetDropzoneVisual() {
    if (dropzoneInner) dropzoneInner.innerHTML = DEFAULT_DROPZONE_HTML;
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) showSelectedFile(f);
    else resetDropzoneVisual();
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dropzone--active');
    })
  );
  ['dragleave', 'dragend', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, () => dropzone.classList.remove('dropzone--active'))
  );
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.json')) {
      showBanner('Only .json files are allowed.', 'error');
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.files = dt.files;
    showSelectedFile(f);
  });

  // ---------- Validation ----------
  async function readJsonArray(file) {
    const text = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Could not read the file.'));
      r.readAsText(file);
    });
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
    if (!Array.isArray(data)) throw new Error('JSON must be a top-level array of email strings.');
    if (data.some((v) => typeof v !== 'string')) throw new Error('Every entry in the array must be a string.');
    return data;
  }

  // ---------- Results ----------
  function clearResults() { results.innerHTML = ''; }
  function showBanner(message, tone) {
    const existing = results.querySelector('.banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'banner banner--' + (tone || 'info');
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.textContent = message;
    results.prepend(el);
  }
  function renderEmpty(title, sub) {
    clearResults();
    const wrap = document.createElement('div');
    wrap.className = 'results__empty';
    const t = document.createElement('p');
    t.className = 'results__empty-title';
    t.textContent = title || 'No sends yet';
    wrap.appendChild(t);
    if (sub) {
      const s = document.createElement('p');
      s.className = 'results__empty-sub';
      s.textContent = sub;
      wrap.appendChild(s);
    }
    results.appendChild(wrap);
  }

  let rowByIndex = new Map();
  let summaryState = { total: 0, sent: 0, failed: 0, skipped: 0 };

  function updateSummaryBar() {
    let bar = results.querySelector('[data-summary]');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'results__summary';
      bar.dataset.summary = '1';
      results.appendChild(bar);
    }
    bar.innerHTML =
      `<span class="results__count"><strong>${summaryState.sent}</strong> sent</span>` +
      `<span class="results__sep">·</span>` +
      `<span class="results__count"><strong>${summaryState.failed}</strong> failed</span>` +
      `<span class="results__sep">·</span>` +
      `<span class="results__count"><strong>${summaryState.skipped}</strong> skipped</span>`;
  }

  function makeRow(email, status) {
    const li = document.createElement('li');
    li.className = 'result result--' + status;
    const dot = document.createElement('span');
    dot.className = 'result__dot';
    dot.setAttribute('aria-hidden', 'true');
    const em = document.createElement('span');
    em.className = 'result__email';
    em.textContent = email || '(unknown)';
    const label = document.createElement('span');
    label.className = 'result__label';
    label.textContent = status === 'pending' ? 'queued' : status;
    li.append(dot, em, label);
    return li;
  }
  function addError(li, msg) {
    if (li.querySelector('.result__error')) return;
    const err = document.createElement('span');
    err.className = 'result__error';
    err.textContent = msg;
    li.appendChild(err);
  }

  function renderPlannedRows(plannedEmails, preSkipped) {
    rowByIndex = new Map();
    summaryState = { total: plannedEmails.length + preSkipped.length, sent: 0, failed: 0, skipped: 0 };
    clearResults();
    updateSummaryBar();
    const list = document.createElement('ul');
    list.className = 'results__list';

    preSkipped.forEach((s, i) => {
      const li = makeRow(s.email, 'skipped');
      li.dataset.index = String(i);
      li.dataset.status = 'skipped';
      if (s.error) addError(li, s.error);
      rowByIndex.set(i, li);
      summaryState.skipped += 1;
      list.appendChild(li);
    });

    plannedEmails.forEach((email, i) => {
      const idx = preSkipped.length + i;
      const li = makeRow(email, 'pending');
      li.dataset.index = String(idx);
      rowByIndex.set(idx, li);
      list.appendChild(li);
    });

    results.appendChild(list);
    updateSummaryBar();
  }

  function applyResult(evt) {
    const li = rowByIndex.get(evt.index);
    if (!li) return;
    li.classList.remove('result--pending', 'result--sent', 'result--failed', 'result--skipped');
    li.classList.add('result--' + evt.status);
    const label = li.querySelector('.result__label');
    if (label) label.textContent = evt.status;
    if (evt.error) addError(li, evt.error);
    const prev = li.dataset.status;
    if (prev && summaryState[prev] != null) summaryState[prev] -= 1;
    if (summaryState[evt.status] != null) summaryState[evt.status] += 1;
    li.dataset.status = evt.status;
    updateSummaryBar();
  }

  // ---------- Loading ----------
  function setLoading(loading) {
    if (loading) {
      sendBtn.disabled = true;
      sendBtn.classList.add('btn--loading');
      sendBtn.dataset.label = sendBtn.textContent;
      sendBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Sending…';
      results.setAttribute('aria-busy', 'true');
    } else {
      sendBtn.disabled = demoMode ? false : !connected;
      sendBtn.classList.remove('btn--loading');
      sendBtn.textContent = sendBtn.dataset.label || 'Send emails';
      results.removeAttribute('aria-busy');
    }
  }

  function closeEventSource() {
    if (currentEventSource) {
      try { currentEventSource.close(); } catch {}
      currentEventSource = null;
    }
  }

  // ---------- Simulated send (demo mode) ----------
  function simulateSend(plannedEmails, preSkipped) {
    renderPlannedRows(plannedEmails, preSkipped);
    let i = 0;
    const total = plannedEmails.length;

    function tick() {
      if (i >= total) {
        setLoading(false);
        return;
      }
      const email = plannedEmails[i];
      // Mostly sent, with occasional failures for realism.
      const roll = Math.random();
      let status = 'sent';
      let error;
      if (roll > 0.92) {
        status = 'failed';
        error = 'Mailbox unavailable (simulated)';
      }
      applyResult({ email, status, error, index: preSkipped.length + i });
      i++;
      setTimeout(tick, 800);
    }

    // Small delay before the first tick so the "queued" state is visible.
    setTimeout(tick, 600);
  }

  // ---------- Submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    closeEventSource();

    if (!demoMode && !connected) {
      openModal();
      return showBanner('Connect your Gmail account first.', 'error');
    }

    const file = fileInput.files && fileInput.files[0];
    if (!file) return showBanner('Choose a .json file first.', 'error');
    if (!subjectInput.value.trim()) return showBanner('Subject is required.', 'error');
    if (!bodyInput.value.trim()) return showBanner('Body is required.', 'error');

    let allEmails;
    try { allEmails = await readJsonArray(file); }
    catch (err) { return showBanner(err.message, 'error'); }

    // Build planned + skipped client-side (used by both real and demo flows
    // for the pre-skipped rows; the server re-derives for the real flow).
    const seen = new Set();
    const planned = [];
    const preSkipped = [];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    for (const raw of allEmails) {
      const email = raw.trim();
      if (!EMAIL_RE.test(email)) {
        preSkipped.push({ email, status: 'skipped', reason: 'invalid', error: 'Invalid email format.' });
        continue;
      }
      const k = email.toLowerCase();
      if (seen.has(k)) {
        preSkipped.push({ email, status: 'skipped', reason: 'duplicate', error: 'Duplicate address.' });
        continue;
      }
      seen.add(k);
      planned.push(email);
    }

    if (planned.length === 0 && preSkipped.length === 0) {
      return showBanner('The file has no usable entries.', 'error');
    }

    setLoading(true);

    if (demoMode) {
      simulateSend(planned, preSkipped);
      return;
    }

    // ---- Real backend flow ----
    renderEmpty('Preparing…', 'Validating and queuing recipients.');

    let jobId;
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('subject', subjectInput.value);
      fd.append('body', bodyInput.value);
      if (fromNameInput && fromNameInput.value.trim()) fd.append('fromName', fromNameInput.value.trim());

      const res = await fetch('/api/send', { method: 'POST', body: fd });
      let data = null;
      try { data = await res.json(); } catch {}

      if (res.status === 401) {
        setConnected(false);
        setLoading(false);
        openModal({ reason: 'expired' });
        return showBanner('Your session expired. Reconnect to continue.', 'error');
      }
      if (!res.ok) {
        setLoading(false);
        return showBanner((data && data.error) || `Request failed (HTTP ${res.status}).`, 'error');
      }
      if (!data || !data.jobId) {
        setLoading(false);
        return showBanner('Unexpected server response (no jobId).', 'error');
      }
      jobId = data.jobId;
    } catch {
      setLoading(false);
      return showBanner('Network error. Is the server running?', 'error');
    }

    const es = new EventSource(`/api/send/${encodeURIComponent(jobId)}/events`);
    currentEventSource = es;
    let doneSeen = false;

    es.addEventListener('start', (msg) => {
      const d = JSON.parse(msg.data);
      renderPlannedRows(d.planned || [], d.preSkipped || []);
      refreshQuota();
    });
    es.addEventListener('result', (msg) => applyResult(JSON.parse(msg.data)));
    es.addEventListener('done', () => {
      doneSeen = true;
      setLoading(false);
      refreshQuota();
      es.close();
      currentEventSource = null;
    });
    es.addEventListener('error', (msg) => {
      let text = 'Job failed.';
      try { text = JSON.parse(msg.data).error || text; } catch {}
      showBanner(text, 'error');
      setLoading(false);
      es.close();
      currentEventSource = null;
    });
    es.onerror = () => {
      if (doneSeen) return;
      if (es.readyState === EventSource.CLOSED) {
        showBanner('Connection lost. The send may still be running on the server.', 'error');
        setLoading(false);
        currentEventSource = null;
      }
    };
  });

  // ---------- Boot ----------
  checkBackend();
})();