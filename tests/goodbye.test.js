import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const goodbyeJsCode = readFileSync(join(root, 'goodbye.js'), 'utf8');

test('goodbye.html markup contains multiselect options without workflow and with visible details field', () => {
  const html = readFileSync(join(root, 'goodbye.html'), 'utf8');
  assert.equal(html.includes('value="workflow"'), false, 'workflow option should be removed');
  assert.match(html, /<input type="checkbox" name="reason" value="didnt-understand"/);
  assert.match(html, /<input type="checkbox" name="reason" value="missing-feature"/);
  assert.match(html, /<input type="checkbox" name="reason" value="broken"/);
  assert.match(html, /<input type="checkbox" name="reason" value="stopped-todoist"/);
  assert.match(html, /<input type="checkbox" name="reason" value="trying"/);
  assert.match(html, /<input type="checkbox" name="reason" value="other"/);
  // message-field should be present and NOT hidden
  assert.match(html, /id="message-field"/);
  assert.doesNotMatch(html, /id="message-field"[^>]*hidden/);
});

test('goodbye.js submits multi-select reasons and comment feedback', async () => {
  const listeners = {};
  const status = { dataset: {}, textContent: '' };
  const submitBtn = { textContent: 'Send', disabled: false };
  const thanks = { hidden: true, focus: () => {} };

  const checkboxes = [
    { name: 'reason', value: 'missing-feature', checked: false },
    { name: 'reason', value: 'broken', checked: false },
  ];

  const form = {
    elements: {
      message: { value: 'Kanban board customization was missing' },
      email: { value: 'user@example.com' },
      botcheck: { value: '' },
    },
    reportValidity: () => true,
    querySelector: (sel) => {
      if (sel.includes('button')) return submitBtn;
      if (sel.includes('input')) return checkboxes[0];
      return status;
    },
    querySelectorAll: (sel) => {
      if (sel === 'input[name="reason"]:checked') {
        return checkboxes.filter(cb => cb.checked);
      }
      return [];
    },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    reset: () => {
      checkboxes.forEach(cb => { cb.checked = false; });
    },
  };

  let dispatched = [];
  let capturedPayload = null;

  vm.runInNewContext(goodbyeJsCode, {
    document: {
      getElementById: (id) => {
        if (id === 'goodbye-form') return form;
        if (id === 'goodbye-thanks') return thanks;
        return null;
      },
      dispatchEvent: (event) => dispatched.push(event),
    },
    window: { location: { search: '' }, setTimeout: (fn) => fn(), clearTimeout: () => {} },
    navigator: { language: 'en' },
    localStorage: { getItem: () => null, setItem: () => {} },
    AbortController: class { abort() {} get signal() { return {}; } },
    FormData: class {
      constructor() { this.entries = {}; }
      append(k, v) { this.entries[k] = v; }
    },
    URLSearchParams: class { get() { return ''; } },
    CustomEvent: class { constructor(type, opt) { this.type = type; this.detail = opt.detail; } },
    fetch: async (url, opts) => {
      capturedPayload = opts.body;
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  // User checks "missing-feature"
  checkboxes[0].checked = true;
  listeners['change']({ target: checkboxes[0] });

  // User checks "broken"
  checkboxes[1].checked = true;
  listeners['change']({ target: checkboxes[1] });

  // User submits
  await listeners['submit']({ preventDefault: () => {} });
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.entries.reason, 'A feature I need is missing, Something didn’t work');
  assert.equal(capturedPayload.entries.message, 'Kanban board customization was missing');
  assert.equal(capturedPayload.entries.email, 'user@example.com');
  assert.equal(thanks.hidden, false);
  assert.equal(dispatched[0].type, 'horizons:form-sent');
  assert.equal(dispatched[0].detail, 'goodbye');
});
