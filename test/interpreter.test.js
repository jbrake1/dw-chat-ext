const test = require('node:test'), assert = require('node:assert');
const I = require('../extension/lib/interpreter.js');
const { dom, bundled, sleep } = require('./helpers.js');

test('resolve: first matching selector entry wins, index tells which (fallback usage)', () => {
  const w = dom('<div id="b" class="x"></div><div class="y"></div>');
  const d = w.document;
  assert.deepEqual(I.resolve(d, ['#nope', '.x', '.y']).index, 1);
  assert.equal(I.resolve(d, ['#nope', '.nada']).el, null);
  assert.equal(I.resolve(d, ['#b']).index, 0);
});

test('resolve: invalid CSS entries are skipped, textMatches filters, accept() filters', () => {
  const w = dom('<button>Save</button><button disabled>Send it</button><button>Send it</button>');
  const d = w.document;
  assert.equal(I.resolve(d, ['::::bad((', { css: 'button', textMatches: '^send' }]).index, 1);
  const r = I.resolve(d, [{ css: 'button', textMatches: 'send' }], I.isEnabled);
  assert.equal(r.el.disabled, false);
});

test('waitFor resolves via MutationObserver when the element appears later, and rejects with a code on timeout', async () => {
  const w = dom('<div id="root"></div>');
  const p = I.waitFor(w, w.document, ['#late'], { timeoutMs: 1000, step: 'prompt' });
  setTimeout(() => { const e = w.document.createElement('div'); e.id = 'late'; w.document.getElementById('root').appendChild(e); }, 20);
  assert.equal((await p).index, 0);
  await assert.rejects(I.waitFor(w, w.document, ['#never'], { timeoutMs: 30, step: 'send' }), (e) => e.step === 'send' && e.code === 'selector_not_found');
});

