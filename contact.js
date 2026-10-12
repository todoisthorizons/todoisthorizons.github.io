(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;

  // Mirrors the extension's Web3Forms hardening (src/core/api/web3forms-client.ts,
  // src/core/security/rate-limiter.ts, entrypoints/support/SupportApp.tsx).
  const ENDPOINT = 'https://api.web3forms.com/submit';
  const ACCESS_KEY = 'f91a7e7a-2f77-4b8a-9de7-323b3e25a975';
  const TIMEOUT_MS = 15000;
  const COOLDOWN_SECONDS = 60;
  const MAX_PER_HOUR = 5;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const STORAGE_KEY = 'rate_limit_timestamps_contact';
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const LIMITS = { name: 100, email: 100, message: 3000 };
  const MIN_MESSAGE_LENGTH = 10;
  const TOPICS = ['Question', 'Bug report', 'Feature idea', 'Other'];

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.contact-status');

  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state || '';
  };

  const readTimestamps = () => {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.filter(item => typeof item === 'number') : [];
    } catch {
      return [];
    }
  };

  const checkRateLimit = (now) => {
    const recent = readTimestamps().filter(ts => ts > now - ONE_HOUR_MS);
    const last = recent[recent.length - 1];
    if (last !== undefined) {
      const elapsed = Math.floor((now - last) / 1000);
      if (elapsed < COOLDOWN_SECONDS) {
        return `Please wait ${COOLDOWN_SECONDS - elapsed} seconds before sending another message.`;
      }
    }
    if (recent.length >= MAX_PER_HOUR) {
      return 'You have reached the message limit for this hour. Please try again later.';
    }
    return null;
  };

  const recordSubmission = (now) => {
    const recent = readTimestamps().filter(ts => ts > now - ONE_HOUR_MS);
    recent.push(now);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    } catch {
      // Storage unavailable (e.g. private mode); the server-side limits still apply.
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const name = form.elements.name.value.trim().slice(0, LIMITS.name);
    const email = form.elements.email.value.trim().slice(0, LIMITS.email);
    const message = form.elements.message.value.trim().slice(0, LIMITS.message);
    const topic = TOPICS.includes(form.elements.topic.value) ? form.elements.topic.value : 'Other';
    const botcheck = form.elements.botcheck.value;

    // Honeypot: pretend success for bots without spending API quota.
    if (botcheck.trim() !== '') {
      form.reset();
      setStatus('Thanks! Your message has been sent. We\u2019ll get back to you soon.', 'success');
      return;
    }

    if (!email || !message) return;
    if (!EMAIL_REGEX.test(email)) {
      setStatus('Please enter a valid email address.', 'error');
      return;
    }
    if (message.length < MIN_MESSAGE_LENGTH) {
      setStatus(`Please enter at least ${MIN_MESSAGE_LENGTH} characters.`, 'error');
      return;
    }

    const now = Date.now();
    const limitMessage = checkRateLimit(now);
    if (limitMessage) {
      setStatus(limitMessage, 'error');
      return;
    }

    // Build the payload from an explicit whitelist instead of serialising the DOM form.
    const payload = new FormData();
    payload.append('access_key', ACCESS_KEY);
    payload.append('botcheck', '');
    payload.append('subject', `[Horizons Website] ${topic}`);
    payload.append('from_name', 'Horizons Website');
    if (name) payload.append('name', name);
    payload.append('email', email);
    payload.append('topic', topic);
    payload.append('message', message);

    const originalLabel = submitButton.textContent;
    submitButton.textContent = 'Sending\u2026';
    submitButton.disabled = true;
    setStatus('', '');

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: payload,
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'strict-origin'
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        recordSubmission(now);
        form.reset();
        setStatus('Thanks! Your message has been sent. We\u2019ll get back to you soon.', 'success');
        document.dispatchEvent(new CustomEvent('horizons:form-sent', { detail: 'contact' }));
      } else {
        setStatus('Your message couldn\u2019t be sent. Please try again later.', 'error');
      }
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      setStatus(timedOut
        ? 'Request timed out. Please check your connection and try again.'
        : 'Something went wrong. Check your connection and try again.', 'error');
    } finally {
      window.clearTimeout(timer);
      submitButton.textContent = originalLabel;
      submitButton.disabled = false;
    }
  });
})();
