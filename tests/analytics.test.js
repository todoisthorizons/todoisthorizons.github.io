const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'analytics.js'), 'utf8');

function fixture({ hostname = 'todoisthorizons.github.io', protocol = 'https:', testing = false } = {}) {
  const listeners = {};
  const scripts = [];
  const captured = [];
  const warnings = [];
  let config;
  class Element {
    closest() { return null; }
    matches() { return false; }
    getAttribute() { return null; }
  }
  const sdk = {
    init: (token, options) => {
      assert.match(token, /^phc_/);
      config = options;
      options.loaded(sdk);
    },
    capture: (name, properties) => captured.push({ name, properties }),
  };
  const windowListeners = {};
  const window = {
    posthog: sdk,
    HORIZONS_ANALYTICS_TEST: testing,
    addEventListener: (name, listener) => {
      windowListeners[name] ||= [];
      windowListeners[name].push(listener);
    },
    innerHeight: 800,
    scrollY: 0,
  };
  const dispatchDoc = (name, event) => {
    const list = listeners[name] || [];
    for (const fn of list) fn(event);
  };
  vm.runInNewContext(source, {
    window, location: { hostname, protocol }, URL, Element,
    console: { warn: (...args) => warnings.push(args) },
    document: {
      documentElement: { scrollHeight: 2000, scrollTop: 0, getAttribute: () => 'light' },
      readyState: 'complete',
      addEventListener: (name, listener) => {
        listeners[name] ||= [];
        listeners[name].push(listener);
      },
      createElement: () => ({}),
      head: { append: script => scripts.push(script) },
    },
  });
  return {
    listeners,
    dispatchDoc,
    windowListeners,
    window,
    scripts,
    captured,
    warnings,
    sdk,
    Element,
    load: () => scripts[0].onload(),
    config: () => config,
  };
}

test('ordinary previews never load the SDK; deliberate localhost tests are labeled', () => {
  for (const hostname of ['localhost', '127.0.0.1', 'staging.example.com']) {
    assert.equal(fixture({ hostname, testing: hostname === 'staging.example.com' }).scripts.length, 0);
  }
  assert.equal(fixture({ protocol: 'http:' }).scripts.length, 0);
  const f = fixture({ hostname: 'localhost', testing: true });
  f.load();
  const event = f.config().before_send({ properties: {}, event: '$pageview' });
  assert.equal(event.properties.analytics_environment, 'test');
});

test('enables autocapture and replay with form, network and console protections', () => {
  const f = fixture();
  f.load();
  const config = f.config();
  assert.equal(config.capture_pageview, true);
  assert.equal(config.capture_pageleave, true);
  assert.equal(config.disable_session_recording, false);
  assert.equal(config.session_recording.maskAllInputs, true);
  assert.equal(config.session_recording.recordBody, false);
  assert.equal(config.session_recording.recordHeaders, false);
  assert.equal(config.enable_recording_console_log, false);
  assert.ok(config.autocapture.css_selector_ignorelist.includes('textarea'));
  assert.equal(config.session_recording.maskAttributeFn('value', 'private', { matches: () => true }), '');
  assert.equal(config.session_recording.maskAttributeFn('href', '/index.html?email=private#secret'), '/index.html');
  assert.equal(config.session_recording.maskCapturedNetworkRequestFn({ name: 'https://example.com?secret=yes' }).name, 'https://example.com');
});

