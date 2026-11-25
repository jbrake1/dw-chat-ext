// v0.1.5: files the user attaches in the DW editor are re-checked by the extension (same allowlist and caps as page
// files, counted first), listed in the prompt with their intended path, and uploaded in the same message.
const test = require('node:test'), assert = require('node:assert');
const P = require('../extension/lib/pagefiles.js');
const { runJob } = require('../extension/lib/runner.js');
const { bundled, mockChat } = require('./helpers.js');
const b64 = (s) => Buffer.from(s, 'latin1').toString('base64');
const du = (mime, body) => 'data:' + mime + ';base64,' + b64(body);
const att = (name, p, body, mime) => ({ name, path: p, mime, size: body.length, dataUrl: du(mime, body), attached: true });
const pg = (name, p, body, mime) => ({ name, path: p, mime, size: body.length, dataUrl: du(mime, body) });

test('extension: attached files use the same allowlist and caps, counted before the page files; the page cannot fake an attachment', () => {
  const PNG = '\x89PNG\r\n\x1a\n0000';
  const r = P.sanitizePageFiles([
    att('new-logo.png', '/images/new-logo.png', PNG, 'image/png'),
    att('notes.pdf', '', '%PDF-1.4', 'application/pdf'),
    att('x.css', '/css/x.css', 'a{}', 'text/css'),
    pg('index.html', '/index.html', '<html></html>', 'text/html'),
    pg('ref.txt', '', 'no flag', 'text/plain')                          // a page file with no path and no attached flag is dropped
  ], []);
  assert.deepEqual(r.files.map((x) => [x.name, x.path, x.type, x.attached]), [
    ['new-logo.png', '/images/new-logo.png', 'image/png', true], ['notes.pdf', '', 'application/pdf', true], ['x.css', '/css/x.css', 'text/css', true], ['index.html', '/index.html', 'text/html', false]]);
  assert.deepEqual(r.skipped.map((s) => s.reason), ['type']);
  // type / path rules
  const bad = P.sanitizePageFiles([att('a.exe', '/a.exe', 'x', 'application/x-msdownload'), att('a.png', '/a.jpg', PNG, 'image/png'), att('a.png', '/markup/../a.png', PNG, 'image/png'), att('a.php', '', 'x', 'text/plain'), { name: 'a.png', path: '', dataUrl: du('image/png', PNG), attached: 'yes' }], []);
  assert.deepEqual(bad.files, []);
  // caps: 10 files, 2 MB, 6 MB, shared with page files; attached first
  const many = []; for (let i = 0; i < 8; i++) many.push(att('u' + i + '.png', '/i/u' + i + '.png', PNG, 'image/png'));
  const lim = P.sanitizePageFiles(many.concat([pg('a.html', '/a.html', '<html>', 'text/html'), pg('b.css', '/b.css', 'a{}', 'text/css'), pg('c.js', '/c.js', 'var a', 'text/javascript')]), []);
  assert.equal(lim.files.length, 10); assert.equal(lim.files.filter((x) => x.attached).length, 8);
  assert.deepEqual(lim.skipped, [{ path: '/c.js', reason: 'limit' }]);
  const big = P.sanitizePageFiles([att('a.png', '/a.png', 'x'.repeat(2 * 1024 * 1024 + 1), 'image/png')], []);
  assert.deepEqual(big.skipped, [{ path: '/a.png', reason: 'too_large' }]);
  // an attached file replaces the page's own copy of the same path
  const dup = P.sanitizePageFiles([att('site.css', '/css/site.css', 'a{}', 'text/css'), pg('site-2.css', '/css/site.css', 'b{}', 'text/css')], []);
  assert.deepEqual(dup.files.map((x) => x.name), ['site.css']); assert.deepEqual(dup.skipped, [{ path: '/css/site.css', reason: 'duplicate' }]);
});
test('prompt: each attached file is listed with its intended path, and the reply format is explained', () => {
  const r = P.sanitizePageFiles([att('new-logo.png', '/images/new-logo.png', '\x89PNG....', 'image/png'), att('brief.pdf', '', '%PDF-1', 'application/pdf'), pg('index.html', '/index.html', '<html></html>', 'text/html')], []);
  const t = P.filesPrompt(r.files, r.skipped, 'markup.jpg');
  assert.match(t, /- new-logo\.png: a file I am adding, to be put on the site at \/images\/new-logo\.png \(image\/png/);
  assert.match(t, /- brief\.pdf: a file I uploaded for you to look at, not for the site \(application\/pdf/);
  assert.match(t, /- index\.html: current source of \/index\.html/);
  assert.match(t, /write a line "File: \/images\/new-logo\.png"/);
  assert.match(t, /for a picture, PDF or other binary file that line is all that is needed/);
  assert.match(t, /example "File: \/index\.html"/);
  // only attached files: no page-file instructions
  const only = P.filesPrompt(P.sanitizePageFiles([att('a.css', '/css/a.css', 'a{}', 'text/css')], []).files, [], 'markup.jpg');
  assert.doesNotMatch(only, /current source of/); assert.match(only, /File: \/css\/a\.css/);
  // page files only: unchanged from v0.1.4
  assert.doesNotMatch(P.filesPrompt(P.sanitizePageFiles([pg('index.html', '/index.html', '<html></html>', 'text/html')], []).files, [], 'markup.jpg'), /a file I am adding/);
});
test('runner uploads the screenshot, the user files and the page files in ONE message (pdf too)', async () => {
  const win = await mockChat('?speed=5&tokens=12');
  const i = bundled();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.steps.attach.confirm.timeoutMs = 2000; i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000;
  const r = P.sanitizePageFiles([att('new-logo.png', '/images/new-logo.png', '\x89PNG\r\n\x1a\n0000', 'image/png'), att('brief.pdf', '', '%PDF-1.4', 'application/pdf'), pg('index.html', '/index.html', '<html></html>', 'text/html')], []);
  const job = { prompt: 'Use my logo' + P.filesPrompt(r.files, r.skipped, 'markup.jpg'), file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }, files: r.files };
  const ev = [];
  const res = await runJob(win, i, job, { emit: (e) => ev.push(e) }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.equal(win.__received.length, 1);
  assert.deepEqual(win.__received[0].files.map((x) => x.name + ':' + x.type), ['markup.jpg:image/jpeg', 'new-logo.png:image/png', 'brief.pdf:application/pdf', 'index.html:text/html']);
  assert.match(win.__received[0].text, /new-logo\.png: a file I am adding, to be put on the site at \/images\/new-logo\.png/);
});

