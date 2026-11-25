// v0.1.12: a follow-up goes into the SAME AI chat (New chat is skipped), and the editor's follow-up box sends it.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { runJob } = require('../extension/lib/runner.js');
const { geminiInstr, mockGemini } = require('./helpers.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fast() {
  const i = geminiInstr();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.stream.noReplyGraceMs = 600;
  i.steps.attach.confirm.timeoutMs = 2000; i.steps.attach.strategies.forEach((s) => { if (s.confirmMs) s.confirmMs = 600; }); i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000; i.steps.newChat.timeoutMs = 2000;
  return i;
}

test('follow-up: no New chat click, the earlier turn stays, only the new answer is read', async () => {
  const win = await mockGemini('?speed=5&tokens=8&convo=1');
  win.fetch = (u, o) => globalThis.fetch(u, o);
  const ev = [];
  const res = await runJob(win, fast(), { prompt: 'The second picture did not load', followUp: true, file: null, files: [] }, { emit: (e) => ev.push(e) }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.equal(win.__newChat || 0, 0, 'New chat was not clicked');
  assert.deepEqual(ev.find((e) => e.step === 'followUp').detail, { kept: true });
  assert.equal(ev.some((e) => e.step === 'newChat'), false);
  assert.equal(win.document.querySelectorAll('model-response').length, 2, 'the earlier answer is still in the chat');
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(/old answer/.test(done.text), false);
  assert.match(done.text, /^OK\. Gemini got your request/);
});

// The editor (markup.js) side, loaded whole in jsdom.
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
  // a stand-in AudioContext that records notes (jsdom has none)
  win.__notes = [];
  win.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createOscillator = () => ({ type: '', frequency: { setValueAtTime: (f) => win.__notes.push(f) }, connect() {}, start() {}, stop() {} }); this.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }); };
  win.addEventListener('message', (e) => { if (e.data && e.data.source === 'dw-edit') posted.push(e.data); });
  win.eval(SRC);
  wins.push(win);
  return { win, posted, calls };
}
const send = (win, data) => win.dispatchEvent(new win.MessageEvent('message', { data: Object.assign({ v: 1, source: 'dw-ext' }, data), origin: 'https://dwalliance.com', source: win }));
const shadowAll = (win, sel) => { const out = []; win.document.querySelectorAll('*').forEach((n) => { if (n.shadowRoot) n.shadowRoot.querySelectorAll(sel).forEach((x) => out.push(x)); }); return out; };
const PAGE = '<!doctype html>\n<html><body><h1>New</h1></body></html>\n';

test('editor: after a reply the follow-up box shows; Send follow-up posts followUp:true into the same chat; the chime plays once files are staged', async () => {
  const { win, posted, calls } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-chunk', jobId: 'j1', seq: 1, text: 'Working', files: [] });
  send(win, { type: 'dw-ext-done', jobId: 'j1', status: 'complete', text: 'File: /index.html\n```html\n' + PAGE + '```', files: [], blocks: [{ label: 'File: /index.html', lang: 'html', code: PAGE }] });
  await sleep(300);
  assert.equal(calls.filter((c) => c.action === 'create').length, 1);
  const fu = shadowAll(win, '[data-role=feed-followup]')[0];
  assert.ok(fu); assert.equal(fu.style.display, 'flex', 'follow-up box visible after the reply');
  const header = shadowAll(win, '[data-role=feed-tools]')[0];
  assert.ok(header, 'diagnostics live in the chat header');
  assert.ok(header.querySelector('[data-act=diag]')); assert.equal(header.querySelector('[data-act=diag]').textContent, 'Copy diagnostics');
  assert.ok(header.querySelector('[data-act=snapshot]')); assert.equal(header.querySelector('[data-act=snapshot]').textContent, 'Send page snapshot');
  assert.ok(shadowAll(win, '[data-role=card-tools] [data-act=diag]')[0], 'same links on the preview panel');
  assert.ok(shadowAll(win, '[data-act=followup-markup]')[0], 'Mark up this page is in the follow-up box');
  assert.equal(shadowAll(win, '.feed')[0].getAttribute('data-chime'), 'ok', 'the finished-and-staged chime');
  assert.deepEqual(win.__notes.slice(0, 3), [523.25, 659.25, 783.99]);
  shadowAll(win, '[data-role=followup-text]')[0].value = 'The second image did not load';
  shadowAll(win, '[data-act=followup-send]')[0].click();
  await sleep(100);
  const sub = posted.find((p) => p.type === 'dw-ext-submit' && p.followUp === true);
  assert.ok(sub, 'dw-ext-submit with followUp:true');
  assert.equal(sub.note, 'The second image did not load');
  assert.equal(fu.style.display, 'none', 'box hidden while the follow-up runs');
  assert.equal(shadowAll(win, '[data-role=reply]').length, 1, 'the earlier reply stays on screen'); assert.equal(shadowAll(win, '[data-role=feed-user][data-follow]').length, 1);
});