test('labels first pageviews, automatic events and replay; sanitizes metadata without breaking resources', () => {
  const f = fixture();
  f.load();
  for (const name of ['$pageview', '$pageleave', '$autocapture', '$snapshot', 'website_contact_message_sent']) {
    const event = {
      event: name,
      properties: {
        app_surface: 'extension',
        $current_url: 'https://example.com/goodbye.html?v=1&secret=yes#secret',
        $set_once: { $initial_referrer: 'https://example.com?private=yes' },
        $elements: [{ attr__href: '/index.html?secret=yes' }],
        $snapshot_data: [
          { type: 4, data: { href: 'https://example.com?secret=yes#secret' } },
          { type: 2, data: { attributes: { src: '/icon.svg?v=1' } } },
        ],
      },
      $set_once: { $initial_current_url: 'https://example.com?secret=yes' },
    };
    const result = f.config().before_send(event);
    assert.equal(result.properties.app_surface, 'website');
    assert.equal(result.properties.analytics_environment, 'production');
    assert.equal(result.properties.$current_url, 'https://example.com/goodbye.html');
    assert.equal(result.properties.$set_once.$initial_referrer, 'https://example.com');
    assert.equal(result.properties.$elements[0].attr__href, '/index.html');
    assert.equal(result.properties.$snapshot_data[0].data.href, 'https://example.com');
    assert.equal(result.properties.$snapshot_data[1].data.attributes.src, '/icon.svg?v=1');
    assert.equal(result.$set_once.$initial_current_url, 'https://example.com');
  }
});

test('queues early success events and emits only known form identifiers', () => {
  const f = fixture();
  f.dispatchDoc('horizons:form-sent', { detail: 'contact' });
  f.dispatchDoc('horizons:form-sent', { detail: { email: 'private' } });
  assert.equal(f.captured.length, 0);
  f.load();
  f.dispatchDoc('horizons:form-sent', { detail: 'goodbye' });
  assert.deepEqual(f.captured.map(event => event.name), ['website_contact_message_sent', 'website_uninstall_feedback_sent']);
  assert.equal(JSON.stringify(f.captured).includes('private'), false);
});

test('removes query strings from heatmap keys and preserves combined click points', () => {
  const f = fixture();
  f.load();
  const event = {
    event: '$$heatmap',
    properties: { $heatmap_data: {
      'https://example.com/?secret=one': [{ x: 1, y: 2 }],
      'https://example.com/?secret=two#private': [{ x: 3, y: 4 }],
    } },
  };
  const result = f.config().before_send(event);
  assert.deepEqual(JSON.parse(JSON.stringify(result.properties.$heatmap_data)), {
    'https://example.com/': [{ x: 1, y: 2 }, { x: 3, y: 4 }],
  });
});

test('install clicks retain placement and distinguish the placeholder from a listing', () => {
  const f = fixture();
  f.load();
  const link = { href: 'https://chromewebstore.google.com/', closest: selector => selector === '.hero' ? link : null };
  const target = new f.Element();
  target.closest = selector => selector === 'a' ? link : null;
  f.dispatchDoc('click', { target });
  assert.equal(f.captured[0].properties.placement, 'hero');
  assert.equal(f.captured[0].properties.install_listing_available, false);
  link.href = 'https://chromewebstore.google.com/detail/example/example-id';
  f.dispatchDoc('click', { target });
  assert.equal(f.captured[1].properties.install_listing_available, true);
});

test('captures theme toggle, faq accordion expansion, demo interactions, and scroll milestones', () => {
  const f = fixture();
  f.load();

  // 1. Theme toggle click
  const themeBtn = { id: 'themeToggle' };
  const themeTarget = new f.Element();
  themeTarget.closest = sel => (sel === '#themeToggle' ? themeBtn : null);
  f.dispatchDoc('click', { target: themeTarget });
  const themeEvent = f.captured.find(e => e.name === 'website_theme_toggled');
  assert.ok(themeEvent);
  assert.equal(themeEvent.properties.theme, 'dark');

  // 2. FAQ expansion
  const faqElement = new f.Element();
  faqElement.matches = sel => sel === '.faq-item';
  faqElement.open = true;
  faqElement.querySelector = sel => (sel === 'summary' ? { textContent: '  Where are my goals stored?  ' } : null);
  f.dispatchDoc('toggle', { target: faqElement });
  const faqEvent = f.captured.find(e => e.name === 'website_faq_expanded');
  assert.ok(faqEvent);
  assert.equal(faqEvent.properties.question, 'Where are my goals stored?');

  // 3. Demo interaction via custom event
  f.dispatchDoc('horizons:analytics', {
    detail: {
      name: 'website_demo_interacted',
      properties: { action: 'toggle_goal', tier: 'week', completed: true },
    },
  });
  const demoEvent = f.captured.find(e => e.name === 'website_demo_interacted');
  assert.ok(demoEvent);
  assert.equal(demoEvent.properties.action, 'toggle_goal');
  assert.equal(demoEvent.properties.tier, 'week');
  assert.equal(demoEvent.properties.completed, true);

  // 4. Scroll milestones
  f.window.scrollY = 600;
  for (const fn of f.windowListeners['scroll'] || []) fn();
  const scroll25 = f.captured.find(e => e.name === 'website_scroll_depth_reached' && e.properties.depth_percent === 25);
  const scroll50 = f.captured.find(e => e.name === 'website_scroll_depth_reached' && e.properties.depth_percent === 50);
  assert.ok(scroll25);
  assert.ok(scroll50);
});

