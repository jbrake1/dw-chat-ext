const test = require('node:test'), assert = require('node:assert');
const { runJob } = require('../extension/lib/runner.js');
const I = require('../extension/lib/interpreter.js');
const { geminiInstr, mockGemini, sleep } = require('./helpers.js');

function fast() {
  const i = geminiInstr();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 80 }];
  i.stream.emitMinIntervalMs = 0;
  i.stream.startTimeoutMs = 400;
  i.stream.pollMs = 99999;           // do not let the poll hide a missed MutationObserver
  i.stream.noReplyGraceMs = 200;
  i.stream.recoverStableMs = 80;
  i.steps.attach.confirm.timeoutMs = 2000;
  (i.steps.attach.strategies || []).forEach((s) => { if (s.confirmMs) s.confirmMs = 400; });
  i.steps.send.timeoutMs = 2000;
  i.steps.prompt.timeoutMs = 2000;
  i.steps.newChat.timeoutMs = 2000;
  return i;
}
const JOB = () => ({ prompt: 'Please update the page', file: null, files: [] });
const collect = () => { const ev = []; return { ev, emit: (e) => ev.push(e) }; };

function addShadowReply(win, html) {
  const host = win.document.createElement('div');
  host.id = 'shadow-host';
  win.document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

test('v0.1.15: assistant replies inside a shadow root are found (light-DOM query would miss them)', async () => {
  const win = await mockGemini('?speed=5&tokens=8&noreply=1');
  // A finished reply lives only in a shadow tree, as on some Gemini layouts.
  addShadowReply(win, '<model-response><message-content class="model-response-text"><div class="markdown">File: /index.html\n```html\n<!doctype html><html><body><h1>Recovered</h1></body></html>\n```\nThat is all.</div></message-content></model-response>');
  const nLight = win.document.querySelectorAll('model-response').length;
  assert.equal(nLight, 0, 'the light DOM has no model-response');
  const st = I.readState(win, win.document, geminiInstr(), 0, null);
  assert.equal(st.newMessage, true);
  assert.match(st.text, /Recovered/);
});

test('v0.1.15: on no_stream the runner rescans; a reply that appeared only in a shadow root is recovered instead of an error', async () => {
  const win = await mockGemini('?speed=5&tokens=8&noreply=1');
  const { ev, emit } = collect();
  // Attach an empty shadow host first so later mutations stay inside the shadow (the document observer will not see them).
  const root = addShadowReply(win, '');
  const job = runJob(win, fast(), JOB(), { emit });
  await sleep(80);
  root.innerHTML = '<model-response><message-content class="model-response-text"><div class="markdown">OK. Gemini got your request.\n\nFile: /index.html\n```html\n<!doctype html><html><body><p>Late</p></body></html>\n```\nThat is all.</div></message-content></model-response>';
  const res = await job.promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  const rec = ev.find((e) => e.step === 'stream' && e.detail && e.detail.recovered);
  assert.ok(rec, 'stream step is marked recovered');
  assert.equal(rec.detail.how, 'no_stream');
  const done = ev.find((e) => e.kind === 'done');
  assert.ok(done);
  assert.match(done.text, /Late|got your request/);
  assert.equal(ev.some((e) => e.code === 'no_stream'), false);
});

test('v0.1.15: a response-container (no model-response tag) is read with the rev 5 selectors', () => {
  const { JSDOM } = require('jsdom');
  const d = new JSDOM('<!doctype html><html><body><response-container aria-label="Gemini response"><div class="markdown">Hello from a new layout</div></response-container></body></html>', { url: 'https://gemini.google.com/app/abc123' });
  const st = I.readState(d.window, d.window.document, geminiInstr(), 0, null);
  assert.equal(st.newMessage, true);
  assert.match(st.text, /Hello from a new layout/);
});
