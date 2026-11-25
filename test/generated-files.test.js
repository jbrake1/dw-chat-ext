// v0.1.12: files the AI made and showed as download chips (Gemini code execution). The failure this fixes: the reply's
// HTML linked assets/img/hanalei-taro-1600.webp/.jpg, the two files only existed as chips, nothing staged them, the
// published page showed a broken picture.
const test = require('node:test'), assert = require('node:assert');
const A = require('../extension/lib/assets.js');
const { runJob } = require('../extension/lib/runner.js');
const { geminiInstr, mockGemini, sleep, dom } = require('./helpers.js');

const SHOT = { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
function fast() {
  const i = geminiInstr();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.stream.noReplyGraceMs = 600;
  i.steps.attach.confirm.timeoutMs = 2000; i.steps.attach.strategies.forEach((s) => { if (s.confirmMs) s.confirmMs = 600; }); i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000; i.steps.newChat.timeoutMs = 2000;
  i.steps.files.generated.captureMs = 1500; i.steps.files.generated.fetchMs = 1500;
  return i;
}
const withFetch = (win) => { win.fetch = (u, o) => globalThis.fetch(u, o); return win; };

test('bytes must match the name: webp/png/jpg/gif/pdf magic, text must be UTF-8', () => {
  assert.equal(A.bytesMatch('a.webp', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0])), true);
  assert.equal(A.bytesMatch('a.webp', new Uint8Array([0xFF, 0xD8, 0xFF, 0, 0])), false);
  assert.equal(A.bytesMatch('a.jpg', new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])), true);
  assert.equal(A.bytesMatch('a.png', new Uint8Array([0x89, 0x50, 0x4E, 0x47])), true);
  assert.equal(A.bytesMatch('a.css', new TextEncoder().encode('h1{color:red}')), true);
  assert.equal(A.bytesMatch('a.css', new Uint8Array([0x68, 0, 0x31])), false);
  assert.equal(A.assetName('x.exe'), ''); assert.equal(A.assetName('../../etc/passwd'), ''); assert.equal(A.assetName('/assets/img/a b.webp'), 'a-b.webp');
});

test('chips are found by a whole-text file name or a selector; a name inside code or prose is not a chip', () => {
  const win = dom('<model-response><message-content><div class="markdown"><p>Save it as <code>hanalei-taro-1600.webp</code> in /assets/img/hanalei-taro-1600.webp.</p><p><strong>site.css</strong></p><pre><code>logo.png</code></pre></div>' +
    '<div class="files"><div class="tile"><span>hanalei-taro-1600.webp</span><button aria-label="Download file">download</button></div><a download="menu.css" href="data:text/css,a">x</a></div></message-content></model-response>', { url: 'https://gemini.google.com/app' });
  const cfg = geminiInstr().steps.files.generated;
  const chips = A.findChips(win, win.document.querySelector('model-response'), cfg);
  assert.deepEqual(chips.map((c) => c.name).sort(), ['hanalei-taro-1600.webp', 'menu.css']);
  const tile = chips.find((c) => c.name === 'hanalei-taro-1600.webp').el;
  assert.equal(tile.className, 'tile', 'the chip box is the tile, not the whole file list');
});

test('full relay against mock Gemini with download chips: the done event carries the files, a Share button is never clicked', async () => {
  const win = withFetch(await mockGemini('?speed=5&tokens=8&chips=1'));
  const ev = []; const emit = (e) => ev.push(e);
  const res = await runJob(win, fast(), { prompt: 'Add the taro photo to the hero', file: SHOT, files: [] }, { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  const done = ev.find((e) => e.kind === 'done');
  assert.ok(done, 'done emitted');
  const got = Object.fromEntries((done.assets || []).map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(got).sort(), ['hanalei-taro-1600.jpg', 'hanalei-taro-1600.webp']);
  assert.equal(got['hanalei-taro-1600.webp'].via, 'download'); assert.equal(got['hanalei-taro-1600.webp'].mime, 'image/webp');
  assert.equal(Buffer.from(got['hanalei-taro-1600.webp'].b64, 'base64').slice(8, 12).toString(), 'WEBP');
  assert.equal(got['hanalei-taro-1600.jpg'].via, 'link');
  assert.equal(win.__downloads, 1, 'clicked the chip\'s own download button once');
  assert.deepEqual(done.assetsMissed.names, [{ name: 'notes.txt', why: 'no_link' }], 'the chip with only a Share button is reported, not clicked');
  assert.equal(done.assetsMissed.tags, 1, '[file-tag: ...] left in the reply text is counted');
  const step = ev.find((e) => e.kind === 'step' && e.step === 'assets');
  assert.deepEqual(step.detail, { got: 2, missed: 1, tags: 1 });
  assert.ok(ev.indexOf(step) < ev.indexOf(done));
  assert.deepEqual(win.__forbidden, [], 'never touched Share, the model picker, Upgrade or the OS chooser');
});

test('no chips: the done event is not delayed and carries no assets', async () => {
  const win = withFetch(await mockGemini('?speed=5&tokens=8'));
  const ev = []; const emit = (e) => ev.push(e);
  const t0 = Date.now();
  const res = await runJob(win, fast(), { prompt: 'Change the headline', file: SHOT, files: [] }, { emit }).promise;
  assert.equal(res.ok, true);
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(done.assets.length, 0); assert.equal(done.assetsMissed, undefined);
  assert.ok(Date.now() - t0 < 8000);
});
