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
  class Element {}
  const sdk = {
    init: (token, options) => {
      assert.match(token, /^phc_/);
      config = options;
      options.loaded(sdk);
    },
    capture: (name, properties) => captured.push({ name, properties }),
  };
  const window = { posthog: sdk, HORIZONS_ANALYTICS_TEST: testing };
  vm.runInNewContext(source, {
    window, location: { hostname, protocol }, URL, Element,
    console: { warn: (...args) => warnings.push(args) },
    document: {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      createElement: () => ({}),
      head: { append: script => scripts.push(script) },
    },
  });
  return { listeners, scripts, captured, warnings, sdk, Element, load: () => scripts[0].onload(), config: () => config };
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
  f.listeners['horizons:form-sent']({ detail: 'contact' });
  f.listeners['horizons:form-sent']({ detail: { email: 'private' } });
  assert.equal(f.captured.length, 0);
  f.load();
  f.listeners['horizons:form-sent']({ detail: 'goodbye' });
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
  const link = { href: 'https://chromewebstore.google.com/', closest: selector => selector === '.hero' };
  const target = new f.Element();
  target.closest = () => link;
  f.listeners.click({ target });
  assert.equal(f.captured[0].properties.placement, 'hero');
  assert.equal(f.captured[0].properties.install_listing_available, false);
  link.href = 'https://chromewebstore.google.com/detail/example/example-id';
  f.listeners.click({ target });
  assert.equal(f.captured[1].properties.install_listing_available, true);
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
