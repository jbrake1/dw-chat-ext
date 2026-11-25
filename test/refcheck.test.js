// v0.1.12: before Publish, every file the new HTML/CSS links to must be on the site or staged with it. The broken hero
// (assets/img/hanalei-taro-1600.webp/.jpg linked, never uploaded) is now staged from the files Gemini made, or, if one
// is still missing, Publish is blocked and the missing path is listed.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync((fs.existsSync(path.join(__dirname, '../server/markup/markup.js')) ? path.join(__dirname, '../server/markup/markup.js') : path.join(__dirname, '../mock/markup.js')), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = [];
test.after(() => open.forEach((w) => { try { w.close(); } catch (e) {} }));
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3, 4]).toString('base64');
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46]).toString('base64');
const ON_SITE = new Set(['/assets/site.css', '/assets/draft.css', '/menu.js', '/assets/img/hanalei-bay-1600.webp', '/assets/img/hanalei-bay-1600.jpg', '/about.html', '/assets/favicon.svg']);
const NEW = '<!doctype html>\n<html><head><link rel="icon" href="assets/favicon.svg"><link rel="stylesheet" href="assets/site.css"><link rel="stylesheet" href="assets/draft.css"><link rel="canonical" href="https://dwalliance.com/"></head><body>' +
  '<section class="hero bay"><picture class="hero-slide is-active"><source type="image/webp" srcset="assets/img/hanalei-bay-1600.webp"><img src="assets/img/hanalei-bay-1600.jpg"></picture>' +
  '<picture class="hero-slide"><source type="image/webp" srcset="assets/img/hanalei-taro-1600.webp 1x"><img src="assets/img/hanalei-taro-1600.jpg" alt="Taro"></picture></section>' +
  '<a href="/about.html">About</a> <a href="mailto:x@y.z">mail</a> <a href="#top">top</a> <a href="https://example.com/a.png">ext</a> <div style="background:url(\'/assets/img/hanalei-bay-1600.webp\')"></div>' +
  '<script src="menu.js"></script></body></html>\n';

