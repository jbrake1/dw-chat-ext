'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const noServer = !fs.existsSync(path.join(root, 'server/markup/markup.js'));

test('extension 0.1.11: snapshot is a side path and does not use /_dw/ext/report or /_dw/ext/files', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.equal(m.version, '0.1.11');
  assert.ok(m.content_scripts[1].js.includes('lib/snapshot.js'));
  assert.ok(!m.content_scripts[0].js.includes('lib/snapshot.js'), 'snapshot.js is not injected on editor pages');
  const sw = read('extension/background/sw.js');
  assert.ok(sw.includes("lib/snapshot.js"));
  assert.ok(sw.includes("case 'popup:snapshot'"));
  assert.ok(sw.includes("case 'dw:snapshot'"));
  assert.ok(sw.includes('function handleSnapshot'));
  assert.doesNotMatch(sw, /\/_dw\/ext\/(report|files)/);
  const dw = read('extension/content/dw.js');
  assert.ok(dw.includes("/markup/?a='") || dw.includes("/markup/?a="));
  assert.match(dw, /a=snapshot|a=' \+ a/);
  assert.ok(dw.includes("sw:uploadSnap"));
  assert.doesNotMatch(dw, /\/_dw\/ext\/(report|files)/);
  const gpt = read('extension/content/chatgpt.js');
  assert.ok(gpt.includes("case 'gpt:snapshot'"));
  assert.ok(gpt.includes('DWX.pageSnapshot'));
});

test('Send page snapshot button is in the popup and on error in the chat window', { skip: noServer }, () => {
  assert.ok(read('extension/popup/popup.html').includes('id="snap"'));
  assert.ok(read('extension/popup/popup.js').includes('popup:snapshot'));
  const panel = read('extension/content/panel.js');
  assert.ok(panel.includes('Send page snapshot'));
  assert.ok(panel.includes('h.onSnapshot'));
  const mk = read('server/markup/markup.js');
  assert.ok(mk.includes('function xtSnapButton'));
  assert.ok(mk.includes("xtPost('dw-ext-snapshot'"));
  assert.ok(mk.includes('dw-ext-snapshot-result'));
  assert.match(mk, /xtSnapButton\(\);/);
  // no-relay path still does not offer a snapshot (extension is not on the page)
  const no = mk.slice(mk.indexOf('function xtNoRelay'), mk.indexOf('window.addEventListener', mk.indexOf('function xtNoRelay')));
  assert.ok(no.includes('xtDiagButton()'));
  assert.ok(!no.includes('xtSnapButton()'));
});

test('v0.1.7 relay path is still intact', { skip: noServer }, () => {
  const mk = read('server/markup/markup.js');
  assert.ok(mk.includes('function xtNoRelay'));
  assert.ok(mk.includes('xtWaitForRelay'));
  assert.ok(/if \(!XT\.active\) \{ xtNoRelay\(note, blob\); return; \}/.test(mk));
  const dw = read('extension/content/dw.js');
  assert.ok(dw.includes('function idlePanel'));
  assert.ok(dw.includes('relay_timeout'));
  const sw = read('extension/background/sw.js');
  assert.ok(sw.includes('function handleSubmit0') || sw.includes('async function handleSubmit0'));
  assert.ok(sw.includes('injectIntoOpenDwTabs'));
});
