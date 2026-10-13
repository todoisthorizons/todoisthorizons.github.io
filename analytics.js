(() => {
  const production = location.protocol === 'https:' && location.hostname === 'todoisthorizons.github.io';
  const testing = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) &&
    window.HORIZONS_ANALYTICS_TEST === true;
  if (!production && !testing) return;

  // This is the public ingestion token, not a personal/admin API key.
  const PROJECT_TOKEN = 'phc_B3MfMngFu3w6DruyqCeabvLA7795G3mTdKvrHVeHTVLG';
  const pending = [];
  let client;

  const cleanUrl = value => typeof value === 'string' ? value.split(/[?#]/, 1)[0] : value;
  const sanitize = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === '$snapshot_data') continue;
      if (typeof item === 'string' && /url|href|referrer|pathname/i.test(key)) {
        value[key] = cleanUrl(item);
      } else if (item && typeof item === 'object') {
        sanitize(item);
      }
    }
  };

  const capture = (name, properties = {}) => {
    if (!client) {
      if (pending.length < 20) pending.push([name, properties]);
      else console.warn('[Horizons] Analytics queue is full; event was not captured.');
      return;
    }
    try {
      client.capture(name, properties);
    } catch (error) {
      console.warn('[Horizons] Analytics capture failed.', error);
    }
  };

  document.addEventListener('horizons:form-sent', event => {
    if (event.detail === 'contact') capture('website_contact_message_sent');
    if (event.detail === 'goodbye') capture('website_uninstall_feedback_sent');
  });
  document.addEventListener('horizons:analytics', event => {
    if (!event.detail || typeof event.detail !== 'object') return;
    const { name, properties } = event.detail;
    if (typeof name === 'string' && name.startsWith('website_')) {
      capture(name, properties || {});
    }
  });

  // Track theme toggle interactions
  document.addEventListener('click', event => {
    const target = event.target;
    const btn = target && typeof target.closest === 'function' ? target.closest('#themeToggle') : null;
    if (!btn) return;
    const docElem = document.documentElement;
    const current = (docElem && typeof docElem.getAttribute === 'function' ? docElem.getAttribute('data-theme') : null) || 'light';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    capture('website_theme_toggled', { theme: nextTheme });
  }, true);

  // Track FAQ accordion toggles
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (details && typeof details.matches === 'function' && details.matches('.faq-item') && details.open) {
      const summary = typeof details.querySelector === 'function' ? details.querySelector('summary') : null;
      const question = summary && summary.textContent ? summary.textContent.trim() : 'unknown';
      capture('website_faq_expanded', { question });
    }
  }, true);

  // Track scroll depth milestones (25%, 50%, 75%, 90%)
  (() => {
    const thresholds = [25, 50, 75, 90];
    const reached = new Set();
    const checkScroll = () => {
      const doc = document.documentElement;
      const totalHeight = (doc.scrollHeight || 0) - (window.innerHeight || 0);
      if (totalHeight <= 0) return;
      const scrollPos = window.scrollY || window.pageYOffset || doc.scrollTop || 0;
      const percent = Math.min(100, Math.round((scrollPos / totalHeight) * 100));
      for (const t of thresholds) {
        if (percent >= t && !reached.has(t)) {
          reached.add(t);
          capture('website_scroll_depth_reached', { depth_percent: t });
        }
      }
    };
    window.addEventListener('scroll', checkScroll, { passive: true });
    // Also check on load or hash jump
    if (document.readyState === 'complete') checkScroll();
    else window.addEventListener('load', checkScroll, { once: true });
  })();

  document.addEventListener('click', event => {
    const target = event.target;
    const link = target && typeof target.closest === 'function' ? target.closest('a') : null;
    if (!link || !link.href || !link.href.startsWith('https://chromewebstore.google.com/')) return;
    const placement = link.closest('.site-header') ? 'header'
      : link.closest('.hero') ? 'hero'
      : link.closest('.cta-zoom') ? 'closing_cta'
      : link.closest('.goodbye-reinstall') ? 'reinstall' : 'other';
    capture('website_install_button_clicked', {
      placement,
      install_listing_available: new URL(link.href).pathname !== '/',
    });
  });

  const script = document.createElement('script');
  script.src = 'https://eu-assets.i.posthog.com/static/array.js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onerror = () => {
    pending.length = 0;
    console.warn('[Horizons] Analytics SDK could not load; website functionality is unaffected.');
  };
  script.onload = () => {
    if (!window.posthog || typeof window.posthog.init !== 'function') {
      console.warn('[Horizons] Analytics SDK loaded without a usable client.');
      return;
    }
    try {
      window.posthog.init(PROJECT_TOKEN, {
        api_host: 'https://eu.i.posthog.com',
        asset_host: 'https://eu-assets.i.posthog.com',
        defaults: '2026-05-30',
        autocapture: {
          css_selector_ignorelist: ['input', 'textarea', 'select', '[contenteditable="true"]'],
        },
        capture_pageview: true,
        capture_pageleave: true,
        disable_session_recording: false,
        disable_surveys: true,
        persistence: 'localStorage',
        person_profiles: 'identified_only',
        ip: false,
        enable_recording_console_log: false,
        session_recording: {
          maskAllInputs: true,
          blockSelector: 'input[type="hidden"], input[type="file"]',
          recordBody: false,
          recordHeaders: false,
          maskAttributeFn: (name, value, element) => {
            if (name === 'value' && element?.matches('input, textarea, select')) return '';
            return name === 'href' ? cleanUrl(value) : value;
          },
          maskCapturedNetworkRequestFn: request => {
            if (request.name) request.name = cleanUrl(request.name);
            return request;
          },
        },
        before_send: event => {
          if (!event) return null;
          sanitize(event.properties);
          sanitize(event.$set);
          sanitize(event.$set_once);
          if (event.properties.$heatmap_data) {
            const heatmap = {};
            for (const [url, points] of Object.entries(event.properties.$heatmap_data)) {
              const clean = cleanUrl(url);
              heatmap[clean] = [...(heatmap[clean] || []), ...points];
            }
            event.properties.$heatmap_data = heatmap;
          }
          // Replay navigation metadata is not a DOM resource URL.
          if (Array.isArray(event.properties.$snapshot_data)) {
            for (const snapshot of event.properties.$snapshot_data) {
              if (snapshot.type === 4 && snapshot.data?.href) {
                snapshot.data.href = cleanUrl(snapshot.data.href);
              }
            }
          }
          event.properties.app_surface = 'website';
          event.properties.analytics_environment = testing ? 'test' : 'production';
          return event;
        },
        loaded: instance => {
          client = instance;
          for (const [name, properties] of pending.splice(0)) capture(name, properties);
        },
      });
    } catch (error) {
      console.warn('[Horizons] Analytics initialization failed; website functionality is unaffected.', error);
    }
  };
  document.head.append(script);
})();