function editor(opts = {}) {
  const d = new JSDOM('<!doctype html><html><head></head><body><h1>Home</h1></body></html>', { url: 'https://dwalliance.com/index.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = d.window, calls = [], heads = [];
  const exists = new Set([...ON_SITE, ...(opts.alsoOnSite || [])]);
  win.__exists = exists;
  win.confirm = () => true;
  win.fetch = async (u, o = {}) => {
    const url = new URL(u, 'https://dwalliance.com/');
    const json = (b, s = 200) => ({ ok: s < 400, status: s, json: async () => b });
    if (o.method === 'HEAD') { heads.push(url.pathname); return { ok: exists.has(url.pathname), status: exists.has(url.pathname) ? 200 : 404 }; }
    if (url.pathname === '/markup/' && url.searchParams.get('a') === 'status') return json({ ok: true, show: true, csrf: 'csrf1' });
    if (url.pathname === '/markup/' && url.searchParams.get('a') === 'files') { const b = JSON.parse(o.body); calls.push(b); return json({ ok: true, id: String(100 + calls.length), staged_on_existing: b.file_name === 'index.html' }); }
    return json({ ok: true });
  };
  win.eval(SRC);
  open.push(win);
  return { win, calls, heads };
}
function shadowAll(win, sel) {
  const out = [];
  win.document.querySelectorAll('*').forEach((n) => { if (n.shadowRoot) n.shadowRoot.querySelectorAll(sel).forEach((x) => out.push(x)); });
  return out;
}
const done = (win, extra) => { win.__msg = Object.assign({ v: 1, source: 'dw-ext', type: 'dw-ext-done', status: 'complete', jobId: 'j1',
  text: 'Save the new image to /assets/img/hanalei-taro-1600.webp and /assets/img/hanalei-taro-1600.jpg.\n\nFile: /index.html\n```html\n' + NEW + '```\n',
  files: [], blocks: [{ label: 'File: /index.html', lang: 'html', code: NEW }] }, extra || {}); win.dispatchEvent(new win.MessageEvent('message', { data: win.__msg, origin: 'https://dwalliance.com', source: win })); };

test('Gemini made both pictures: they are staged at the linked paths with the page, nothing is missing, Publish is on', async () => {
  const { win, calls } = editor();
  await sleep(50);
  done(win, { assets: [{ name: 'hanalei-taro-1600.webp', mime: 'image/webp', b64: WEBP, size: 20 }, { name: 'hanalei-taro-1600.jpg', mime: 'image/jpeg', b64: JPG, size: 8 }, { name: 'unrelated.png', mime: 'image/png', b64: 'iVBORw0KGgo=', size: 8 }] });
  await sleep(400);
  const made = calls.filter((c) => c.action === 'create');
  assert.deepEqual(made.map((c) => (c.file_path ? c.file_path + '/' : '') + c.file_name).sort(), ['assets/img/hanalei-taro-1600.jpg', 'assets/img/hanalei-taro-1600.webp', 'index.html']);
  made.forEach((c) => assert.equal(c.staging, true, 'staged preview only'));
  assert.equal(made.find((c) => c.file_name === 'hanalei-taro-1600.webp').file_data, WEBP);
  const pub = shadowAll(win, '[data-act=publish]')[0];
  assert.ok(pub); assert.equal(pub.disabled, false); assert.match(pub.textContent, /Publish 3 files/);
  assert.equal(shadowAll(win, '[data-missing]').length, 0);
  const card = shadowAll(win, '[data-act=publish]')[0].closest('[data-state]') || pub.parentNode.parentNode;
  assert.match(card.textContent, /unrelated\.png but it was not used/);
});

test('one picture still missing: Publish is blocked and the path is listed; Check again unblocks once the file is there', async () => {
  const { win, calls } = editor();
  await sleep(50);
  done(win, { assets: [{ name: 'hanalei-taro-1600.webp', mime: 'image/webp', b64: WEBP, size: 20 }], assetsMissed: { tags: 1, names: [{ name: 'hanalei-taro-1600.jpg', why: 'no_link' }] } });
  await sleep(400);
  assert.deepEqual(calls.filter((c) => c.action === 'create').map((c) => c.file_name).sort(), ['hanalei-taro-1600.webp', 'index.html']);
  let pub = shadowAll(win, '[data-act=publish]')[0];
  assert.equal(pub.disabled, true); assert.equal(pub.textContent, 'Publish blocked');
  const miss = shadowAll(win, '[data-missing]').map((n) => n.textContent);
  assert.deepEqual(miss, ['MISSING: /assets/img/hanalei-taro-1600.jpg']);
  pub.click(); await sleep(50);
  assert.equal(calls.filter((c) => c.action === 'publish_staging').length, 0, 'a blocked Publish publishes nothing');
  // the blocked state survives a reload of the card (sessionStorage)
  const st = JSON.parse(win.sessionStorage.getItem('dw_ext_staged:/index.html'));
  assert.deepEqual(st.missing, ['/assets/img/hanalei-taro-1600.jpg']);
  win.__exists.add('/assets/img/hanalei-taro-1600.jpg');
  shadowAll(win, '[data-act=recheck]')[0].click();
  await sleep(200);
  pub = shadowAll(win, '[data-act=publish]')[0];
  assert.equal(pub.disabled, false); assert.match(pub.textContent, /Publish 2 files/);
  pub.click(); await sleep(200);
  assert.equal(calls.filter((c) => c.action === 'publish_staging').length, 2);
});

test('nothing for the missing pictures at all: both paths listed, and only links on this site are checked', async () => {
  const { win, heads } = editor();
  await sleep(50);
  done(win, {});
  await sleep(400);
  assert.deepEqual(shadowAll(win, '[data-missing]').map((n) => n.textContent).sort(), ['MISSING: /assets/img/hanalei-taro-1600.jpg', 'MISSING: /assets/img/hanalei-taro-1600.webp']);
  assert.ok(!heads.some((h) => /example\.com|mailto|^\/markup/.test(h)), 'only this site is checked');
  assert.ok(heads.includes('/about.html') && heads.includes('/menu.js') && heads.includes('/assets/favicon.svg'));
});

test('helpers: references resolve relative to the file; other sites, data:, mailto:, anchors and folders are skipped', () => {
  const { win } = editor();
  const grab = (name) => { const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(SRC); assert.ok(m, name); return m[0]; };
  const grabVar = (name) => { const m = new RegExp('var ' + name + ' = [^\\n]*;').exec(SRC); return m[0]; };
  const M = new Function('location', 'DOMParser', [grabVar('XT_BLOCKED'), grab('xtResolveAny'), grab('xtCssUrls'), grab('xtAllRefs'), 'return { xtResolveAny, xtAllRefs };'].join('\n'))(win.location, win.DOMParser);
  assert.deepEqual(M.xtAllRefs('.a{background:url("../img/a.png?v=2")} @import "b.css"; .c{background:url(data:image/png;base64,AA)}', '/css/s.css', 'css'), ['/img/a.png', '/css/b.css']);
  assert.equal(M.xtResolveAny('/about/', '/index.html'), '');
  assert.equal(M.xtResolveAny('/markup/markup.js', '/index.html'), '');
  assert.equal(M.xtResolveAny('https://dwalliance.com/x.png', '/index.html'), '/x.png');
  assert.equal(M.xtResolveAny('//cdn.x/y.js', '/index.html'), '');
  assert.deepEqual(M.xtAllRefs(NEW, '/index.html', 'html').sort(), ['/about.html', '/assets/draft.css', '/assets/favicon.svg', '/assets/img/hanalei-bay-1600.jpg', '/assets/img/hanalei-bay-1600.webp', '/assets/img/hanalei-taro-1600.jpg', '/assets/img/hanalei-taro-1600.webp', '/assets/site.css', '/menu.js']);
});
