// v0.1.9: the page-world upload hook (content/ai-hook.js). It only acts while armed, once, and never opens the OS chooser then.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const { polyfill, sleep, root } = require('./helpers.js');
const SRC = fs.readFileSync(path.join(root, 'extension/content/ai-hook.js'), 'utf8');

function page() {
  const d = new JSDOM('<!doctype html><body></body>', { url: 'https://gemini.google.com/app', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = polyfill(d.window);
  win.__realClicks = 0;
  win.HTMLInputElement.prototype.click = function () { win.__realClicks++; };       // stands in for "opens the OS file chooser"
  win.eval(SRC);
  win.__replies = [];
  win.addEventListener('message', (e) => { if (e.data && e.data.source === 'dw-ext-hook-reply') win.__replies.push(e.data.type); });
  return win;
}
const post = (win, m) => win.postMessage(Object.assign({ source: 'dw-ext-hook' }, m), 'https://gemini.google.com');
const mkFile = (win, n) => new win.File(['x'], n, { type: 'text/plain' });

test('not armed: input.click() is the page\'s own (nothing is touched)', async () => {
  const win = page();
  const inp = win.document.createElement('input'); inp.type = 'file';
  let changed = 0; inp.addEventListener('change', () => changed++);
  inp.click();
  await sleep(30);
  assert.equal(win.__realClicks, 1); assert.equal(changed, 0);
});

test('armed: the next file-input click gets the files (input + change, after click returns), no chooser, and it disarms', async () => {
  const win = page();
  post(win, { type: 'ping' }); post(win, { type: 'arm', files: [mkFile(win, 'a.html'), mkFile(win, 'b.css')], ttlMs: 3000 });
  await sleep(30);
  assert.deepEqual(win.__replies, ['pong', 'armed']);
  const inp = win.document.createElement('input'); inp.type = 'file';
  const got = [];
  inp.click();                                                                      // the site adds its listener AFTER click()
  inp.addEventListener('change', () => got.push(Array.from(inp.files).map((f) => f.name)));
  await sleep(30);
  assert.deepEqual(got, [['a.html', 'b.css']]);
  assert.equal(win.__realClicks, 0); assert.ok(win.__replies.includes('fired'));
  const inp2 = win.document.createElement('input'); inp2.type = 'file'; inp2.click();
  assert.equal(win.__realClicks, 1, 'one shot');
});

test('armed: a click on a non-file input or a checkbox is left alone; disarm and the ttl cancel it', async () => {
  const win = page();
  post(win, { type: 'arm', files: [mkFile(win, 'a')], ttlMs: 1000 }); await sleep(20);
  const cb = win.document.createElement('input'); cb.type = 'checkbox'; cb.click();
  assert.equal(win.__realClicks, 1);
  post(win, { type: 'disarm' }); await sleep(20);
  const f = win.document.createElement('input'); f.type = 'file'; f.click();
  assert.equal(win.__realClicks, 2);
});

test('messages from another source or without the marker are ignored', async () => {
  const win = page();
  win.postMessage({ type: 'arm', files: [mkFile(win, 'a')] }, '*');
  win.postMessage({ source: 'other', type: 'arm', files: [mkFile(win, 'a')] }, '*');
  await sleep(20);
  const f = win.document.createElement('input'); f.type = 'file'; f.click();
  assert.equal(win.__realClicks, 1);
});

test('manifest injects it into gemini.google.com only, in the page world, at document_start; the SW can inject it into open tabs', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const cs = m.content_scripts.find((c) => c.js.includes('content/ai-hook.js'));
  assert.deepEqual(cs.matches, ['https://gemini.google.com/*']); assert.equal(cs.world, 'MAIN'); assert.equal(cs.run_at, 'document_start');
  const sw = fs.readFileSync(path.join(root, 'extension/background/sw.js'), 'utf8');
  assert.match(sw, /case 'gpt:hook'/); assert.match(sw, /content\/ai-hook\.js'\], world: 'MAIN'/);
  assert.ok(!/fetch\(|XMLHttpRequest|sendMessage|chrome\./.test(fs.readFileSync(path.join(root, 'extension/content/ai-hook.js'), 'utf8')), 'the hook talks to nothing');
});
