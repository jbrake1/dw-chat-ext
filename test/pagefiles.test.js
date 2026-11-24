// Page source files sent with a Suggest an edit request (v0.1.3): validation of the untrusted page input,
// the prompt text, and a multi-file upload through the runner against the mock ChatGPT page.
const test = require('node:test'), assert = require('node:assert');
const P = require('../extension/lib/pagefiles.js');
const { runJob } = require('../extension/lib/runner.js');
const { bundled, mockChat } = require('./helpers.js');

const b64 = (s) => Buffer.from(s).toString('base64');
const f = (name, path, body, mime) => ({ name, path, mime: mime || 'text/plain', size: body.length, dataUrl: 'data:' + (mime || 'text/html') + ';base64,' + b64(body) });

test('keeps allowlisted files, takes the mime from the file extension, never from the page', () => {
  const r = P.sanitizePageFiles([
    f('index.html', '/index.html', '<!doctype html><h1>Hi</h1>', 'text/html'),
    f('site.css', '/css/site.css', 'h1{color:red}', 'application/x-evil'),
    f('menu.js', '/menu.js', 'console.log(1)', 'text/javascript'),
    f('logo.png', '/img/logo.png', '\x89PNG', 'image/png')
  ], []);
  assert.deepEqual(r.files.map((x) => [x.name, x.path, x.type]), [['index.html', '/index.html', 'text/html'], ['site.css', '/css/site.css', 'text/css'], ['menu.js', '/menu.js', 'text/javascript'], ['logo.png', '/img/logo.png', 'image/png']]);
  assert.match(r.files[1].dataUrl, /^data:text\/css;base64,/);
  assert.equal(r.files[0].size, '<!doctype html><h1>Hi</h1>'.length);
  assert.deepEqual(r.skipped, []);
});

test('drops unsafe names, traversal paths, unknown types and non-base64 data', () => {
  const r = P.sanitizePageFiles([
    f('../etc.html', '/etc.html', 'x'),
    f('ok.html', '/a/../b.html', 'x'),
    f('evil.exe', '/evil.exe', 'MZ'),
    f('page.php', '/page.php', '<?php'),
    { name: 'x.html', path: '/x.html', dataUrl: 'data:text/html,<b>raw</b>' },
    { name: 'y.html', path: '/y.html', dataUrl: 'javascript:alert(1)' },
    f('a b.html', '/a b.html', 'x'),
    f('fine.css', 'relative/fine.css', 'x')
  ], []);
  assert.equal(r.files.length, 0);
  assert.ok(r.skipped.every((s) => s.reason === 'type'), JSON.stringify(r.skipped));
});

test('enforces per-file, total and count caps and lists what was skipped', () => {
  const big = 'a'.repeat(P.PAGE_FILE_LIMITS.maxFileBytes + 1);
  const r1 = P.sanitizePageFiles([f('big.js', '/big.js', big)], []);
  assert.equal(r1.files.length, 0); assert.deepEqual(r1.skipped, [{ path: '/big.js', reason: 'too_large' }]);
  const many = Array.from({ length: 14 }, (_, i) => f('f' + i + '.css', '/f' + i + '.css', 'x'));
  const r2 = P.sanitizePageFiles(many, []);
  assert.equal(r2.files.length, P.PAGE_FILE_LIMITS.maxFiles);
  assert.equal(r2.skipped.filter((s) => s.reason === 'limit').length, 4);
  const r3 = P.sanitizePageFiles([f('a.js', '/a.js', 'x'.repeat(5000)), f('b.js', '/b.js', 'y'.repeat(5000))], [], { limits: { maxTotalBytes: 8000 } });
  assert.deepEqual(r3.files.map((x) => x.name), ['a.js']); assert.equal(r3.skipped[0].reason, 'limit');
});

