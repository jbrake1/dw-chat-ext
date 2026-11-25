/* v0.1.13: shared behaviour for the mock Grok and Claude pages (best-effort mimic of their public DOM, NOT verified live).
 * The page sets window.MOCK = { name, homePath, convoPath, prompt, send, stop (null: send button turns into stop), fileInput,
 *   previews, preview(name) -> html, hist, user(text) -> el, assistant() -> { el, md, done(el) }, codeBlock(lang, body) -> el, chips(md) }.
 * Query: speed, tokens, limit=1, attach=0, code=0, reply=taro, chips=1, convo=1, signedout=1. */
(function () {
  'use strict';
  var M = window.MOCK, q = new URLSearchParams(location.search);
  if (!URL.createObjectURL) { var __n = 0; URL.createObjectURL = function () { return 'blob:' + location.origin + '/b' + (++__n); }; }
  var SPEED = Number(q.get('speed') || 20), NTOK = Number(q.get('tokens') || 20), LIMIT = q.get('limit') === '1', NOATTACH = q.get('attach') === '0', CODE = q.get('code') !== '0';
  window.__received = []; window.__forbidden = []; window.__newChat = 0; window.__downloads = 0;
  var prompt = document.querySelector(M.prompt), send = document.querySelector(M.send), stop = M.stop ? document.querySelector(M.stop) : null;
  var input = document.querySelector(M.fileInput), previews = document.querySelector(M.previews), hist = document.querySelector(M.hist);
  var files = [], streaming = false, timer = null, nturn = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-forbidden]'), function (b) { b.addEventListener('click', function (e) { e.preventDefault(); window.__forbidden.push(b.getAttribute('data-forbidden')); }); });
  function text() { return prompt.value !== undefined && prompt.tagName === 'TEXTAREA' ? prompt.value.trim() : (prompt.textContent || '').trim(); }
  function refresh() { var off = streaming || (!text() && !files.length); if (!(streaming && !M.stop)) send.disabled = off; }
  prompt.addEventListener('input', refresh);
  prompt.addEventListener('paste', function (e) {
    var cd = e.clipboardData; if (!cd) return;
    if (cd.files && cd.files.length) { e.preventDefault(); addFiles(Array.prototype.slice.call(cd.files)); return; }
    var t = cd.getData('text/plain'); if (t) { e.preventDefault(); if (prompt.tagName === 'TEXTAREA') prompt.value = t; else prompt.textContent = t; refresh(); }
  });
  input.addEventListener('change', function () { addFiles(Array.prototype.slice.call(input.files)); });
  function addFiles(list) {
    if (NOATTACH) return;
    setTimeout(function () {
      list.forEach(function (f) { files.push(f); var d = document.createElement('div'); d.innerHTML = M.preview(); d.firstChild.querySelector('.name').textContent = f.name; previews.appendChild(d.firstChild); });
      refresh();
    }, 150);
  }
  if (q.get('signedout') === '1') { var so = document.createElement('a'); so.href = M.signInHref; so.textContent = 'Sign in'; document.body.appendChild(so); prompt.remove(); }
  if (q.get('convo') === '1') { history.replaceState(null, '', M.convoPath('old1') + location.search); hist.appendChild(M.user('old question')); var a0 = M.assistant(); a0.md.innerHTML = '<p>old answer</p>'; hist.appendChild(a0.el); a0.done(); }
  document.querySelector(M.newChat).addEventListener('click', function (e) {
    e.preventDefault(); window.__newChat++;
    setTimeout(function () { hist.textContent = ''; history.pushState(null, '', M.homePath + location.search); }, 50);
  });
  send.addEventListener('click', function (e) { e.preventDefault(); if (streaming) { if (!M.stop) halt(); return; } doSend(); });
  if (stop) stop.addEventListener('click', function (e) { e.preventDefault(); halt(); });
  prompt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!streaming) doSend(); } });
  var finishFn = null;
  function halt() { if (timer) { clearInterval(timer); timer = null; } if (finishFn) finishFn(); }
  function setStreaming(on) {
    streaming = on;
    if (M.stop) { stop.hidden = !on; send.hidden = on; }
    else { send.setAttribute('aria-label', on ? M.stopLabel : M.sendLabel); send.disabled = false; }
    refresh();
  }
  function doSend() {
    if (send.disabled) return;
    var t = text(), fs = files.slice();
    window.__received.push({ text: t, files: fs.map(function (f) { return { name: f.name, size: f.size, type: f.type }; }) });
    hist.appendChild(M.user(t));
    if (prompt.tagName === 'TEXTAREA') prompt.value = ''; else prompt.innerHTML = '<p><br></p>';
    files = []; previews.textContent = '';
    if (!/\/(c|chat)\//.test(location.pathname)) history.pushState(null, '', M.convoPath('c' + Date.now().toString(16)) + location.search);
    setStreaming(true);
    var a = M.assistant(++nturn);
    setTimeout(function () {
      hist.appendChild(a.el);
      var p = document.createElement('p'); a.md.appendChild(p);
      finishFn = function () { finishFn = null; a.done(); setStreaming(false); };
      if (LIMIT) { p.textContent = 'You\u2019ve reached your usage limit. Your limit resets tomorrow.'; return finishFn(); }
      var words = ['OK.', M.name, 'got', 'your', 'request', '(' + t.length + ' chars)', 'with', fs.length + ' files' + (fs.length ? ' (first: ' + fs[0].name + ').' : '.')];
      var tok = /\bTOK-[A-Za-z0-9]+/.exec(t); if (tok) words.splice(2, 0, 'for', tok[0]);   // v0.1.13: lets a test tell replies apart
      for (var i = words.length; i < NTOK; i++) words.push('word' + i);
      var k = 0, out = '';
      timer = setInterval(function () {
        out += (k ? ' ' : '') + words[k++]; p.textContent = out;
        if (k >= words.length) { clearInterval(timer); timer = null; if (CODE) code(a.md); if (q.get('chips') === '1') chips(a); finishFn(); }
      }, SPEED);
    }, 250);
  }
  function add(md, label, lang, body) {
    var lp = document.createElement('p'); lp.innerHTML = 'File: <code></code>'; lp.querySelector('code').textContent = label; md.appendChild(lp);
    md.appendChild(M.codeBlock(lang, body));
  }
  function code(md) {
    if (q.get('reply') === 'taro') {
      add(md, '/index.html', 'html', '<!doctype html>\n<html><body><h1>Family owned since 1998</h1><picture><source type="image/webp" srcset="assets/img/hanalei-taro-1600.webp"><img src="assets/img/hanalei-taro-1600.jpg" alt="Taro"></picture></body></html>\n');
      var tp = document.createElement('p'); tp.textContent = 'Save the new image to /assets/img/hanalei-taro-1600.webp and /assets/img/hanalei-taro-1600.jpg.'; md.appendChild(tp);
      return;
    }
    if (q.get('reply') === 'family') {
      add(md, '/index.html', 'html', '<!doctype html>\n<html><body><picture><source type="image/webp" srcset="assets/img/family-working-at-home.webp"><img src="assets/img/Gemini_Generated_Image_a1b2c3d4e5f6.jpeg" alt="Family working at home"></picture></body></html>\n');
      var fp = document.createElement('p'); fp.textContent = 'I added a generated photo. The webp source is a fallback candidate.'; md.appendChild(fp);
      return;
    }
    add(md, '/index.html', 'html', '<!doctype html>\n<html><body><h1>Family owned since 1998</h1></body></html>\n');
    add(md, '/css/site.css', 'css', 'h1{color:#1f4d2b}\n');
    var tail = document.createElement('p'); tail.textContent = 'That is all.'; md.appendChild(tail);
  }
  function chips(a) {
    var box = M.chips();
    var family = q.get('reply') === 'family';
    if (family) {
      var card = box.querySelector('[data-testid=file-card]') || box.firstElementChild;
      var nm = card && card.querySelector('.file-name, [class*=name]');
      if (nm) nm.textContent = 'Gemini_Generated_Image_a1b2c3d4e5f6.jpeg';
    }
    (a.chipHost || a.el).appendChild(box);
    var b = box.querySelector('[data-dl]');
    b.addEventListener('click', function () {
      window.__downloads++;
      var bytes, type, name;
      if (family) {
        bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
        type = 'image/jpeg'; name = 'Gemini_Generated_Image_a1b2c3d4e5f6.jpeg';
      } else {
        bytes = new Uint8Array([0x52,0x49,0x46,0x46,0x10,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x20,1,2,3,4]);
        type = 'image/webp'; name = 'hanalei-taro-1600.webp';
      }
      var u = URL.createObjectURL(new Blob([bytes], { type: type }));
      var l = document.createElement('a'); l.href = u; l.download = name; l.click();
    });
  }
  refresh();
})();
