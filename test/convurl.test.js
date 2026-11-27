const test = require('node:test'), assert = require('node:assert');
const { canonicalizeChatUrl, isChatUrl } = require('../extension/lib/convurl.js');

test('Gemini chat URLs keep /app/<id> (or /u/N/app/<id>) and drop tracking query and hash', () => {
  const a = canonicalizeChatUrl('https://gemini.google.com/app/abcDEF123?utm_source=share&foo=1#x');
  assert.deepEqual(a, { ok: true, provider: 'gemini', url: 'https://gemini.google.com/app/abcDEF123', id: 'abcDEF123' });
  const b = canonicalizeChatUrl('https://gemini.google.com/u/0/app/xyz789xyz/?usp=sharing');
  assert.equal(b.ok, true);
  assert.equal(b.url, 'https://gemini.google.com/u/0/app/xyz789xyz');
  assert.equal(b.id, 'xyz789xyz');
  assert.equal(canonicalizeChatUrl('https://gemini.google.com/app').ok, false);
  assert.equal(canonicalizeChatUrl('https://gemini.google.com/app/').code, 'not_conversation');
});

test('ChatGPT, Claude and Grok conversation links canonicalize the same way; share/search/settings are rejected', () => {
  assert.equal(canonicalizeChatUrl('https://chatgpt.com/c/11111111-2222-3333-4444-555555555555?model=gpt-4o').url,
    'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555');
  assert.equal(canonicalizeChatUrl('https://chatgpt.com/g/g-abc123/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').ok, true);
  assert.equal(canonicalizeChatUrl('https://claude.ai/chat/01234567-89ab-cdef-0123-456789abcdef').provider, 'claude');
  assert.equal(canonicalizeChatUrl('https://grok.com/c/abcd1234').provider, 'grok');
  assert.equal(canonicalizeChatUrl('https://grok.com/chat/abcd1234').ok, true);
  assert.equal(canonicalizeChatUrl('https://chatgpt.com/share/xyzxyzxyzxyz').ok, false);
  assert.equal(canonicalizeChatUrl('https://claude.ai/settings').ok, false);
  assert.equal(canonicalizeChatUrl('https://gemini.google.com/search/foo').ok, false);
  assert.equal(canonicalizeChatUrl('not a url').code, 'bad_url');
  assert.equal(isChatUrl('https://gemini.google.com/app/abcDEF123'), true);
});

test('dev/mock hosts can be aliased so a local /app/<id> is treated as Gemini', () => {
  const r = canonicalizeChatUrl('http://127.0.0.1:4173/app/abc123?x=1', { aliases: { '127.0.0.1': 'gemini' } });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.url, 'http://127.0.0.1:4173/app/abc123');
});
