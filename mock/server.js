/* Mock DW site + mock ChatGPT for local tests. Two listeners (two origins):
 *   DW   http://localhost:<port>   : /, /_dw/whoami, /_dw/ext/pass, /_dw/ext/report, /editor-ai/patterns/<site>.json, /markup/
 *   GPT  http://127.0.0.1:<port>   : /  (mock chatgpt.html)
 * Test controls (DW origin): GET /__login /__logout, GET /__state, POST /__set {json}. Never use these in production. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonical } = require('../extension/lib/util.js');
const { signedPart } = require('../extension/lib/pass.js');

function startMock(opts = {}) {
  const state = {
    passTtl: 300, passBehavior: 'ok', instructions: null, instructionsStatus: 200, reports: [], markup: [], snapshots: [], staged: [], passCalls: 0, whoamiCalls: 0,
    passKeys: crypto.generateKeyPairSync('ed25519'), signPass: false, extraRequests: []
  };
  const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((s) => s.split('=')));
  const json = (res, code, obj, h = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, h)); res.end(JSON.stringify(obj)); };

  // v0.1.13 overwrite guard tests: POST /__set {editorExtra: '...'} changes the live /editor.html (someone else's edit);
  // {md5Mode: true} makes the staging answers carry the live md5 and publish_staging check expect_md5 (the /files md5 spec).
  const editorBytes = () => Buffer.concat([fs.readFileSync(path.join(__dirname, 'real-editor.html')), Buffer.from(state.editorExtra || '')]);
  const liveMd5 = (name) => name === 'editor.html' ? crypto.createHash('md5').update(editorBytes()).digest('hex') : null;
  const dw = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const c = cookies(req);
    state.extraRequests.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'dw-editor.html'))); }
    if (u.pathname === '/__shot.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(fs.readFileSync(path.join(__dirname, '../harness/fixtures/sample-screenshot.jpg'))); }
    if (u.pathname === '/__login') { res.writeHead(200, { 'Set-Cookie': ['dw_s=1; Path=/', 'dw_ed=1; Path=/'], 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname === '/__logout') { res.writeHead(200, { 'Set-Cookie': ['dw_s=; Max-Age=0; Path=/', 'dw_ed=; Max-Age=0; Path=/'], 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname === '/__state') return json(res, 200, { reports: state.reports, markup: state.markup, snapshots: state.snapshots, passCalls: state.passCalls, whoamiCalls: state.whoamiCalls, requests: state.extraRequests });
    if (u.pathname === '/__set' && req.method === 'POST') { Object.assign(state, JSON.parse((await readBody(req)).toString())); return json(res, 200, { ok: true }); }
    if (u.pathname === '/__reset') { state.reports = []; state.markup = []; state.snapshots = []; state.passCalls = 0; state.whoamiCalls = 0; state.extraRequests = []; return json(res, 200, { ok: true }); }
    if (u.pathname === '/_dw/whoami') { state.whoamiCalls++; return json(res, 200, { edit: c.dw_s === '1' }); }
    if (u.pathname === '/_dw/ext/pass' && req.method === 'POST') {
      state.passCalls++;
      if (req.headers['x-dw-ext'] !== '1' || c.dw_s !== '1') return json(res, 403, { ok: false, error: 'forbidden' });
      if (state.passBehavior === 'deny') return json(res, 403, { ok: false, error: 'not_editor' });
      const now = Math.floor(Date.now() / 1000);
      const p = { ok: true, pass: crypto.randomBytes(16).toString('hex'), site: state.passBehavior === 'wrong_site' ? 'evil.example' : req.headers.host.replace(/:\d+$/, ''),
                  sub: state.passSub || 'p_linda', role: 'editor', iat: now, exp: now + (state.passBehavior === 'expired' ? -10 : state.passTtl), now };
      if (state.signPass) p.sig = crypto.sign(null, Buffer.from(signedPart(p)), state.passKeys.privateKey).toString('base64url');
      return json(res, 200, p);
    }
    if (u.pathname === '/_dw/ext/report' && req.method === 'POST') { state.reports.push(JSON.parse((await readBody(req)).toString())); res.writeHead(204); return res.end(); }
    const patt = u.pathname.match(/^\/(?:editor-ai\/patterns|_dw\/ext\/sites)\/([a-z0-9_-]{1,32})\.json$/);
    if (patt) {
      if (state.instructions == null || state.instructionsStatus !== 200) { res.writeHead(state.instructionsStatus === 200 ? 404 : state.instructionsStatus); return res.end('nope'); }
      const body = typeof state.instructions === 'string' ? state.instructions : JSON.stringify(state.instructions);
      const etag = '"' + crypto.createHash('sha256').update(body).digest('hex') + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'ETag': etag }); return res.end(body);
    }
    if (u.pathname === '/home-prod.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'home-prod.html'))); }   // v0.1.10: a saved copy of a real full-bleed-hero page
    if (u.pathname === '/editor.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(editorBytes()); }  // v0.1.11: real markup.js (not the inline mock on /)
    if (u.pathname === '/_dw/edit.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, 'edit.js'))); }
    if (u.pathname === '/markup/markup.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); const sp = path.join(__dirname, '../server/markup/markup.js'); return res.end(fs.readFileSync(fs.existsSync(sp) ? sp : path.join(__dirname, 'markup.js'))); }
    if (u.pathname === '/markup/vendor/html2canvas.min.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end("window.html2canvas=function(el,o){var c=document.createElement('canvas');c.width=Math.max(1,(o&&o.width)||800);c.height=Math.max(1,(o&&o.height)||600);return Promise.resolve(c);};"); }
    if (u.pathname === '/markup/' && (u.searchParams.get('a') === 'status')) {
      return json(res, 200, { ok: true, show: true, csrf: 'mock-csrf' });
    }
    if (u.pathname === '/markup/' && req.method === 'POST' && u.searchParams.get('a') === 'snapshot') {
      if (req.headers['x-dw-markup'] !== '1' || req.headers['x-dw-csrf'] !== 'mock-csrf') return json(res, 403, { ok: false, error: 'bad token' });
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString()); } catch (e) { return json(res, 400, { ok: false, error: 'bad_json' }); }
      const raw = JSON.stringify(body);
      const id = 's' + crypto.randomBytes(4).toString('hex');
      state.snapshots.push({ id, provider: body.provider, host: body.host, bytes: raw.length, selectorCount: Array.isArray(body.selectors) ? body.selectors.length : 0, hasSecret: /SECRET/.test(raw), hasQuery: /[?]/.test(String(body.host || '')) });
      return json(res, 200, { ok: true, id });
    }
    if (u.pathname === '/markup/' && req.method === 'POST' && u.searchParams.get('a') === 'files') {
      // v0.1.11 tests: accept staged-save posts from markup.js so xtDone does not reject
      // v0.1.12: and record them (name, folder, size, first bytes) for the download-chip scenario
      let b = {}; try { b = JSON.parse((await readBody(req)).toString()); } catch (e) {}
      // v0.1.13: "Add 10 min" (extend_staging): +10 min per press, at most 60 min left; unknown/expired ids get 409
      if (b.action === 'extend_staging') {
        state.extended = state.extended || [];
        state.stageExp = state.stageExp || {};
        const n = Number(String(b.id || '').replace(/^stg/, ''));
        if (!n || n > state.staged.length || state.expiredIds && state.expiredIds.includes(b.id)) return json(res, 409, { ok: false, error: 'not_staged', error_code: 'not_staged' });
        const now = Date.now(), cur = state.stageExp[b.id] || (now + 10 * 60000);
        const next = Math.min(cur + 10 * 60000, now + 60 * 60000);
        state.stageExp[b.id] = next;
        state.extended.push(b.id);
        const left = Math.round((next - now) / 1000);
        return json(res, 200, { ok: true, id: b.id, expires_in_seconds: left, capped: left >= 3595, cap_minutes: 60 });
      }
      if (b.action === 'publish_staging') {
        const row = state.staged[Number(String(b.id || '').replace(/^stg/, '')) - 1] || {};
        state.published = state.published || [];
        if (state.md5Mode && typeof b.expect_md5 === 'string') {
          const cur = liveMd5(row.file_name);
          if (cur && cur !== b.expect_md5) { state.md5Refused = (state.md5Refused || 0) + 1; return json(res, 409, { ok: false, error: 'md5 mismatch', error_code: 'md5_mismatch', expected_md5: b.expect_md5, current_md5: cur, modified: new Date().toISOString() }); }
        }
        state.published.push({ id: b.id, file_name: row.file_name, expect: b.expect_md5 || null });
      }
      state.staged.push({ action: b.action, staging: b.staging, file_name: b.file_name, file_path: b.file_path, text: typeof b.file_text === 'string' ? b.file_text.length : null, data: typeof b.file_data === 'string' ? b.file_data.slice(0, 16) : null, expect: b.expect_md5 || null });
      const ans = { ok: true, id: 'stg' + state.staged.length, staged_on_existing: b.file_name === 'editor.html' };
      if (state.md5Mode && b.action === 'create') ans.file = { id: ans.id, md5: liveMd5(b.file_name), has_staging: true, staging_md5: crypto.createHash('md5').update(String(b.file_text || '')).digest('hex') };
      return json(res, 200, ans);
    }
    if (u.pathname === '/markup/' && req.method === 'POST') {
      const body = await readBody(req);
      state.markup.push({ bytes: body.length, hasHeader: req.headers['x-dw-markup'] === '1' });
      return json(res, 200, { ok: true, id: state.markup.length });
    }
    res.writeHead(404); res.end('404');
  });
  const gpt = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/c/test') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'chatgpt.html'))); }
    res.writeHead(404); res.end('404');
  });
  // v0.1.6: mock Gemini on a second loopback address (test build maps 127.0.0.2 -> gemini)
  const gem = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (/^\/app(\/[A-Za-z0-9]*)?$/.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'gemini.html'))); }
    res.writeHead(404); res.end('404');
  });
  // v0.1.13: mock Grok (127.0.0.3) and mock Claude (127.0.0.4); both pages share mock/aimock.js
  const aiPage = (file, re) => http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/aimock.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, 'aimock.js'))); }
    if (re.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, file))); }
    res.writeHead(404); res.end('404');
  });
  const grok = aiPage('grok.html', /^\/(c\/[A-Za-z0-9]+)?$/);
  const claude = aiPage('claude.html', /^\/(new|chat\/[A-Za-z0-9]+)?$/);
  return new Promise((resolve) => {
    dw.listen(opts.dwPort || 0, '127.0.0.1', () => gpt.listen(opts.gptPort || 0, '127.0.0.1', () => gem.listen(opts.gemPort || 0, '127.0.0.2', () =>
      grok.listen(opts.grokPort || 0, '127.0.0.3', () => claude.listen(opts.claudePort || 0, '127.0.0.4', () => {
      resolve({
        state, dwUrl: 'http://localhost:' + dw.address().port, gptUrl: 'http://127.0.0.1:' + gpt.address().port, gemUrl: 'http://127.0.0.2:' + gem.address().port,
        grokUrl: 'http://127.0.0.3:' + grok.address().port, claudeUrl: 'http://127.0.0.4:' + claude.address().port,
        close: () => new Promise((r) => dw.close(() => gpt.close(() => gem.close(() => grok.close(() => claude.close(r))))))
      });
    })))));
  });
}
module.exports = { startMock };
if (require.main === module) startMock({ dwPort: 8801, gptPort: 8802 }).then((m) => console.log('DW mock', m.dwUrl, ' ChatGPT mock', m.gptUrl, '(log in at /__login)'));
