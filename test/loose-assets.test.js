// v0.1.12: a picture attached with no path that the AI's page now uses is staged where the page points (the broken
// second hero image: the reply named assets/img/<new name>.jpg/.webp, the attached photo was never saved).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync((fs.existsSync(path.join(__dirname, '../server/markup/markup.js')) ? path.join(__dirname, '../server/markup/markup.js') : path.join(__dirname, '../mock/markup.js')), 'utf8');
const grab = (name) => { const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(src); assert.ok(m, name); return m[0]; };
const grabVar = (name) => { const m = new RegExp('var ' + name + ' = [^\\n]*;').exec(src); assert.ok(m, name); return m[0]; };
function make(env) {
  const body = [grabVar('XT_LIM'), grabVar('XT_BLOCKED'), grabVar('XT_IMG_MIME'), grabVar('XT_STOP'), 'var seen404 = [];',
    grab('xtExt'), grab('xtBase'), grab('xtTokens'), grab('xtResolveRef'), grab('xtPictureRefs'), grab('xtPictureExists'), grab('xtPickLoose'), grab('xtImageFrom'), grab('xtMakePicture'), grab('xtLooseAssets'),
    'function xtToDataUrl(b) { return Promise.resolve("data:" + b.type + ";base64,QUJD"); }',
    'return { xtTokens, xtResolveRef, xtPictureRefs, xtPickLoose, xtMakePicture, xtLooseAssets };'].join('\n');
  return new Function('location', 'fetch', 'Image', 'document', body)(env.location, env.fetch, env.Image, env.document);
}
const loc = { origin: 'https://dwalliance.com', href: 'https://dwalliance.com/', pathname: '/' };
const env = (missing, natural) => ({
  location: loc,
  fetch: async (p) => ({ status: missing.indexOf(p) >= 0 ? 404 : 200 }),
  Image: function () { const o = this; Object.defineProperty(o, 'src', { set() { setTimeout(() => o.onload && o.onload(), 0); } }); o.naturalWidth = natural || 2372; o.naturalHeight = Math.round((natural || 2372) / 2.0837); },
  document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(cb, type) { cb({ type, size: 4000 }); } }) }
});
const JPG = 'data:image/jpeg;base64,' + Buffer.from('JPEGBYTES').toString('base64');
const HTML = '<picture class="hero-slide is-active"><source type="image/webp" srcset="assets/img/hanalei-bay-1600.webp"><img src="assets/img/hanalei-bay-1600.jpg"></picture>\n' +
  '<picture class="hero-slide"><source type="image/webp" srcset="assets/img/hanalei-taro-1600.webp"><img src="assets/img/hanalei-taro-1600.jpg" alt="Taro" width="1600" height="767"></picture>';
const page = { path: '/index.html', name: 'index.html', kind: 'html', page: true };
const sent = [page, { path: '', name: 'hanalei-taro-hero.jpg', base: 'hanalei-taro-hero.jpg', kind: 'img', attach: true, loose: true, dataUrl: JPG }];

