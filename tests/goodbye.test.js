import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const goodbyeJsCode = readFileSync(join(root, 'goodbye.js'), 'utf8');

test('goodbye.html markup contains required multiselect elements', () => {
  const html = readFileSync(join(root, 'goodbye.html'), 'utf8');
  assert.match(html, /<input type="checkbox" name="reason" value="didnt-understand"/);
  assert.match(html, /<input type="checkbox" name="reason" value="workflow"/);
  assert.match(html, /<input type="checkbox" name="reason" value="missing-feature"/);
  assert.match(html, /<input type="checkbox" name="reason" value="broken"/);
  assert.match(html, /<input type="checkbox" name="reason" value="stopped-todoist"/);
  assert.match(html, /<input type="checkbox" name="reason" value="trying"/);
  assert.match(html, /<input type="checkbox" name="reason" value="other" id="reason-other"/);
  assert.match(html, /id="message-field"[^>]*hidden/);
});

test('goodbye.js manages multiselect and toggles other field visibility', async () => {
  const listeners = {};
  const status = { dataset: {}, textContent: '' };
  const submitBtn = { textContent: 'Send', disabled: false };
  const messageField = { hidden: true, querySelector: () => ({ focus: () => {} }) };
  const otherCheckbox = { setAttribute: () => {} };
  const thanks = { hidden: true, focus: () => {} };

  const checkboxes = [
    { name: 'reason', value: 'workflow', checked: false },
    { name: 'reason', value: 'other', checked: false },
  ];

  const form = {
    elements: {
      message: { value: 'Custom reason details' },
      email: { value: '' },
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
        if (id === 'message-field') return messageField;
        if (id === 'reason-other') return otherCheckbox;
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

  // Verify initially hidden
  assert.equal(messageField.hidden, true);

  // User checks "workflow"
  checkboxes[0].checked = true;
  listeners['change']({ target: checkboxes[0] });
  assert.equal(messageField.hidden, true);

  // User checks "other"
  checkboxes[1].checked = true;
  listeners['change']({ target: checkboxes[1] });
  assert.equal(messageField.hidden, false);

  // User submits
  await listeners['submit']({ preventDefault: () => {} });
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.entries.reason, 'It didn’t fit my workflow, Something else');
  assert.equal(capturedPayload.entries.message, 'Custom reason details');
  assert.equal(thanks.hidden, false);

  // User unchecks "other"
  checkboxes[1].checked = false;
  listeners['change']({ target: checkboxes[1] });
  assert.equal(messageField.hidden, true);
});

