'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const { pageSnapshot, collectSelectors } = require('../extension/lib/snapshot.js');
const chatgpt = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/instructions/chatgpt.json'), 'utf8'));
const gemini = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/instructions/gemini.json'), 'utf8'));

function snap(html, instr, opts) {
  const dom = new JSDOM(html, Object.assign({ url: 'https://chatgpt.com/c/abc?session=SECRET&foo=1', pretendToBeVisual: true }, opts || {}));
  return { res: pageSnapshot(dom.window, instr || chatgpt), window: dom.window, document: dom.window.document };
}

test('redacts chat text and input values to length markers, keeps button/label/placeholder', () => {
  const { res } = snap(`<!doctype html><html><body>
    <h1>ChatGPT</h1>
    <div class="msg" data-testid="assistant">SECRET-CHAT-TEXT-HELLO-WORLD</div>
    <p>more secret prose that must not leak</p>
    <label for="q">Message</label>
    <textarea id="q" placeholder="Ask anything">typed secret value</textarea>
    <input type="text" name="q2" value="another secret">
    <button type="button" id="send" class="btn" aria-label="Send">Send prompt</button>
    <input type="submit" value="Go now">
  </body></html>`);
  assert.ok(res.ok);
  assert.equal(res.host, 'chatgpt.com');
  assert.doesNotMatch(res.dom, /SECRET-CHAT-TEXT-HELLO-WORLD/);
  assert.doesNotMatch(res.dom, /more secret prose/);
  assert.doesNotMatch(res.dom, /typed secret value/);
  assert.doesNotMatch(res.dom, /another secret/);
  assert.doesNotMatch(res.dom, /session=SECRET/);
  assert.match(res.dom, /#[0-9]+/);
  assert.match(res.dom, /placeholder="Ask anything"/);
  assert.match(res.dom, />Send prompt</);
  assert.match(res.dom, />Message</);
  assert.match(res.dom, /value="Go now"/);
  assert.match(res.dom, /aria-label="Send"/);
  assert.match(res.dom, /data-testid="assistant"/);
  assert.match(res.dom, /id="send"/);
  assert.match(res.dom, /class="btn"/);
});

test('strips scripts and styles, drops query strings, keeps structure', () => {
  const { res } = snap(`<!doctype html><html><head>
    <script>window.SECRET='leak'</script>
    <style>body{color:red}</style>
    <link rel="stylesheet" href="/s.css?v=1">
  </head><body>
    <a href="https://chatgpt.com/c/abc?token=SECRET#frag">ignore link text secret</a>
    <img src="https://chatgpt.com/img.png?q=1" alt="secret alt">
  </body></html>`);
  assert.doesNotMatch(res.dom, /<script/i);
  assert.doesNotMatch(res.dom, /<style/i);
  assert.doesNotMatch(res.dom, /window\.SECRET/);
  assert.doesNotMatch(res.dom, /color:red/);
  assert.doesNotMatch(res.dom, /token=SECRET/);
  assert.doesNotMatch(res.dom, /[?]q=1/);
  assert.doesNotMatch(res.dom, /#frag/);
  assert.match(res.dom, /href="https:\/\/chatgpt.com\/c\/abc"/);
  assert.match(res.dom, /src="https:\/\/chatgpt.com\/img.png"/);
  assert.doesNotMatch(res.dom, /secret alt/);
  assert.doesNotMatch(res.dom, /ignore link text secret/);
});

test('walks open shadow roots and same-origin iframes', () => {
  const { res, document, window } = snap(`<!doctype html><html><body>
    <div id="host"></div>
    <iframe id="fr" src="about:blank"></iframe>
  </body></html>`);
  const host = document.getElementById('host');
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = '<button id="inner-btn" data-testid="new">Shadow send</button><p>SECRET-IN-SHADOW</p>';
  const fr = document.getElementById('fr');
  fr.contentDocument.open(); fr.contentDocument.write('<!doctype html><button id="ifr-btn">Iframe go</button><p>SECRET-IN-IFRAME</p>'); fr.contentDocument.close();
  const res2 = pageSnapshot(window, { steps: { send: { selectors: ['#inner-btn', '#ifr-btn', '[data-testid="new"]'] } } });
  assert.match(res2.dom, /data-dw-shadow="open"/);
  assert.match(res2.dom, /<!--shadow-root-->/);
  assert.match(res2.dom, /Shadow send/);
  assert.doesNotMatch(res2.dom, /SECRET-IN-SHADOW/);
  assert.match(res2.dom, /data-dw-iframe="same-origin"/);
  assert.match(res2.dom, /Iframe go/);
  assert.doesNotMatch(res2.dom, /SECRET-IN-IFRAME/);
  const byPath = Object.fromEntries(res2.selectors.map((s) => [s.css, s]));
  assert.equal(byPath['#inner-btn'].pass, true);
  assert.equal(byPath['#inner-btn'].count, 1);
  assert.equal(byPath['#ifr-btn'].pass, true);
});

test('lists every selector in chatgpt and gemini instructions with count and pass/fail', () => {
  const { res } = snap(`<!doctype html><html><body>
    <form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form>
    <button data-testid="login-button">Log in</button>
  </body></html>`);
  const paths = collectSelectors(chatgpt).map((s) => s.path);
  assert.ok(paths.length >= 40, paths.length);
  assert.ok(paths.includes('steps.prompt.selectors[0]'));
  assert.equal(res.selectors.length, paths.length);
  res.selectors.forEach((s) => {
    assert.equal(typeof s.css, 'string');
    assert.equal(typeof s.path, 'string');
    assert.equal(typeof s.count, 'number');
    assert.equal(typeof s.pass, 'boolean');
    assert.equal(s.pass, s.count > 0 || !!s.error);
    if (s.error) assert.equal(s.pass, false);
  });
  const prompt0 = res.selectors.find((s) => s.path === 'steps.prompt.selectors[0]');
  assert.equal(prompt0.pass, true);
  assert.ok(prompt0.count >= 1);
  const login = res.selectors.find((s) => s.css.includes('login-button'));
  assert.equal(login.pass, true);

  const g = collectSelectors(gemini);
  assert.ok(g.length >= 70, g.length);
  assert.ok(g.some((s) => /new-chat-button/.test(s.css)));
});

test('textMatches is applied without putting the matched text in the snapshot', () => {
  const instr = { steps: { loggedOut: { selectors: [{ css: 'button', textMatches: '^\\s*sign in\\s*$' }] } } };
  const { res } = snap(`<!doctype html><html><body>
    <button>Sign in</button>
    <button>Not this</button>
    <p>Sign in secret surrounding</p>
  </body></html>`, instr);
  const s = res.selectors[0];
  assert.equal(s.count, 1);
  assert.equal(s.pass, true);
  assert.doesNotMatch(res.dom, /secret surrounding/);
  assert.match(res.dom, />Sign in</); // button text is kept
});

test('does not use eval or setInterval', () => {
  const s = fs.readFileSync(path.join(__dirname, '../extension/lib/snapshot.js'), 'utf8');
  assert.equal(/\beval\s*\(|new Function\(/.test(s), false);
  assert.equal(/setInterval\(/.test(s), false);
});

test('v0.1.9: byte budget counts each byte once, so a deep page is not cut off before the composer (v0.1.8 cut Gemini off in its sidebar)', () => {
  const items = Array.from({ length: 500 }, (_, i) => `<a class="item" href="/c/${i}" aria-label="Chat ${i}"><span class="t">x</span></a>`).join('');
  let nested = items;
  for (let d = 0; d < 12; d++) nested = `<div class="w${d}">${nested}</div>`;     // old accounting: ~13x the real size
  const { res } = snap(`<!doctype html><html><body><nav>${nested}</nav><main><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea></main></body></html>`);
  assert.equal(res.stats.truncated, false);
  assert.ok(res.dom.includes('<rich-textarea>') && res.dom.includes('ql-editor'));
  assert.ok(res.stats.bytes < 150000 && res.stats.bytes > 30000, String(res.stats.bytes));
});