test('references: src, srcset, url(); relative to the file; other sites, data: and non-pictures are ignored', () => {
  const M = make(env([]));
  assert.deepEqual(M.xtPictureRefs(HTML, '/index.html').sort(), ['/assets/img/hanalei-bay-1600.jpg', '/assets/img/hanalei-bay-1600.webp', '/assets/img/hanalei-taro-1600.jpg', '/assets/img/hanalei-taro-1600.webp']);
  assert.deepEqual(M.xtPictureRefs('<img src="https://cdn.example.com/a.jpg"><img src="data:image/png;base64,AAA"><a href="/about.html">x</a><img srcset="a.png 1x, /b/c.webp 2x">', '/site/p.html'), ['/site/a.png', '/b/c.webp']);
  assert.deepEqual(M.xtPictureRefs('.x{background:url("../img/h.jpg?v=3")} .y{background:url(https://dwalliance.com/z.png)}', '/css/s.css'), ['/img/h.jpg', '/z.png']);
  assert.deepEqual(M.xtPictureRefs('<img src="/markup/x.png"><img src="/../../etc/a.png">', '/index.html'), ['/etc/a.png']);
});
test('pairing: the same name, shared words, or the only picture when only one is missing', () => {
  const M = make(env([])); const a = { name: 'hanalei-taro-hero.jpg' }, b = { name: 'logo.png' };
  assert.equal(M.xtPickLoose('/assets/img/hanalei-taro-1600.jpg', [a, b], false), a);
  assert.equal(M.xtPickLoose('/assets/img/hanalei-taro-hero.webp', [b, a], false), a);
  assert.equal(M.xtPickLoose('/assets/img/sunset-1200.jpg', [a, b], false), null);          // two pictures, no clue: never guess
  assert.equal(M.xtPickLoose('/assets/img/sunset-1200.jpg', [a], true), a);                 // one picture, one missing path
  assert.equal(M.xtPickLoose('/assets/img/sunset-1200.jpg', [a], false), null);
});
test('the broken hero: the missing .jpg and .webp are made from the attached photo, scaled to the -1600 in the name', async () => {
  const M = make(env(['/assets/img/hanalei-taro-1600.jpg', '/assets/img/hanalei-taro-1600.webp'], 2372));
  const have = {};
  const out = await M.xtLooseAssets([{ file: page, content: '<html>' + HTML + '</html>', size: 9 }], sent, have);
  assert.deepEqual(out.map((u) => u.file.path).sort(), ['/assets/img/hanalei-taro-1600.jpg', '/assets/img/hanalei-taro-1600.webp']);
  out.forEach((u) => { assert.ok(u.content.b64 && u.size > 0); assert.equal(u.derived, true); assert.equal(u.from, 'hanalei-taro-hero.jpg'); assert.equal(u.file.kind, 'img'); });
  assert.ok(have['/assets/img/hanalei-taro-1600.jpg'] && have['/assets/img/hanalei-taro-1600.webp']);
});
test('a picture that already exists on the site is never staged over, and a name that fits is used as it is', async () => {
  const M = make(env(['/assets/img/hanalei-taro-hero.jpg'], 1200));
  const html = '<html><img src="assets/img/hanalei-bay-1600.jpg"><img src="assets/img/hanalei-taro-hero.jpg"></html>';
  const out = await M.xtLooseAssets([{ file: page, content: html, size: 9 }], sent, {});
  assert.deepEqual(out.map((u) => u.file.path), ['/assets/img/hanalei-taro-hero.jpg']);
  assert.equal(out[0].asis, true); assert.equal(out[0].derived, false);
  assert.equal(Buffer.from(out[0].content.b64, 'base64').toString(), 'JPEGBYTES');
});
test('nothing attached, or nothing missing: nothing is staged', async () => {
  assert.deepEqual(await make(env([])).xtLooseAssets([{ file: page, content: '<html>' + HTML + '</html>', size: 9 }], sent, {}), []);
  assert.deepEqual(await make(env(['/assets/img/hanalei-taro-1600.jpg'])).xtLooseAssets([{ file: page, content: '<html>' + HTML + '</html>', size: 9 }], [page], {}), []);
});
test('two different missing pictures and one attachment: no guessing', async () => {
  const M = make(env(['/assets/img/a-1.jpg', '/assets/img/b-2.jpg']));
  const out = await M.xtLooseAssets([{ file: page, content: '<html><img src="assets/img/a-1.jpg"><img src="assets/img/b-2.jpg"></html>', size: 9 }], sent, {});
  assert.deepEqual(out, []);
});
test('markup.js: loose pictures are staged only through the same a=files staging, and xtDone waits for them', () => {
  assert.match(src, /xtLooseAssets\(ups, sent, have\)\.then\(function \(extra\) \{ return xtCap\(ups\.concat\(extra\)\); \}/);
  assert.match(src, /xtDone2\(d, r\.all, quiet, r\.chk\)/);
});