test('waitFor: abort signal and enabled-attribute change are observed', async () => {
  const w = dom('<button id="b" disabled>go</button>');
  const b = w.document.getElementById('b');
  const p = I.waitFor(w, w.document, ['#b'], { timeoutMs: 1000, accept: I.isEnabled });
  setTimeout(() => b.removeAttribute('disabled'), 20);
  await p;
  const ac = new w.AbortController();
  const q = I.waitFor(w, w.document, ['#zzz'], { timeoutMs: 1000, signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(q, (e) => e.code === 'aborted');
});

test('setText: falls through strategies (jsdom has no execCommand/clipboard) and verifies the text landed', () => {
  const w = dom('<div id="p" contenteditable="true"></div>'); delete w.ClipboardEvent;
  const el = w.document.getElementById('p');
  assert.equal(I.setText(w, el, 'Hello world, change the headline', ['execCommand', 'paste', 'textContent'], true), 'textContent');
  assert.match(el.textContent, /Hello world/);
});

test('setText: paste strategy used when the page accepts it; rejects if nothing sticks', () => {
  const w = dom('<div id="p" contenteditable="true"></div>');
  const el = w.document.getElementById('p');
  el.addEventListener('paste', (e) => { e.preventDefault(); el.textContent = e.clipboardData.getData('text/plain'); });
  assert.equal(I.setText(w, el, 'via paste text here', ['execCommand', 'paste'], true), 'paste');
  const el2 = w.document.createElement('div'); el2.setAttribute('contenteditable', 'true'); w.document.body.appendChild(el2);
  assert.throws(() => I.setText(w, el2, 'nothing sticks', ['paste'], true), (e) => e.code === 'text_not_accepted');
});

test('setText: textarea uses the native value setter and fires input', () => {
  const w = dom('<textarea id="t"></textarea>');
  const t = w.document.getElementById('t'); let fired = 0; t.addEventListener('input', () => fired++);
  assert.equal(I.setText(w, t, 'abc'), 'nativeValue'); assert.equal(t.value, 'abc'); assert.equal(fired, 1);
});

const FILE = { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };

test('fileFromDataUrl builds a File; bad data urls throw bad_file', () => {
  const w = dom('<p></p>');
  const f = I.fileFromDataUrl(w, FILE);
  assert.equal(f.name, 'markup.jpg'); assert.equal(f.type, 'image/jpeg'); assert.ok(f.size > 4);
  assert.throws(() => I.fileFromDataUrl(w, { dataUrl: 'nope' }), (e) => e.code === 'bad_file');
});

test('attachFile: fileInput strategy sets files, fires change, confirms via selector', async () => {
  const w = dom('<div id="p" contenteditable></div><input type="file" id="f"><div id="chips"></div>');
  const d = w.document, f = d.getElementById('f');
  f.addEventListener('change', () => { const c = d.createElement('i'); c.className = 'chip'; d.getElementById('chips').appendChild(c); });
  const step = { strategies: [{ type: 'fileInput', selectors: ['#nope', 'input[type=file]'] }], confirm: { selectors: ['.chip'], timeoutMs: 500 } };
  const r = await I.attachFile(w, d, step, d.getElementById('p'), I.fileFromDataUrl(w, FILE));
  assert.equal(r.strategy, 'fileInput'); assert.equal(f.files.length, 1);
});

test('attachFile: falls back to paste when there is no file input; fails with attach_failed when nothing works', async () => {
  const w = dom('<div id="p" contenteditable></div><div id="chips"></div>');
  const d = w.document, p = d.getElementById('p');
  p.addEventListener('paste', (e) => { if (e.clipboardData.files.length) { const c = d.createElement('i'); c.className = 'chip'; d.getElementById('chips').appendChild(c); } });
  const step = { strategies: [{ type: 'fileInput', selectors: ['input[type=file]'] }, { type: 'paste' }], confirm: { selectors: ['.chip'], timeoutMs: 300 } };
  const r = await I.attachFile(w, d, step, p, I.fileFromDataUrl(w, FILE));
  assert.deepEqual([r.strategy, r.index], ['paste', 1]);
  const w2 = dom('<div id="p" contenteditable></div>');
  await assert.rejects(I.attachFile(w2, w2.document, { strategies: [{ type: 'paste' }], confirm: { selectors: ['.chip'], timeoutMs: 50 } }, w2.document.getElementById('p'), I.fileFromDataUrl(w2, FILE)),
    (e) => e.step === 'attach' && /attach/.test(e.code));
});

test('clickSend waits for the button to become enabled; fallbackKey presses Enter when the button is missing', async () => {
  const w = dom('<div id="p" contenteditable></div><button id="s" disabled>Send</button>');
  const d = w.document, s = d.getElementById('s'); let clicks = 0;
  s.addEventListener('click', () => clicks++);
  setTimeout(() => s.removeAttribute('disabled'), 30);
  const r = await I.clickSend(w, d, { selectors: ['#s'], timeoutMs: 500, requireEnabled: true }, d.getElementById('p'));
  assert.equal(clicks, 1); assert.equal(r.via, 'click');
  let key = 0; d.getElementById('p').addEventListener('keydown', (e) => { if (e.key === 'Enter') key++; });
  const r2 = await I.clickSend(w, d, { selectors: ['#gone'], timeoutMs: 30, fallbackKey: 'Enter' }, d.getElementById('p'));
  assert.equal(r2.via, 'key'); assert.equal(key, 1);
  await assert.rejects(I.clickSend(w, d, { selectors: ['#gone'], timeoutMs: 30 }, null), (e) => e.step === 'send');
});

test('urlInfo: drops javascript:/data:, keeps sandbox:, marks direct downloads only for allowed hosts', () => {
  const w = dom('<p></p>', { url: 'https://chatgpt.com/c/1' });
  assert.equal(I.urlInfo(w, 'javascript:alert(1)', []), null);
  assert.equal(I.urlInfo(w, 'data:text/html,x', []), null);
  assert.deepEqual([I.urlInfo(w, 'sandbox:/mnt/data/a.csv', []).needsTab], [true]);
  assert.equal(I.urlInfo(w, 'https://files.oaiusercontent.com/x', ['oaiusercontent.com']).needsTab, false);
  assert.equal(I.urlInfo(w, 'https://evil.example/x', ['oaiusercontent.com']).needsTab, true);
  assert.equal(I.urlInfo(w, '/backend-api/files/abc', ['chatgpt.com']).url, 'https://chatgpt.com/backend-api/files/abc');
});

test('readState with the bundled instructions: new message, text, files, stop, errors', () => {
  const instr = bundled();
  const w = dom(`<div data-message-author-role="assistant"><div class="markdown">old</div></div>
    <div data-message-author-role="assistant"><div class="markdown"><p>New reply</p><a href="sandbox:/mnt/data/r.html">r.html</a><a href="javascript:x()">bad</a><a href="https://files.oaiusercontent.com/f/n.txt" download="n.txt">n</a></div></div>
    <button data-testid="stop-button">Stop</button>`);
  const map = new Map();
  const s = I.readState(w, w.document, instr, 1, map);
  assert.equal(s.newMessage, true); assert.equal(s.text.startsWith('New reply'), true);
  assert.equal(s.present.stop, true);
  assert.deepEqual(s.files.map((f) => [f.kind, f.name, f.needsTab]), [['file', 'r.html', true], ['file', 'n.txt', false]]);
  assert.equal(I.readState(w, w.document, instr, 2, map).newMessage, false);
  const w2 = dom('<div role="alert">Too many requests</div><div data-message-author-role="assistant"></div>');
  assert.equal(I.readState(w2, w2.document, instr, 0, map).error, 'rate_limited');
});
