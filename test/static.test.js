const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
function walk(d, out = []) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }

test('thin shell: no chat-site selectors hardcoded outside instructions/*.json', () => {
  const banned = ['prompt-textarea', 'send-button', 'stop-button', 'data-message-author-role', 'ProseMirror', 'composer-submit', 'oaiusercontent', 'data-testid'];
  const files = walk(path.join(root, 'extension')).filter((f) => /\.(js|html)$/.test(f));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const b of banned) assert.equal(s.includes(b), false, `${path.relative(root, f)} contains "${b}"`);
  }
});

test('manifest: MV3, narrow host permissions, no <all_urls>, no broad content script matches', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  const all = JSON.stringify(m);
  assert.equal(all.includes('<all_urls>'), false);
  for (const p of [...m.host_permissions, ...m.content_scripts.flatMap((c) => c.matches)]) assert.match(p, /^https:\/\/[a-z0-9.-]+\/\*$/, p);
  assert.ok(m.host_permissions.includes('https://chatgpt.com/*'));
  assert.deepEqual(m.optional_host_permissions, ['https://*/*']);
  assert.equal(m.permissions.includes('tabs'), false);
  assert.equal(m.permissions.includes('webRequest'), false);
  assert.equal(m.action.default_icon['16'].includes('grey'), true, 'icon is grey by default');
});

test('hosts.json matches manifest and config (run npm run sync-hosts if this fails)', () => {
  const h = JSON.parse(fs.readFileSync(path.join(root, 'hosts.json'), 'utf8'));
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const c = JSON.parse(fs.readFileSync(path.join(root, 'extension/config.json'), 'utf8'));
  assert.deepEqual(m.content_scripts[0].matches, h.dw.map((x) => `https://${x}/*`));
  assert.deepEqual(m.content_scripts[1].matches, h.ai.map((x) => `https://${x}/*`));
  const perm = [...new Set([...h.ai, ...h.dw, ...(h.patterns || [])])].map((x) => `https://${x}/*`);
  assert.deepEqual(m.host_permissions, perm);
  assert.deepEqual(c.dwHosts, h.dw);
  assert.ok((h.patterns || []).includes('dwalliance.com'));
  assert.ok(m.host_permissions.includes('https://dwalliance.com/*'));
  assert.ok(m.content_scripts[0].matches.includes('https://dwalliance.com/*'), 'dwalliance.com is an editor host as well as the patterns host');
  assert.equal(c.instructionsUrl, 'https://dwalliance.com/editor-ai/patterns/{site}.json');
  assert.equal(c.instructionsUrl.includes('/_dw/ext/sites'), false);
  assert.equal(c.allowDevOverride, false, 'shipped build must not allow dev overrides');
});

test('extension uses no timer polling on the DOM and no eval', () => {
  for (const f of walk(path.join(root, 'extension')).filter((x) => x.endsWith('.js'))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(/\beval\s*\(|new Function\(/.test(s), false, f);
  }
  // setInterval is allowed in exactly one place: the 20 s service-worker keepalive in the chat content script
  const hits = walk(path.join(root, 'extension')).filter((x) => x.endsWith('.js')).filter((f) => /setInterval\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((h) => path.relative(root, h)), ['extension/content/chatgpt.js']);
});

test('bundled instructions are verified (live, 2026-11-22), sealed, and the seal matches', () => {
  const crypto = require('crypto'); const { canonical } = require('../extension/lib/util.js');
  const i = JSON.parse(fs.readFileSync(path.join(root, 'extension/instructions/chatgpt.json'), 'utf8'));
  assert.equal(i.verified, true); assert.ok(i.revision >= 2); assert.match(i.integrity.hash, /^[0-9a-f]{64}$/);
  const body = Object.assign({}, i); delete body.integrity;
  assert.equal(crypto.createHash('sha256').update(canonical(body)).digest('hex'), i.integrity.hash, 'run npm run seal: the file changed after sealing');
});
