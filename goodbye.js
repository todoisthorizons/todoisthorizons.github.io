(() => {
  const form = document.getElementById('goodbye-form');
  if (!form) return;

  // Same hardening as contact.js; the extension opens this page via chrome.runtime.setUninstallURL.
  const ENDPOINT = 'https://api.web3forms.com/submit';
  const ACCESS_KEY = '0c10ac19-3ae4-4728-b9e1-c7d0590e8fdd';
  const TIMEOUT_MS = 15000;
  const COOLDOWN_SECONDS = 60;
  const MAX_PER_HOUR = 5;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const STORAGE_KEY = 'rate_limit_timestamps_goodbye';
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const LIMITS = { email: 100, message: 3000 };
  const REASONS = {
    'didnt-understand': 'I didn\u2019t understand how to use it',
    workflow: 'It didn\u2019t fit my workflow',
    'missing-feature': 'A feature I need is missing',
    broken: 'Something didn\u2019t work',
    'stopped-todoist': 'I stopped using Todoist',
    trying: 'I was just trying it out',
    other: 'Something else'
  };

  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.contact-status');
  const thanks = document.getElementById('goodbye-thanks');
  const otherCheckbox = document.getElementById('reason-other');
  const otherField = document.getElementById('message-field');

  // Context appended by the extension; anything that doesn't match a strict format is dropped.
  const params = new URLSearchParams(window.location.search);
  const rawVersion = params.get('v') || '';
  const rawDays = params.get('days') || '';
  const context = {
    version: /^\d{1,4}(\.\d{1,4}){0,3}$/.test(rawVersion) ? rawVersion : '',
    days: /^\d{1,5}$/.test(rawDays) ? String(Math.min(Number(rawDays), 36500)) : '',
    language: /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(navigator.language || '') ? navigator.language : ''
  };

  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state || '';
  };

  const getSelectedReasonKeys = () => {
    // 1. Checkbox NodeList / elements in standard DOM
    if (typeof form.querySelectorAll === 'function') {
      const checkedBoxes = Array.from(form.querySelectorAll('input[name="reason"]:checked'));
      if (checkedBoxes.length > 0) {
        return checkedBoxes
          .map(cb => cb.value)
          .filter(val => Object.prototype.hasOwnProperty.call(REASONS, val));
      }
    }

    // 2. Fallback for mocks / synthetic environments (e.g. tests where elements.reason is provided)
    const reasonEl = form.elements && form.elements.reason;
    if (reasonEl) {
      if (typeof reasonEl.value === 'string' && Object.prototype.hasOwnProperty.call(REASONS, reasonEl.value)) {
        return [reasonEl.value];
      }
      if (typeof reasonEl.length === 'number') {
        const keys = [];
        for (let i = 0; i < reasonEl.length; i++) {
          const item = reasonEl[i];
          if (item && item.checked && Object.prototype.hasOwnProperty.call(REASONS, item.value)) {
            keys.push(item.value);
          }
        }
        if (keys.length > 0) return keys;
      }
    }

    return [];
  };

  const isOtherSelected = () => {
    return getSelectedReasonKeys().includes('other');
  };

  const syncOtherField = (shouldFocus = false) => {
    if (!otherField || otherField === thanks) return;
    const active = isOtherSelected();
    otherField.hidden = !active;
    if (otherCheckbox && otherCheckbox !== thanks) {
      otherCheckbox.setAttribute('aria-expanded', String(active));
    }
    if (active && shouldFocus) {
      const textarea = otherField.querySelector('textarea');
      if (textarea) textarea.focus();
    }
  };

  // Initial state: hide the field unless already selected (e.g. back navigation)
  syncOtherField(false);

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
        return `Please wait ${COOLDOWN_SECONDS - elapsed} seconds before sending again.`;
      }
    }
    if (recent.length >= MAX_PER_HOUR) {
      return 'You have reached the limit for this hour. Please try again later.';
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

  const showThanks = () => {
    form.reset();
    syncOtherField(false);
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus({ preventScroll: true });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const selectedKeys = getSelectedReasonKeys();
    const otherActive = selectedKeys.includes('other');
    const message = (form.elements.message && form.elements.message.value ? form.elements.message.value : '')
      .trim()
      .slice(0, LIMITS.message);
    const email = (form.elements.email && form.elements.email.value ? form.elements.email.value : '')
      .trim()
      .slice(0, LIMITS.email);
    const botcheck = form.elements.botcheck ? form.elements.botcheck.value : '';

    // Honeypot: pretend success for bots without spending API quota.
    if (botcheck.trim() !== '') {
      showThanks();
      return;
    }

    if (selectedKeys.length === 0) {
      setStatus('Please choose at least one reason.', 'error');
      const firstInput = form.querySelector ? form.querySelector('input[name="reason"]') : null;
      if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
      return;
    }
    if (email && !EMAIL_REGEX.test(email)) {
      setStatus('Please enter a valid email address, or leave it empty.', 'error');
      return;
    }

    const now = Date.now();
    const limitMessage = checkRateLimit(now);
    if (limitMessage) {
      setStatus(limitMessage, 'error');
      return;
    }

    // Build the payload from an explicit whitelist instead of serialising the DOM form.
    const selectedLabels = selectedKeys.map(k => REASONS[k]);
    const reasonsFormatted = selectedLabels.join(', ');
    const payload = new FormData();
    payload.append('access_key', ACCESS_KEY);
    payload.append('botcheck', '');
    payload.append('subject', `[Horizons Uninstall] ${reasonsFormatted}`);
    payload.append('from_name', 'Horizons Uninstall Survey');
    payload.append('reason', reasonsFormatted);
    payload.append('message', (otherActive && message) ? message : (message || '(no comment)'));
    if (email) payload.append('email', email);
    if (context.version) payload.append('extension_version', context.version);
    if (context.days) payload.append('days_installed', context.days);
    if (context.language) payload.append('browser_language', context.language);

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
        showThanks();
        document.dispatchEvent(new CustomEvent('horizons:form-sent', { detail: 'goodbye' }));
      } else {
        setStatus('Your feedback couldn\u2019t be sent. Please try again later.', 'error');
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

  form.addEventListener('change', (event) => {
    if (event.target && event.target.name === 'reason') {
      const keys = getSelectedReasonKeys();
      if (keys.length > 0 && status.dataset.state === 'error') {
        setStatus('', '');
      }
      const justToggledOther = event.target.value === 'other';
      syncOtherField(justToggledOther && event.target.checked);
    }
  });

  form.addEventListener('reset', () => {
    setTimeout(() => syncOtherField(false), 0);
  });
})();