test('SDK failures are reported without throwing into website code', () => {
  const f = fixture();
  assert.doesNotThrow(() => f.scripts[0].onerror());
  f.sdk.init = () => { throw new Error('synthetic initialization failure'); };
  assert.doesNotThrow(() => f.load());
  assert.equal(f.warnings.length, 2);
});

test('every page has exactly one initializer and the required CSP origins', () => {
  for (const page of ['index.html', 'privacy.html', 'terms.html', 'goodbye.html']) {
    const html = readFileSync(join(root, page), 'utf8');
    assert.equal((html.match(/src="analytics\.js/g) || []).length, 1, page);
    assert.match(html, /script-src[^;]+https:\/\/eu-assets\.i\.posthog\.com/);
    assert.match(html, /connect-src[^;]+https:\/\/eu\.i\.posthog\.com/);
    assert.match(html, /worker-src 'self' blob:/);
  }
});

test('both forms emit content-free success events only after confirmed API success', async () => {
  for (const [script, formId, expected] of [
    ['contact.js', 'contact-form', 'contact'],
    ['goodbye.js', 'goodbye-form', 'goodbye'],
  ]) {
    for (const outcome of ['success', 'http-error', 'api-error', 'network-error', 'honeypot', 'invalid']) {
      const emitted = [];
      let submit;
      let requests = 0;
      const status = { dataset: {}, textContent: '' };
      const button = { textContent: 'Send', disabled: false };
      const form = {
        elements: {
          name: { value: 'SyntheticPrivateName' },
          email: { value: 'synthetic-private@example.invalid' },
          message: { value: 'SyntheticPrivateMessage' },
          topic: { value: 'Question' },
          reason: { value: 'workflow' },
          botcheck: { value: outcome === 'honeypot' ? 'bot' : '' },
        },
        reportValidity: () => outcome !== 'invalid',
        querySelector: selector => selector.includes('button') ? button : status,
        addEventListener: (type, handler) => { if (type === 'submit') submit = handler; },
        reset: () => {},
      };
      const thanks = { focus: () => {}, hidden: true };
      class CustomEvent {
        constructor(type, options) { this.type = type; this.detail = options.detail; }
      }
      vm.runInNewContext(readFileSync(join(root, script), 'utf8'), {
        document: {
          getElementById: id => id === formId ? form : thanks,
          dispatchEvent: event => emitted.push({ type: event.type, detail: event.detail }),
        },
        window: { location: { search: '' }, setTimeout: () => 1, clearTimeout: () => {} },
        navigator: { language: 'en' },
        localStorage: { getItem: () => null, setItem: () => {} },
        AbortController, FormData, URLSearchParams, CustomEvent,
        fetch: async () => {
          requests++;
          if (outcome === 'network-error') throw new Error('synthetic failure');
          return { ok: outcome !== 'http-error', json: async () => ({ success: outcome !== 'api-error' }) };
        },
      });
      await submit({ preventDefault: () => {} });
      assert.deepEqual(emitted, outcome === 'success'
        ? [{ type: 'horizons:form-sent', detail: expected }] : [], `${script}: ${outcome}`);
      if (['honeypot', 'invalid'].includes(outcome)) assert.equal(requests, 0);
      assert.equal(button.disabled, false);
      assert.doesNotMatch(JSON.stringify(emitted), /SyntheticPrivate|synthetic-private/);
    }
  }
});
