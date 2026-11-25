/* DW Chat Integration: page-world upload hook for chat sites that open the OS file chooser from script (v0.1.9).
 * Injected by the manifest (gemini.google.com, document_start) and by the service worker into tabs that were already open.
 * It only does anything while the extension has ARMED it with files, for a few seconds, around ONE click the extension makes
 * itself on the site's own "Upload files" menu item. In that window, when the site's code calls click() on an
 * <input type=file>, the files go straight into that input (input + change events) and the OS file chooser never opens.
 * Otherwise it calls the original click. It reads nothing from the page and sends nothing anywhere.
 * v0.1.12 adds a second, separate job: fetching the files the AI made (see below), only when the extension asks. */
(function () {
  'use strict';
  if (window.__dwAiHook) return;
  var state = { armed: null, timer: null };
  window.__dwAiHook = state;
  var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
  if (!proto || typeof proto.click !== 'function') return;
  var orig = proto.click;
  function reply(type, extra) {
    try { window.postMessage(Object.assign({ source: 'dw-ext-hook-reply', type: type }, extra || {}), location.origin); } catch (e) {}
  }
  function disarm() { state.armed = null; if (state.timer) { clearTimeout(state.timer); state.timer = null; } }
  proto.click = function () {
    var a = state.armed;
    if (a && this && String(this.type).toLowerCase() === 'file') {
      disarm();
      var input = this;
      try {
        var dt = new DataTransfer();
        a.files.forEach(function (f) { dt.items.add(f); });
        try { input.files = dt.files; } catch (e0) { Object.defineProperty(input, 'files', { value: dt.files, configurable: true }); }
        // After this call returns, so handlers the site attaches right after click() still see the events.
        setTimeout(function () {
          try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            reply('fired', { n: dt.files.length });
          } catch (e) { reply('error', { msg: 'dispatch' }); }
        }, 0);
        return;
      } catch (e) { reply('error', { msg: 'files' }); }
    }
    return orig.apply(this, arguments);
  };
  // ---------- v0.1.12: files the AI made (download chips) ----------
  // 'fetch': read one file the reply links to (blob:, data: or https) with the page's own access, and hand the bytes
  // back to the content script. 'capture': for a few seconds around ONE click the extension makes on a chip's own
  // download button, catch the file the site's code is about to save (a blob URL, an <a download> click or a
  // window.open) and hand its bytes back instead of saving it to disk. Nothing else is read or changed.
  var MAX_FETCH = 12 * 1024 * 1024;
  var cap = { on: null, timer: null, blobs: {} };
  function okUrl(u) { return /^(blob:|data:|https:)/i.test(String(u || '')); }
  function bytesOf(url) {
    return fetch(url, { credentials: 'include', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      var len = +(r.headers.get('content-length') || 0);
      if (len && len > MAX_FETCH) throw new Error('too_large');
      var type = (r.headers.get('content-type') || '').split(';')[0].trim();
      return r.arrayBuffer().then(function (buf) { if (buf.byteLength > MAX_FETCH) throw new Error('too_large'); return { buf: buf, type: type }; });
    });
  }
  function sendBytes(id, name, got) {
    try { window.postMessage({ source: 'dw-ext-hook-reply', type: 'bytes', id: id, ok: true, name: name || '', mime: got.type || '', buf: got.buf }, location.origin, [got.buf]); }
    catch (e) { reply('bytes', { id: id, ok: false, err: 'post' }); }
  }
  function capEnd() { cap.on = null; cap.blobs = {}; if (cap.timer) { clearTimeout(cap.timer); cap.timer = null; } }
  function captured(url, name) {
    var c = cap.on; if (!c) return false;
    capEnd();
    var blob = Object.prototype.hasOwnProperty.call(c.blobs, url) ? c.blobs[url] : null;
    var p = blob ? blob.arrayBuffer().then(function (buf) { return { buf: buf, type: blob.type || '' }; }) : (okUrl(url) ? bytesOf(url) : Promise.reject(new Error('bad_url')));
    p.then(function (got) { sendBytes(c.id, name, got); }, function (e) { reply('bytes', { id: c.id, ok: false, err: String(e && e.message || 'fetch').slice(0, 40) }); });
    return true;
  }
  var origCreate = window.URL && window.URL.createObjectURL;
  if (origCreate) {
    window.URL.createObjectURL = function (obj) {
      var u = origCreate.apply(this, arguments);
      try { if (cap.on && obj && typeof obj.arrayBuffer === 'function' && obj.size <= MAX_FETCH) cap.on.blobs[u] = obj; } catch (e) {}
      return u;
    };
  }
  var aProto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
  var origAClick = aProto && aProto.click;
  if (origAClick) {
    aProto.click = function () {
      if (cap.on && this && (this.hasAttribute('download') || /^blob:/i.test(this.href || ''))) { if (captured(this.href, this.getAttribute('download') || '')) return; }
      return origAClick.apply(this, arguments);
    };
  }
  window.addEventListener('click', function (ev) {
    if (!cap.on) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (a && (a.hasAttribute('download') || /^blob:/i.test(a.href || ''))) { ev.preventDefault(); captured(a.href, a.getAttribute('download') || ''); }
  }, true);
  var origOpen = window.open;
  window.open = function (url) {
    if (cap.on && url && okUrl(String(url))) { captured(String(url), ''); return null; }
    return origOpen.apply(this, arguments);
  };
  window.addEventListener('message', function (ev) {
    if ((ev.source && ev.source !== window) || (ev.origin && ev.origin !== location.origin)) return;
    var d = ev.data;
    if (!d || d.source !== 'dw-ext-hook') return;
    if (d.type === 'fetch' && d.id && okUrl(d.url)) {
      bytesOf(String(d.url)).then(function (got) { sendBytes(d.id, '', got); }, function (e) { reply('bytes', { id: d.id, ok: false, err: String(e && e.message || 'fetch').slice(0, 40) }); });
    } else if (d.type === 'capture' && d.id) {
      capEnd();
      cap.on = { id: d.id, blobs: {} };
      cap.timer = setTimeout(function () { var id = cap.on && cap.on.id; capEnd(); if (id) reply('bytes', { id: id, ok: false, err: 'no_download' }); }, Math.min(15000, Math.max(1000, d.ttlMs | 0 || 8000)));
      reply('capturing', { id: d.id });
    } else if (d.type === 'capture_off') { capEnd(); }
  });
  window.addEventListener('message', function (ev) {
    if ((ev.source && ev.source !== window) || (ev.origin && ev.origin !== location.origin)) return;
    var d = ev.data;
    if (!d || d.source !== 'dw-ext-hook') return;
    if (d.type === 'ping') { reply('pong'); return; }
    if (d.type === 'arm' && Array.isArray(d.files) && d.files.length) {
      disarm();
      state.armed = { files: d.files };
      state.timer = setTimeout(disarm, Math.min(15000, Math.max(1000, d.ttlMs | 0 || 8000)));
      reply('armed');
    } else if (d.type === 'disarm') { disarm(); reply('disarmed'); }
  });
})();
