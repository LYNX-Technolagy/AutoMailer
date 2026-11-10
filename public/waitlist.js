(() => {
  const form = document.getElementById('waitlist-form');
  const input = document.getElementById('waitlist-email');
  const status = document.getElementById('waitlist-status');
  const btn = document.getElementById('waitlist-btn');
  if (!form || !input || !status || !btn) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setStatus(msg, tone) {
    status.textContent = msg;
    status.className = 'waitlist-form__status' + (tone ? ` waitlist-form__status--${tone}` : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      setStatus('Enter a valid email address.', 'error');
      input.focus();
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    setStatus('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      let data = null;
      try { data = await res.json(); } catch {}

      if (!res.ok) {
        setStatus((data && data.error) || 'Something went wrong. Try again.', 'error');
        return;
      }

      input.value = '';
      setStatus("You're on the list. We'll be in touch.", 'success');
    } catch {
      setStatus('Network error. Try again in a moment.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();