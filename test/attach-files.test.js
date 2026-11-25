// v0.1.5: files the user attaches in the editor (picker / drag and drop) go to the AI with the screenshot and page files;
// the ones the reply names by path come back through the staged-preview flow. markup.js helpers come from the served file.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const P = require('../extension/lib/pagefiles.js');
const { runJob } = require('../extension/lib/runner.js');
const { bundled, mockChat } = require('./helpers.js');

const src = fs.readFileSync((fs.existsSync(path.join(__dirname, '../server/markup/markup.js')) ? path.join(__dirname, '../server/markup/markup.js') : path.join(__dirname, '../mock/markup.js')), 'utf8');
const grab = (name) => { const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(src); assert.ok(m, name); return m[0]; };
const grabVar = (name) => { const m = new RegExp('var ' + name + ' = [^\\n]*;').exec(src); assert.ok(m, name); return m[0]; };
const M = new Function('location', 'XT', 'brand', 'ui', 'el', [grabVar('XT_LIM'), grabVar('XT_MIME'), grabVar('XT_SAVE_TYPES'), grabVar('XT_LANG'), grabVar('XT_BLOCKED'), grabVar('XT_IMG_MIME'), 'var XT_ATT = [], XT_ATT_SEQ = 0;',
  grab('xtExt'), grab('xtBase'), grab('xtHtmlFrom'), grab('xtKind'), grab('xtDecodeText'), grab('xtMatchBlock'), grab('xtUpdatesFrom'), grab('xtCap'), grab('xtNamed'), grab('xtProse'), grab('xtAsIs'),
  grab('xtPagePath'), 'var XT_DRAFT_ATT_MAX = 1500000, XS_STORE = {}; function xsDel(k) { delete XS_STORE[k]; } function xsSetJson(k, v) { XS_STORE[k] = JSON.stringify(v); } function xsDraftSoon() {} function xtToDataUrl() { return Promise.reject(new Error("test")); }', grab('xtLooseSave'), grab('xtRemember'), grab('xtAttName'), grab('xtAttPath'), grab('xtAttAddOne'), grab('xtAttCheck'), grab('xtAttRender'),
  'function xtKB(n) { return n + " B"; }',
  'return { xtAttName, xtAttPath, xtAttAddOne, xtAttCheck, xtNamed, xtProse, xtAsIs, xtUpdatesFrom, xtRemember, att: () => XT_ATT, set: (v) => { XT_ATT = v; } };'].join('\n'))
  ({ href: 'https://example.com/site/', pathname: '/site/' }, { sent: null }, 'B1', {}, () => ({}));
const fobj = (name, size) => ({ name, size });