test('renames clashing names, never reuses the screenshot name, drops duplicate paths', () => {
  const r = P.sanitizePageFiles([f('index.html', '/index.html', 'a'), f('index.html', '/blog/index.html', 'b'), f('index.html', '/index.html', 'c'), f('markup.jpg', '/img/markup.jpg', 'd', 'image/jpeg')], [], { reserved: ['markup.jpg'] });
  assert.deepEqual(r.files.map((x) => x.name + '=' + x.path), ['index.html=/index.html', 'index-2.html=/blog/index.html', 'markup-2.jpg=/img/markup.jpg']);
  assert.deepEqual(r.skipped, [{ path: '/index.html', reason: 'duplicate' }]);
});

test('page skip list is filtered to known reasons and safe paths', () => {
  const r = P.sanitizePageFiles([], [{ path: '/fonts.googleapis.com/css2', reason: 'third_party' }, { path: '/x.js', reason: '<script>' }, { path: 'javascript:1', reason: 'limit' }]);
  assert.deepEqual(r.skipped, [{ path: '/fonts.googleapis.com/css2', reason: 'third_party' }, { path: '(unnamed)', reason: 'limit' }]);
});

test('prompt lists every attached file and asks for complete files with the same names and paths', () => {
  const r = P.sanitizePageFiles([f('index.html', '/editor-ai/index.html', '<html></html>'), f('site.css', '/css/site.css', 'a{}')], [{ path: '/img/huge.png', reason: 'too_large' }]);
  const t = P.filesPrompt(r.files, r.skipped, 'markup.jpg');
  assert.match(t, /markup\.jpg: the screenshot/);
  assert.match(t, /index\.html: current source of \/editor-ai\/index\.html \(text\/html/);
  assert.match(t, /site\.css: current source of \/css\/site\.css/);
  assert.match(t, /Not attached:\n- \/img\/huge\.png \(too large\)/);
  assert.match(t, /COMPLETE updated file/); assert.match(t, /same file names and paths/);
  assert.equal(P.filesPrompt([], [], 'markup.jpg'), '');
});

test('runner uploads the screenshot and every page file in ONE message', async () => {
  const win = await mockChat('?speed=5&tokens=12');
  const i = bundled();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.steps.attach.confirm.timeoutMs = 2000; i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000;
  const page = P.sanitizePageFiles([f('index.html', '/index.html', '<!doctype html><html><body><h1>Old</h1></body></html>'), f('site.css', '/css/site.css', 'h1{}')], []);
  const job = { prompt: 'Change the headline' + P.filesPrompt(page.files, page.skipped, 'markup.jpg'), file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }, files: page.files };
  const ev = [];
  const res = await runJob(win, i, job, { emit: (e) => ev.push(e) }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.equal(win.__received.length, 1);
  assert.deepEqual(win.__received[0].files.map((x) => x.name + ':' + x.type), ['markup.jpg:image/jpeg', 'index.html:text/html', 'site.css:text/css']);
  assert.match(win.__received[0].text, /index\.html: current source of \/index\.html/);
  const at = ev.find((e) => e.step === 'attach');
  assert.equal(at.detail.count, 3); assert.equal(at.detail.pageFiles, 2); assert.equal(at.detail.shown, 3);
  assert.match(ev.find((e) => e.kind === 'done').text, /Also 2 more files: index\.html, site\.css/);
});

test('runner still attaches page files with the paste fallback (no file input)', async () => {
  const win = await mockChat('?speed=5&tokens=10&fileinput=0');
  const i = bundled();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.steps.attach.confirm.timeoutMs = 2000; i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000;
  const page = P.sanitizePageFiles([f('index.html', '/index.html', '<html></html>')], []);
  const res = await runJob(win, i, { prompt: 'x', file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' }, files: page.files }, { emit: () => {} }).promise;
  assert.equal(res.ok, true);
  assert.deepEqual(win.__received[0].files.map((x) => x.name), ['markup.jpg', 'index.html']);
});