test('editor: the mute switch is remembered and silences the chime', async () => {
  const { win } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-chunk', jobId: 'j1', seq: 1, text: 'Hi', files: [] });
  await sleep(50);
  const mute = shadowAll(win, '[data-act=mute]')[0];
  mute.click();                                                            // off -> muted
  assert.equal(win.localStorage.getItem('dw_ext_mute'), '1');
  win.__notes.length = 0;
  send(win, { type: 'dw-ext-done', jobId: 'j1', status: 'complete', text: 'Nothing to change.', files: [], blocks: [] });
  await sleep(200);
  assert.equal(shadowAll(win, '.feed')[0].getAttribute('data-chime'), 'muted');
  assert.equal(win.__notes.length, 0);
});

test('follow-up: Mark up this page brings back arrow, box and the other tools; Send includes the new screenshot', async () => {
  const { win, posted } = editor();
  await sleep(50);
  send(win, { type: 'dw-ext-ready', paired: true });
  send(win, { type: 'dw-ext-done', jobId: 'j1', status: 'complete', text: 'File: /index.html\n```html\n' + PAGE + '```', files: [], blocks: [{ label: 'File: /index.html', lang: 'html', code: PAGE }] });
  await sleep(300);
  const ctxStub = () => ({
    drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    closePath() {}, save() {}, restore() {}, translate() {}, scale() {}, setLineDash() {}, arc() {},
    bezierCurveTo() {}, quadraticCurveTo() {}, fillText() {}, strokeText() {}, rect() {}, clip() {},
    measureText: () => ({ width: 10 }), setTransform() {}, rotate() {},
    canvas: { width: 20, height: 10 },
    lineWidth: 1, strokeStyle: '', fillStyle: '', font: '', globalAlpha: 1, lineCap: '', lineJoin: ''
  });
  win.HTMLCanvasElement.prototype.getContext = function () { return ctxStub(); };
  win.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new win.Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: type || 'image/jpeg' })); };
  if (!win.URL.createObjectURL) win.URL.createObjectURL = () => 'blob:test';
  win.html2canvas = async () => { const c = win.document.createElement('canvas'); c.width = 20; c.height = 10; return c; };
  const mk = shadowAll(win, '[data-act=followup-markup]')[0];
  assert.ok(mk); assert.equal(mk.textContent, 'Mark up this page');
  mk.click();
  await sleep(50);
  const bar = shadowAll(win, '[role=toolbar]')[0] || win.document.getElementById('dw-markup-root').shadowRoot.querySelector('.bar');
  assert.ok(bar, 'markup toolbar is back');
  assert.deepEqual([...bar.querySelectorAll('[data-tool]')].map((b) => b.getAttribute('data-tool')), ['pen', 'arrow', 'box', 'text', 'highlight', 'pan']);
  assert.ok(bar.querySelector('[data-act=hide-markup]'), 'Hide tools, not a first-send Cancel/Send');
  assert.equal(mk.textContent, 'Hide markup tools');
  shadowAll(win, '[data-role=followup-text]')[0].value = 'Please move this box';
  shadowAll(win, '[data-act=followup-send]')[0].click();
  let sub = null;
  for (let i = 0; i < 25 && !sub; i++) { await sleep(50); sub = posted.find((p) => p.type === 'dw-ext-submit' && p.followUp === true); }
  const err = shadowAll(win, '[data-role=followup-msg]')[0];
  assert.ok(sub, 'follow-up was posted' + (err && err.textContent ? ' (' + err.textContent + ')' : '') + ' posted=' + posted.map((p) => p.type).join(','));
  assert.equal(sub.note, 'Please move this box');
  assert.match(sub.screenshot || '', /^data:image\/jpeg;base64,/);
  assert.ok(sub.element && typeof sub.element.capture === 'string');
  assert.equal(mk.isConnected ? mk.textContent : 'Mark up this page', 'Mark up this page', 'tools hide after send');
});