test('target path: blank is allowed (reference only); a folder gets the file name; type must match; blocked folders and traversal are refused', () => {
  const ok = (raw, name) => M.xtAttPath(raw, name);
  assert.deepEqual(ok('', 'a.png'), { path: '' });
  assert.deepEqual(ok('  ', 'a.png'), { path: '' });
  assert.deepEqual(ok('/images/new-logo.png', 'a.png'), { path: '/images/new-logo.png' });
  assert.deepEqual(ok('images/new-logo.png', 'a.png'), { path: '/images/new-logo.png' });
  assert.deepEqual(ok('/images/', 'a.png'), { path: '/images/a.png' });
  assert.deepEqual(ok('/x.jpeg', 'b.jpg'), { path: '/x.jpeg' });
  for (const bad of ['/images/a.jpg', '/a.png.exe', '/../a.png', '/a//b.png', '/images/a b.png', '/markup/a.png', '/_dw/a.png', '/files/x/a.png', '/lib/a.png', '/.well-known/a.png', '/images/.a.png', '/a.png?x=1', '/a\\b.png'])
    assert.ok(ok(bad, 'a.png').err, bad);
  assert.ok(ok('/' + 'a'.repeat(300) + '.png', 'a.png').err);
});
test('attach: only allowlisted types, 10 MB each, 10 files, 30 MB total; names made safe and unique', () => {
  M.set([]);
  assert.equal(M.xtAttAddOne(fobj('logo.png', 1000)), '');
  assert.equal(M.xtAttAddOne(fobj('logo.png', 1000)), '');
  assert.equal(M.xtAttAddOne(fobj('my file (1).css', 10)), '');
  assert.deepEqual(M.att().map((a) => a.name), ['logo.png', 'logo-2.png', 'my_file__1_.css']);
  assert.match(M.xtAttAddOne(fobj('run.exe', 10)), /not a supported type/);
  assert.match(M.xtAttAddOne(fobj('x.php', 10)), /not a supported type/);
  assert.match(M.xtAttAddOne(fobj('x.html.php', 10)), /not a supported type/);
  assert.match(M.xtAttAddOne(fobj('noext', 10)), /not a supported type/);
  assert.match(M.xtAttAddOne(fobj('big.png', 10 * 1024 * 1024 + 1)), /over 10 MB/);
  assert.match(M.xtAttAddOne(fobj('empty.css', 0)), /empty/);
  assert.equal(M.xtAttAddOne(fobj('doc.pdf', 5)), ''); assert.equal(M.xtAttAddOne(fobj('n.txt', 5)), '');
  M.set([]);
  for (let i = 0; i < 10; i++) assert.equal(M.xtAttAddOne(fobj('f' + i + '.png', 100)), '');
  assert.match(M.xtAttAddOne(fobj('one-more.png', 100)), /over the limit of 10 files/);
  M.set([]);
  for (let i = 0; i < 3; i++) assert.equal(M.xtAttAddOne(fobj('b' + i + '.png', 10 * 1024 * 1024)), '');
  assert.match(M.xtAttAddOne(fobj('b3.png', 1)), /30 MB/);
  M.set([]);
});
test('Send is blocked until every path is valid and unique', () => {
  M.set([]); M.xtAttAddOne(fobj('a.png', 5)); M.xtAttAddOne(fobj('b.png', 5)); M.xtAttAddOne(fobj('c.css', 5));
  assert.equal(M.xtAttCheck(), '');
  M.att()[0].path = '/images/x.png'; M.att()[1].path = '/images/x.png';
  assert.match(M.xtAttCheck(), /b\.png: two files have the same path/);
  M.att()[1].path = '/markup/y.png';
  assert.match(M.xtAttCheck(), /b\.png: that folder is not part of the site files/);
  M.att()[1].path = ''; M.att()[2].path = '/css/new.png';
  assert.match(M.xtAttCheck(), /c\.css: the path must end in the same type/);
  M.att()[2].path = '/css/new.css';
  assert.equal(M.xtAttCheck(), '');
  M.set([]);
});

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
  // caps: 10 files, 10 MB, 30 MB, shared with page files; attached first
  const many = []; for (let i = 0; i < 8; i++) many.push(att('u' + i + '.png', '/i/u' + i + '.png', PNG, 'image/png'));
  const lim = P.sanitizePageFiles(many.concat([pg('a.html', '/a.html', '<html>', 'text/html'), pg('b.css', '/b.css', 'a{}', 'text/css'), pg('c.js', '/c.js', 'var a', 'text/javascript')]), []);
  assert.equal(lim.files.length, 10); assert.equal(lim.files.filter((x) => x.attached).length, 8);
  assert.deepEqual(lim.skipped, [{ path: '/c.js', reason: 'limit' }]);
  const big = P.sanitizePageFiles([att('a.png', '/a.png', 'x'.repeat(10 * 1024 * 1024 + 1), 'image/png')], []);
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

