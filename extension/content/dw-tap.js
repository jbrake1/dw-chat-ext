/* DW Chat Integration: page-world tap (fallback for editors that do not emit dw-ext-submit yet).
 * Injected by the service worker only after the DW content script confirmed an editor pass. It wraps window.fetch,
 * and when the existing "Suggest an edit" tool POSTs to /markup/ (a=submit) and DW answers ok, it posts the same
 * data as a dw-ext-submit message. It changes nothing about the request or the response. */
(function () {
  'use strict';
  if (window.__dwExtTap) return;
  window.__dwExtTap = true;
  var orig = window.fetch;
  window.fetch = function (input, init) {
    var p = orig.apply(this, arguments);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var body = init && init.body;
      if (method === 'POST' && body instanceof FormData && new URL(url, location.href).pathname.replace(/\/+$/, '') === '/markup' && body.get('a') === 'submit') {
        var snap = {
          note: String(body.get('note') || ''), pageUrl: String(body.get('page_url') || location.href),
          element: { selectors: safeJson(body.get('selectors')), capture: String(body.get('capture') || ''), viewport: String(body.get('viewport') || '') },
          image: body.get('image')
        };
        p.then(function (r) { return r.clone().json(); }).then(function (j) {
          if (j && j.ok) emit(snap, j.id);
        }).catch(function () {});
      }
    } catch (e) { /* never break the page's own request */ }
    return p;
  };
  function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function emit(snap, id) {
    function post(dataUrl) {
      window.postMessage({ source: 'dw-edit-tap', type: 'dw-ext-submit', v: 1, id: String(id || ''), screenshot: dataUrl, note: snap.note, pageUrl: snap.pageUrl, element: snap.element }, location.origin);
    }
    if (snap.image && typeof snap.image === 'object' && snap.image.size) {
      var fr = new FileReader();
      fr.onload = function () { post(String(fr.result)); };
      fr.onerror = function () { post(null); };
      fr.readAsDataURL(snap.image);
    } else post(null);
  }
})();
