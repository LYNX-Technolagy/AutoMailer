(() => {
  const backdrop = document.getElementById('launch-backdrop');
  const modal = document.getElementById('launch-modal');
  const goBtn = document.getElementById('launch-go');
  const stayBtn = document.getElementById('launch-stay');
  if (!backdrop || !modal || !goBtn || !stayBtn) return;

  const DISMISS_KEY = 'automailer:launch-dismissed';

  // Show only on localhost/127.0.0.1, and only once per session.
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) return;

  try {
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
  } catch {
    // sessionStorage blocked (private mode edge cases) — don't show.
    return;
  }

  // Don't show if the user is already on /app (defensive; index.html is /).
  if (window.location.pathname.startsWith('/app')) return;

  // Show after a short delay so the page paints first.
  setTimeout(() => {
    backdrop.hidden = false;
    requestAnimationFrame(() => goBtn.focus());
  }, 400);

  function dismiss() {
    backdrop.hidden = true;
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch {}
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }
  document.addEventListener('keydown', onKey);

  stayBtn.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
})();