// ---- the way back: what the reply names is staged ----
const CSS_OLD = 'h1{color:black}\n';
const mkSent = (extra) => {
  M.xtRemember([att('new-logo.png', '/images/new-logo.png', '\x89PNG\r\n\x1a\n0000', 'image/png'), att('ref.pdf', '', '%PDF-1.4', 'application/pdf'), att('new.css', '/css/new.css', CSS_OLD, 'text/css'), att('terms.pdf', '/docs/terms.pdf', '%PDF-1.4 x', 'application/pdf'),
    pg('site.css', '/css/site.css', 'h2{}', 'text/css')].concat(extra || []));
  return M.xtRemember.sent;
};
// xtRemember writes XT.sent; the test XT object is shared
const XTO = (() => { const m = /return \{ xtAttName/.exec(''); return null; })();
test('xtRemember keeps the user files (with their bytes) and never a file with no path', () => {
  const XT = { sent: null };
  const F = new Function('location', 'XT', 'brand', [grabVar('XT_LIM'), grabVar('XT_MIME'), grabVar('XT_SAVE_TYPES'), grabVar('XT_IMG_MIME'), grab('xtExt'), grab('xtBase'), grab('xtKind'), grab('xtDecodeText'), grab('xtPagePath'), 'var XT_DRAFT_ATT_MAX = 1500000, XS_STORE = {}; function xsDel(k) { delete XS_STORE[k]; } function xsSetJson(k, v) { XS_STORE[k] = JSON.stringify(v); } function xsDraftSoon() {} function xtToDataUrl() { return Promise.reject(new Error("test")); }', grab('xtLooseSave'), grab('xtRemember'), 'return xtRemember;'].join('\n'))({ href: 'https://example.com/site/', pathname: '/site/' }, XT, 'B1');
  F([att('new-logo.png', '/images/new-logo.png', '\x89PNG\r\n\x1a\n0000', 'image/png'), att('ref.pdf', '', '%PDF-1.4', 'application/pdf'), att('new.css', '/css/new.css', CSS_OLD, 'text/css'), pg('site.css', '/css/site.css', 'h2{}', 'text/css')]);
  assert.deepEqual(XT.sent.map((s) => [s.path, s.kind, !!s.attach]), [['/site/index.html', 'html', false], ['/images/new-logo.png', 'img', true], ['/css/new.css', 'css', true], ['/css/site.css', 'css', false]]);
  assert.equal(XT.sent[2].text, CSS_OLD); assert.match(XT.sent[1].dataUrl, /^data:image\/png;base64,/);
});
const SENT2 = [
  { path: '/site/index.html', name: 'index.html', base: 'index.html', kind: 'html', page: true, text: '<html><body><h1>Old</h1></body></html>\n' },
  { path: '/images/new-logo.png', name: 'new-logo.png', base: 'new-logo.png', kind: 'img', page: false, text: null, attach: true, dataUrl: du('image/png', '\x89PNG\r\n\x1a\n0000') },
  { path: '/css/new.css', name: 'new.css', base: 'new.css', kind: 'css', page: false, attach: true, text: CSS_OLD, dataUrl: du('text/css', CSS_OLD) },
  { path: '/docs/terms.pdf', name: 'terms.pdf', base: 'terms.pdf', kind: 'pdf', page: false, text: null, attach: true, dataUrl: du('application/pdf', '%PDF-1.4 x') },
  { path: '/css/site.css', name: 'site.css', base: 'site.css', kind: 'css', page: false, text: 'h2{}' }
];
test('a path is "named" only when it stands alone in the reply words', () => {
  const n = M.xtNamed;
  assert.ok(n('File: /images/new-logo.png', '/images/new-logo.png'));
  assert.ok(n('Use /images/new-logo.png.', '/images/new-logo.png'));
  assert.ok(n('Use `/images/new-logo.png`, as is', '/images/new-logo.png'));
  assert.ok(n('(/images/new-logo.png)', '/images/new-logo.png'));
  assert.ok(!n('File: /site/images/new-logo.png', '/images/new-logo.png'));
  assert.ok(!n('File: /images/new-logo.png.bak', '/images/new-logo.png'));
  assert.ok(!n('File: /images/new-logo.png2', '/images/new-logo.png'));
  assert.ok(!n('File: /images/new-logo.pngx', '/images/new-logo.png'));
  assert.ok(!n('File: new-logo.png', '/images/new-logo.png'));
  assert.ok(!n('', '/images/new-logo.png'));
});
test('as-is: the reply names an attached file with no code -> staged from the original bytes; unnamed paths are never staged', () => {
  const have = {};
  const out = M.xtAsIs({ text: 'Done. File: /images/new-logo.png (use as-is). Also File: /docs/terms.pdf', blocks: [] }, SENT2, have);
  assert.deepEqual(out.map((u) => u.file.path), ['/images/new-logo.png', '/docs/terms.pdf']);
  assert.equal(Buffer.from(out[0].content.b64, 'base64').subarray(1, 4).toString(), 'PNG'); assert.ok(out[0].asis);
  assert.ok(out[1].size >= 10 && out[1].size <= 12);
  // not named -> nothing, even if the AI's page code refers to it
  const html = '<html><body><img src="/images/new-logo.png"></body></html>';
  assert.deepEqual(M.xtAsIs({ text: 'Here is the page.\n' + html, blocks: [{ label: 'File: /site/index.html', lang: 'html', code: html }] }, SENT2, {}), []);
  assert.deepEqual(M.xtAsIs({ text: 'I changed the heading.', blocks: [] }, SENT2, {}), []);
  // a file that is not in the sent list (reference-only or unknown) can never be staged
  assert.deepEqual(M.xtAsIs({ text: 'File: /admin/x.png and File: ref.pdf and File: /css/site.css', blocks: [] }, SENT2, {}), []);
  // a page file (not attached) named in the reply with no code is not staged from bytes either
  assert.deepEqual(M.xtAsIs({ text: 'File: /css/site.css', blocks: [] }, SENT2, {}), []);
  // already returned as code: not doubled
  const have2 = { '/css/new.css': 1 };
  assert.deepEqual(M.xtAsIs({ text: 'File: /css/new.css', blocks: [] }, SENT2, have2), []);
  // text attachment as-is
  const t = M.xtAsIs({ text: 'File: /css/new.css as it is', blocks: [] }, SENT2, {});
  assert.equal(t[0].content, CSS_OLD);
});
test('as-is: the code of a returned block does not count as naming a path', () => {
  const code = 'img{background:url(/images/new-logo.png)}\n/* File: /images/new-logo.png */';
  assert.match(M.xtProse({ text: 'Updated.\n' + code, blocks: [{ label: 'x', lang: 'css', code }] }), /^Updated\.\s*$/);
  assert.deepEqual(M.xtAsIs({ text: 'Updated.\n' + code, blocks: [{ label: 'File: /css/site.css', lang: 'css', code }] }, SENT2, {}), []);
});
test('the AI can return a changed copy of a user file, even if it equals the upload; user html may be a fragment', () => {
  const u = M.xtUpdatesFrom({ blocks: [{ label: 'File: /css/new.css', lang: 'css', code: CSS_OLD }, { label: 'File: /css/site.css', lang: 'css', code: 'h2{}' }] }, SENT2);
  assert.deepEqual(u.map((x) => x.file.path), ['/css/new.css']);               // unchanged page files are still skipped
  const frag = M.xtUpdatesFrom({ blocks: [{ label: 'File: /parts/nav.html', lang: 'html', code: '<nav>x</nav>' }] }, SENT2.concat([{ path: '/parts/nav.html', name: 'nav.html', base: 'nav.html', kind: 'html', page: false, attach: true, text: '<nav>y</nav>' }]));
  assert.deepEqual(frag.map((x) => x.file.path), ['/parts/nav.html']);
  const pdf = M.xtUpdatesFrom({ blocks: [{ label: 'File: /docs/terms.pdf', lang: '', code: 'data:application/pdf;base64,' + b64('%PDF-1.7 y') }] }, SENT2);
  assert.deepEqual(pdf.map((x) => x.file.path), ['/docs/terms.pdf']);
  const wrong = M.xtUpdatesFrom({ blocks: [{ label: 'File: /docs/terms.pdf', lang: '', code: 'data:image/png;base64,' + b64('%PDF-1.7 y') }] }, SENT2);
  assert.deepEqual(wrong, []);
});
test('markup.js: attachments ride dw-ext-submit; staging still only via a=files (create staging:true)', () => {
  assert.match(src, /msg\.files = all; msg\.skipped = c \? c\.skipped : \[\];/);
  assert.match(src, /attached: true/);
  assert.match(src, /on\(window, 'drop', xtDrop\)/);
  assert.match(src, /data-role': 'attach-btn'/); assert.match(src, /data-role': 'att-remove'/); assert.match(src, /data-role': 'att-path'/);
  assert.match(src, /type: 'file', multiple: 'multiple'/);
  assert.match(src, /var attErr = xtAttCheck\(\);/);
  assert.match(src, /action: 'create', staging: true, file_name: t\.file_name, file_path: t\.file_path/);
  assert.doesNotMatch(src, /action: 'create', file_name|action: 'create', staging: false|staging: false/);
  // create (staged, body above), publish_staging (xtPublishBody), discard_staging and (v0.1.13) extend_staging only
  const acts = (src.match(/xtCall\(\{ action: '([a-z_]+)'/g) || []).map((m) => /'([a-z_]+)'/.exec(m)[1]);
  assert.equal((src.match(/xtCall\(\{/g) || []).length, acts.length);
  assert.ok(acts.length >= 2 && acts.every((a) => a === 'discard_staging' || a === 'extend_staging'), acts.join());
  assert.equal((src.match(/return xtCall\(body\)/g) || []).length, 1);
  assert.equal((src.match(/xtCall\(/g) || []).length, acts.length + 3);   // + the definition, body, xtPublishBody
  assert.match(src, /var body = \{ action: 'publish_staging', id: it\.id \};/);
  assert.doesNotMatch(src, /fetch\(q\('\?a=files'\)[^;]*\);\s*\n[^\n]*attach/);
});
