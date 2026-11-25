/* DW Chat Integration: page-world upload hook for chat sites that open the OS file chooser from script (v0.1.9).
 * Injected by the manifest (gemini.google.com, document_start) and by the service worker into tabs that were already open.
 * It only does anything while the extension has ARMED it with files, for a few seconds, around ONE click the extension makes
 * itself on the site's own "Upload files" menu item. In that window, when the site's code calls click() on an
 * <input type=file>, the files go straight into that input (input + change events) and the OS file chooser never opens.
 * Otherwise it calls the original click. It reads nothing from the page and sends nothing anywhere. */
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
