const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync((fs.existsSync(path.join(__dirname, '../server/markup/markup.js')) ? path.join(__dirname, '../server/markup/markup.js') : path.join(__dirname, '../mock/markup.js')), 'utf8');
const wins = [];
test.after(() => wins.forEach((w) => { try { w.close(); } catch (e) {} }));
function editor() {
  const d = new JSDOM('<!doctype html><html><head></head><body><h1>Home</h1></body></html>', { url: 'https://dwalliance.com/index.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = d.window, posted = [], calls = [];
  win.fetch = async (u, o = {}) => {
    const url = new URL(u, 'https://dwalliance.com/');
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    if (o.method === 'HEAD') return { ok: true, status: 200 };
    if (url.searchParams.get('a') === 'status') return json({ ok: true, show: true, csrf: 'c1' });
    if (url.searchParams.get('a') === 'files') { calls.push(JSON.parse(o.body)); return json({ ok: true, id: String(calls.length), staged_on_existing: true }); }
    return json({ ok: true });
  };
  win.__notes = [];
  win.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createOscillator = () => ({ type: '', frequency: { setValueAtTime: (f) => win.__notes.push(f) }, connect() {}, start() {}, stop() {} }); this.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }); };
  win.addEventListener('message', (e) => { if (e.data && e.data.source === 'dw-edit') posted.push(e.data); });
  win.eval(SRC);
  wins.push(win);
  return { win, posted, calls };
}
const send = (win, data) => win.dispatchEvent(new win.MessageEvent('message', { data: Object.assign({ v: 1, source: 'dw-ext' }, data), origin: 'https://dwalliance.com', source: win }));
const shadowAll = (win, sel) => { const out = []; win.document.querySelectorAll('*').forEach((n) => { if (n.shadowRoot) n.shadowRoot.querySelectorAll(sel).forEach((x) => out.push(x)); }); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = '<!doctype html>\n<html><body><h1>Recovered page</h1></body></html>\n';

test('v0.1.15: Recover reply from chat URL is in the chat header; pasting a Gemini link posts dw-ext-recover', async () => {
  const { win, posted } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-error', jobId: 'j1', step: 'stream', code: 'no_stream', sent: true });
  await sleep(80);
  const header = shadowAll(win, '[data-role=feed-tools]')[0];
  assert.ok(header, 'header tools present after the error');
  const btn = header.querySelector('[data-act=recover]');
  assert.ok(btn); assert.equal(btn.textContent, 'Recover reply from chat URL');
  const box = shadowAll(win, '[data-role=feed-recover]')[0];
  assert.ok(box, 'recover form is opened after no_stream');
  assert.equal(box.hidden, false);
  const err = shadowAll(win, '[data-code=no_stream]')[0];
  assert.ok(err); assert.match(err.textContent, /Recover reply from chat URL/);
  const input = shadowAll(win, '[data-role=recover-url]')[0];
  input.value = 'https://gemini.google.com/app/abcDEF123?utm_source=share';
  shadowAll(win, '[data-act=recover-go]')[0].click();
  await sleep(40);
  const rec = posted.find((p) => p.type === 'dw-ext-recover');
  assert.ok(rec, 'dw-ext-recover was posted');
  assert.equal(rec.url, 'https://gemini.google.com/app/abcDEF123?utm_source=share');
});

test('v0.1.15: a recovered done event stages the usual /files preview with Publish', async () => {
  const { win, calls } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-error', jobId: 'j1', step: 'stream', code: 'no_stream', sent: true });
  await sleep(40);
  send(win, { type: 'dw-ext-done', jobId: 'recover', status: 'complete', recovered: true, text: 'File: /index.html\n```html\n' + PAGE + '```', files: [], blocks: [{ label: 'File: /index.html', lang: 'html', code: PAGE }], assets: [] });
  await sleep(300);
  assert.equal(calls.filter((c) => c.action === 'create').length, 1, 'the recovered page was staged');
  const pub = shadowAll(win, '[data-act=publish]')[0];
  assert.ok(pub, 'Publish is on the recovered preview');
});

function openEditor(win) {
  const host = win.document.getElementById('dw-markup-root');
  const fab = host && host.shadowRoot && host.shadowRoot.querySelector('button.fab');
  assert.ok(fab, 'Suggest an edit button is on the page');
  fab.click();
  return host.shadowRoot;
}

test('v0.1.16: Recover reply is on the main toolbar from the first open, with no session, pairing or timeout', async () => {
  const { win, posted } = editor();
  await sleep(50);
  const sr = openEditor(win);
  const barBtn = sr.querySelector('[data-act=recover-bar]');
  assert.ok(barBtn, 'toolbar Recover reply is present on first open');
  assert.match(barBtn.textContent, /Recover reply/);
  const noteBtn = sr.querySelector('[data-act=recover-chat]');
  assert.ok(noteBtn, 'note box Recover entry point renders on first open');
  assert.equal(noteBtn.textContent, 'Recover reply from chat URL');
  assert.equal(noteBtn.className, 'recbtn');
  assert.ok(!shadowAll(win, '[data-role=feed-recover]')[0], 'form is not open until Recover is clicked');
  barBtn.click();
  const box = shadowAll(win, '[data-role=feed-recover]')[0];
  assert.ok(box, 'clicking Recover reply opens the paste-URL form');
  assert.equal(box.hidden, false);
  const headerBtn = shadowAll(win, '[data-act=recover]')[0];
  assert.ok(headerBtn, 'chat header Recover entry point renders once the form is opened');
  assert.equal(headerBtn.textContent, 'Recover reply from chat URL');
  const msg = shadowAll(win, '[data-role=recover-msg]')[0];
  assert.ok(msg);
  send(win, { type: 'dw-ext-ready', paired: false, editor: true });
  await sleep(20);
  assert.match(msg.textContent, /Pair this tab/);
  send(win, { type: 'dw-ext-ready', paired: true, editor: true });
  await sleep(20);
  assert.match(msg.textContent, /Paired\. Paste the chat link/);
  const input = shadowAll(win, '[data-role=recover-url]')[0];
  input.value = 'https://gemini.google.com/app/abcDEF123?utm_source=share';
  shadowAll(win, '[data-act=recover-go]')[0].click();
  await sleep(40);
  const rec = posted.find((p) => p.type === 'dw-ext-recover');
  assert.ok(rec);
  assert.equal(rec.url, 'https://gemini.google.com/app/abcDEF123?utm_source=share');
});

test('v0.1.16: closing the chat feed and clicking Recover remounts the header button and the form', async () => {
  const { win } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-error', jobId: 'j1', step: 'stream', code: 'no_stream', sent: true });
  await sleep(40);
  assert.ok(shadowAll(win, '[data-act=recover]')[0]);
  const close = shadowAll(win, '[data-act=close]')[0];
  assert.ok(close); close.click();
  assert.ok(!win.document.getElementById('dw-ext-feed'), 'feed was closed');
  const sr = openEditor(win);
  sr.querySelector('[data-act=recover-bar]').click();
  const box = shadowAll(win, '[data-role=feed-recover]')[0];
  assert.ok(box && box.hidden === false, 'form remounts on the new feed');
  const headerBtn = shadowAll(win, '[data-act=recover]')[0];
  assert.ok(headerBtn && headerBtn.textContent === 'Recover reply from chat URL');
});
