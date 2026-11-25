// v0.1.6.1: every provider-named label follows the selected AI (ChatGPT or Gemini).
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ext = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('panel step labels and title use the selected AI name, not a hard-coded ChatGPT', () => {
  const panel = ext('extension', 'content', 'panel.js');
  assert.match(panel, /prompt: 'Opening ' \+ nameAi/);
  assert.match(panel, /stream: nameAi \+ ' is reading/);
  assert.match(panel, /nameAi \+ ' is reading\\u2026'/);
  assert.match(panel, /open in ' \+ L\(/);
  assert.equal(panel.includes("(open in ' + L(state.provider || 'chatgpt') + ' tab)'"), true);
  assert.match(panel, /s\.busy \? 'Sending to ' \+ name \+ '\\u2026'/);
  assert.equal(panel.includes("'Opening ChatGPT'"), false);
  assert.equal(panel.includes("'ChatGPT is reading"), false);
  assert.equal(panel.includes('open in ChatGPT tab'), false);
});

test('dw.js applies the job provider to the panel before the first step', () => {
  const dw = ext('extension', 'content', 'dw.js');
  assert.match(dw, /S\.jobProvider = job\.provider \|\| \(S\.state && S\.state\.provider\)/);
  assert.match(dw, /provider: S\.jobProvider,\s*busy: true/);
});

const markupPath = path.join(__dirname, '..', '..', 'dw-chat-ext-v016', 'server', 'markup', 'markup.js');
if (fs.existsSync(markupPath)) {
  test('markup.js paints the feed title from the picker and sends that provider', () => {
    const mk = fs.readFileSync(markupPath, 'utf8');
    assert.match(mk, /if \(ui\.aiSel && XT_AI\[ui\.aiSel\.value\]\) return ui\.aiSel\.value/);
    assert.match(mk, /xtAiUse\(\);/);
    assert.match(mk, /function xtFeedLabel\(name\)/);
    assert.match(mk, /prompt: 'Opening ' \+ N/);
    assert.match(mk, /msg\.provider = XT\.ai/);
    assert.match(mk, /XT\.lastSend = \{[^}]*provider: XT\.ai/);
    assert.equal(mk.includes("'Opening ChatGPT'"), false);
    assert.equal(mk.includes("Sending to ' + xtAiName(XT.ai)"), true);
  });
}

test('markup.js times out a silent relay and Stop always ends the feed', () => {
  const mkPath = path.join(__dirname, '..', '..', 'dw-chat-ext-v016', 'server', 'markup', 'markup.js');
  if (!fs.existsSync(mkPath)) return;
  const mk = fs.readFileSync(mkPath, 'utf8');
  assert.match(mk, /function xtWaitForRelay\(/);
  assert.match(mk, /xtFeedError\('relay_timeout'/);
  assert.match(mk, /function xtFeedStopped\(/);
  assert.match(mk, /Stopped\. Nothing changed\./);
  assert.match(mk, /xtPost\('dw-ext-control', \{ action: 'stop' \}\); xtFeedStopped\(\)/);
});

test('sw.js and dw.js abort an in-flight submit on Stop and time out a silent handshake', () => {
  const sw = ext('extension', 'background', 'sw.js');
  const dw = ext('extension', 'content', 'dw.js');
  assert.match(sw, /S\.stopGen/);
  assert.match(sw, /step: 'open_tab'/);
  assert.match(sw, /withTimeout\(chrome\.tabs\.sendMessage\(job\.gptTabId, \{ type: 'gpt:run'/);
  assert.match(sw, /S\.stopGen\+\+/);
  assert.match(dw, /function localStop\(/);
  assert.match(dw, /d\.action === 'stop'\) localStop\(\)/);
  assert.match(dw, /withTimeout\(send\(\{ type: 'dw:submit'/);
});
