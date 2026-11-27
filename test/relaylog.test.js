'use strict';
// v0.1.7: no silent failures when the extension is not running on the page, a persisted relay log, diagnostics.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noServer = !fs.existsSync(path.join(root, 'server/markup/markup.js'));   // the public repo has no server tree

test('markup.js: Send without a running extension shows a persistent message instead of returning silently', { skip: noServer }, () => {
  const s = read('server/markup/markup.js');
  assert.ok(/function xtNoRelay\(/.test(s));
  assert.ok(/if \(!XT\.active\) \{ xtNoRelay\(note, blob\); return; \}/.test(s), 'xtSubmit routes to xtNoRelay');
  assert.ok(!/function xtSubmit\([^)]*\) \{\s*if \(!XT\.active \|\| !blob\) return;/.test(s), 'old silent return is gone');
  assert.ok(s.includes("'data-code': 'ext_missing'"));
  assert.ok(/if \(XT\.active\) toast\('Edit request sent\./.test(s), 'toast only promises a reply when the relay runs');
});

test('markup.js: relay log persists in sessionStorage, restores a note after a reload, and copies diagnostics', { skip: noServer }, () => {
  const s = read('server/markup/markup.js');
  assert.ok(s.includes("'dw_ext_relaylog'") && s.includes('sessionStorage.setItem(XT_LOG_KEY'));
  for (const ev of ['submit_start', 'collect_done', 'submit_posted', 'feed_error', 'stopped', 'feed_closed', 'no_relay', 'pagehide']) assert.ok(s.includes("xtLog('" + ev + "'"), ev);
  assert.ok(/xtRestoreRelayNote\(\); \}/.test(s), 'restore runs when the editor mounts');
  assert.ok(s.includes("xtPost('dw-ext-diag'") && s.includes('dw-ext-diag-result'));
  assert.ok(s.includes('Copy diagnostics'));
  assert.ok(s.includes('xtFeedToolsMount') && s.includes("'data-role': 'feed-tools'") && s.includes('card-tools'), 'buttons in the chat header and on the preview panel');
  assert.ok(s.includes('Mark up this page') && s.includes('xtCaptureShot'), 'follow-up markup tools');
  // the log never stores note text, replies or screenshots
  assert.ok(!/xtLog\([^)]*(note|screenshot|text:)/.test(s.replace(/xtLog\('submit_start'[^\n]*\n/, '')));
});

test('markup.js: relay log logic works (unfinished request detected after a reload)', { skip: noServer }, () => {
  const s = read('server/markup/markup.js');
  const m = /function xtLogGet\(\)[\s\S]*?function xtRestoreRelayNote/.exec(s);
  assert.ok(m);
  const store = {};
  const sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const XT = {};
  const body = "var XT_LOG_KEY = 'dw_ext_relaylog', XT_LOG_MAX = 80;" + m[0].replace(/function xtRestoreRelayNote$/, '') + '; return { xtLog, xtUnfinished, xtLogGet };';
  const api = new Function('sessionStorage', 'XT', 'window', 'Date', body)(sessionStorage, XT, { addEventListener() {} }, Date);
  api.xtLog('submit_start', { active: true });
  api.xtLog('collect_done', { files: 3 });
  api.xtLog('ext:step', { step: 'open_tab' });
  api.xtLog('pagehide');
  assert.deepStrictEqual(api.xtUnfinished().last, 'open_tab');
  api.xtLog('ext:done', { status: 'ok' });
  assert.strictEqual(api.xtUnfinished(), null);
  for (let i = 0; i < 200; i++) api.xtLog('x' + i);
  assert.ok(api.xtLogGet().length <= 80);
});

test('dw.js: send() survives an invalidated extension context; page log, diag handler, sw_unreachable text', () => {
  const s = read('extension/content/dw.js');
  assert.ok(/function send\(msg\) \{\s*(?:if \(msg[^\n]*\n\s*)?try \{/.test(s));
  assert.ok(s.includes("sessionStorage.setItem(LOG_KEY"));
  assert.ok(s.includes("d.type === 'dw-ext-diag'") && s.includes("'dw-ext-diag-result'"));
  assert.ok(s.includes('sw_unreachable'));
  assert.ok(s.includes("dwLog('submit_ignored'"));
});

test('sw.js: persisted relay log, diagnostics snapshot, injection into already-open editor tabs', () => {
  const s = read('extension/background/sw.js');
  assert.ok(s.includes('DLOG_MAX') && s.includes('chrome.storage.local'));
  assert.ok(s.includes('function diagSnapshot') && s.includes("'dw:diag'") && s.includes("'popup:diag'") && s.includes("'dw:log'"));
  assert.ok(s.includes('function injectIntoOpenDwTabs') && s.includes('chrome.runtime.onInstalled'));
  // diag requests only from the active DW tab or the extension's own pages
  assert.ok(/case 'popup:diag': if \(!fromExt\) return/.test(s));
});

test('popup has a Copy diagnostics button; manifest is 0.1.15', () => {
  assert.ok(read('extension/popup/popup.html').includes('id="diag"'));
  assert.ok(read('extension/popup/popup.js').includes('popup:diag'));
  assert.strictEqual(JSON.parse(read('extension/manifest.json')).version, '0.1.15');
});
