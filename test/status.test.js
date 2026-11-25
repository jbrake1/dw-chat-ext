const test = require('node:test'), assert = require('node:assert');
require('../extension/lib/status.js');

test('pageStatus keeps only allowlisted fields and drops titles or chat content', () => {
  const out = DWX.pageStatus({
    extVersion: '0.1.1',
    paired: true,
    ai: 'chatgpt',
    revision: 2,
    editor: true,
    pairedTitle: 'Secret chat title',
    title: 'do not leak',
    text: 'a ChatGPT reply',
    prompt: 'the note',
    host: 'chatgpt.com'
  });
  assert.deepEqual(out, { extVersion: '0.1.1', paired: true, ai: 'chatgpt', revision: 2, editor: true });
  assert.equal(JSON.stringify(out).includes('Secret'), false);
  assert.equal(JSON.stringify(out).includes('reply'), false);
  assert.equal(JSON.stringify(out).includes('chatgpt.com'), false);
});

test('pageStatus drops unknown AI ids and requires a confirmed editor to report pairing', () => {
  assert.equal(DWX.pageStatus({ extVersion: '0.1.1', paired: true, ai: 'copilot', editor: true, revision: 1 }).ai, null);
  assert.equal(DWX.pageStatus({ extVersion: '0.1.13', paired: true, ai: 'claude', editor: true, revision: 1 }).ai, 'claude');
  assert.deepEqual(DWX.pageStatus({ extVersion: '0.1.1', paired: true, ai: 'chatgpt', editor: false, revision: 2 }), {
    extVersion: '0.1.1', paired: false, ai: null, revision: 2, editor: false
  });
});

test('pageStatus validates version and revision', () => {
  assert.equal(DWX.pageStatus({ extVersion: 'bad version!', editor: true }).extVersion, '');
  assert.equal(DWX.pageStatus({ extVersion: '0.1.1<script>', editor: true }).extVersion, '');
  assert.equal(DWX.pageStatus({ revision: -1, editor: true }).revision, null);
  assert.equal(DWX.pageStatus({ revision: 1.5, editor: true }).revision, null);
  assert.equal(DWX.pageStatus({ revision: '2', editor: true }).revision, null);
  assert.equal(DWX.pageStatus({ revision: 0, editor: true }).revision, 0);
});

test('AI allowlist is chatgpt, gemini, grok and claude (v0.1.13)', () => {
  assert.deepEqual(Object.keys(DWX.AI_ALLOWLIST), ['chatgpt', 'gemini', 'grok', 'claude']);
});

test('pageStatus passes the chosen provider only for a confirmed editor and only if allowlisted', () => {
  assert.equal(DWX.pageStatus({ extVersion: '0.1.6', editor: true, provider: 'gemini' }).provider, 'gemini');
  assert.equal('provider' in DWX.pageStatus({ extVersion: '0.1.6', editor: true, provider: 'copilot' }), false);
  assert.equal(DWX.pageStatus({ extVersion: '0.1.13', editor: true, provider: 'grok' }).provider, 'grok');
  assert.equal('provider' in DWX.pageStatus({ extVersion: '0.1.6', editor: false, provider: 'gemini' }), false);
});
