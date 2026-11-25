/* DW Chat Integration: files the AI made (v0.1.12).
 * Some chat sites hand back files they made with code (for example a resized picture) as download chips under the reply,
 * not as code. This reads those chips in the newest reply, once the reply is done, and gets each file's bytes so the editor
 * can stage it at the path the reply names. Generic: which elements are chips, which button downloads one, and which hosts
 * may be fetched all come from instr.steps.files.generated. Nothing is clicked except a chip's own download button, and
 * never one the instructions' guard forbids. A chip whose bytes cannot be read is reported by name only.
 * Result: { assets: [{name, mime, b64, size, via}], missed: [{name, why}], tags: n }  (tags = "[file-tag: ...]" text left
 * in the reply where the site failed to show a chip). */
(function (root, factory) {
  var I = (typeof module === 'object' && module.exports) ? require('./interpreter.js') : root.DWX;
  var api = factory(I);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function (I) {
  'use strict';
  var EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', css: 'text/css', html: 'text/html', htm: 'text/html', js: 'text/javascript', json: 'application/json', pdf: 'application/pdf', txt: 'text/plain' };
  var NAME_RE = /([A-Za-z0-9][A-Za-z0-9._-]{0,118}\.(?:png|jpe?g|gif|webp|svg|css|html?|js|json|pdf|txt))(?![A-Za-z0-9])/i;
  var LIM = { files: 8, file: 10 * 1024 * 1024, total: 30 * 1024 * 1024 };

  function extOf(name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function cleanName(n) {
    n = String(n || '').trim().split(/[\\/]/).pop().replace(/\s+/g, '-');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(n) || !EXT_MIME[extOf(n)]) return '';
    return n;
  }
  function nameIn(text) { var m = NAME_RE.exec(String(text || '')); return m ? cleanName(m[1]) : ''; }
  // Do the bytes look like the type the name says? Text types must decode as UTF-8 without NULs.
  function bytesMatch(name, u8) {
    var e = extOf(name), h = function (i) { return u8[i]; };
    if (!u8 || !u8.length) return false;
    if (e === 'png') return h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4E && h(3) === 0x47;
    if (e === 'jpg' || e === 'jpeg') return h(0) === 0xFF && h(1) === 0xD8 && h(2) === 0xFF;
    if (e === 'gif') return h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46;
    if (e === 'webp') return u8.length > 12 && h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46 && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50;
    if (e === 'pdf') return h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46;
    for (var i = 0; i < Math.min(u8.length, 65536); i++) if (u8[i] === 0) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(0, Math.min(u8.length, 1 << 20))); return true; } catch (e2) { return false; }
  }
  function b64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return (typeof btoa === 'function' ? btoa : function (x) { return Buffer.from(x, 'binary').toString('base64'); })(s);
  }
  function fromDataUrl(u) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/i.exec(String(u || ''));
    if (!m) return null;
    try {
      if (m[2]) { var bin = atob(m[3]); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
      return new TextEncoder().encode(decodeURIComponent(m[3]));
    } catch (e) { return null; }
  }
  function hostOk(url, allowed, win) {
    if (/^(blob|data):/i.test(url)) return true;
    var h = ''; try { h = new win.URL(url, win.location.href).hostname; } catch (e) { return false; }
    if (h === win.location.hostname) return true;
    return (allowed || []).some(function (a) { return h === a || h.slice(-a.length - 1) === '.' + a; });
  }

  // ---- talking to the page-world hook (content/ai-hook.js) ----
  var seq = 0;
  function hookCall(win, msg, ms) {
    var id = 'a' + Date.now().toString(36) + (++seq);
    return new Promise(function (res) {
      var t = null;
      function done(v) { win.removeEventListener('message', on); if (t != null) win.clearTimeout(t); res(v); }
      function on(ev) {
        var d = ev && ev.data;
        if ((!ev.source || ev.source === win) && d && d.source === 'dw-ext-hook-reply' && d.type === 'bytes' && d.id === id) {
          done(d.ok && d.buf ? { ok: true, u8: new Uint8Array(d.buf), mime: d.mime || '', name: d.name || '' } : { ok: false, why: d.err || 'failed' });
        }
      }
      win.addEventListener('message', on);
      t = win.setTimeout(function () { if (msg.type === 'capture') post(win, { type: 'capture_off' }); done({ ok: false, why: 'timeout' }); }, ms);
      post(win, Object.assign({ id: id }, msg));
    });
  }
  // Arm the hook's catcher, wait until it says it is ready, then click the chip's own download button once.
  function captureClick(win, btn, ms) {
    var id = 'c' + Date.now().toString(36) + (++seq);
    return new Promise(function (res) {
      var t = null, clicked = false;
      function done(v) { win.removeEventListener('message', on); if (t != null) win.clearTimeout(t); res(v); }
      function on(ev) {
        var d = ev && ev.data;
        if ((ev.source && ev.source !== win) || !d || d.source !== 'dw-ext-hook-reply' || d.id !== id) return;
        if (d.type === 'capturing' && !clicked) { clicked = true; try { btn.click(); } catch (e) { post(win, { type: 'capture_off' }); done({ ok: false, why: 'click' }); } return; }
        if (d.type === 'bytes') done(d.ok && d.buf ? { ok: true, u8: new Uint8Array(d.buf), mime: d.mime || '', name: d.name || '' } : { ok: false, why: d.err || 'failed' });
      }
      win.addEventListener('message', on);
      t = win.setTimeout(function () { post(win, { type: 'capture_off' }); done({ ok: false, why: clicked ? 'timeout' : 'hook' }); }, ms + 1500);
      post(win, { type: 'capture', id: id, ttlMs: ms });
    });
  }
  function post(win, m) { try { win.postMessage(Object.assign({ source: 'dw-ext-hook' }, m), win.location.origin || '*'); } catch (e) {} }
  function hookAlive(win, ms) {
    return new Promise(function (res) {
      var t = null;
      function on(ev) { var d = ev && ev.data; if (d && d.source === 'dw-ext-hook-reply' && d.type === 'pong') { win.removeEventListener('message', on); win.clearTimeout(t); res(true); } }
      win.addEventListener('message', on);
      t = win.setTimeout(function () { win.removeEventListener('message', on); res(false); }, ms);
      post(win, { type: 'ping' });
    });
  }
  // Content-script fetch, for sites without the hook (same-origin and data: only).
  function directFetch(win, url) {
    if (/^data:/i.test(url)) { var u8 = fromDataUrl(url); return Promise.resolve(u8 ? { ok: true, u8: u8, mime: '' } : { ok: false, why: 'data' }); }
    return win.fetch(url, { credentials: 'include', cache: 'no-store' }).then(function (r) {
      if (!r.ok) return { ok: false, why: 'http_' + r.status };
      return r.arrayBuffer().then(function (b) { return { ok: true, u8: new Uint8Array(b), mime: (r.headers.get('content-type') || '').split(';')[0] }; });
    }, function () { return { ok: false, why: 'fetch' }; });
  }

  // ---- finding the chips ----
  function inCode(el, stop) {
    for (var n = el; n && n !== stop; n = n.parentElement) { var t = (n.tagName || '').toUpperCase(); if (t === 'PRE' || t === 'CODE' || t === 'CODE-BLOCK') return true; }
    return false;
  }
  function attrName(el) {
    if (!el || !el.getAttribute) return '';
    return cleanName(el.getAttribute('download')) || nameIn(el.getAttribute('aria-label')) || nameIn(el.getAttribute('title')) || nameIn(el.getAttribute('data-file-name')) || nameIn(el.getAttribute('alt'));
  }
  function chipName(el) {
    var n = attrName(el); if (n) return n;
    var inner = el.querySelectorAll ? el.querySelectorAll('[download],[aria-label],[title],[data-file-name],img[alt]') : [];
    for (var i = 0; i < inner.length && !n; i++) n = attrName(inner[i]);
    return n || nameIn(el.textContent);
  }
  function chipUrl(el, cfg) {
    var list = [el].concat(Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll('a[href], img[src]') : []));
    for (var i = 0; i < list.length; i++) {
      var u = list[i].getAttribute('href') || list[i].getAttribute('src') || '';
      if (u && /^(blob:|data:|https:)/i.test(u)) return u;
    }
    return '';
  }
  function chipButton(el, cfg, guard) {
    var sels = cfg.downloadSelectors || [];
    for (var i = 0; i < sels.length; i++) {
      var sel = I.normSel(sels[i]), hits = I.matchOne(el, sel);
      try {
        if (el.matches && el.matches(sel.css) && (!sel.textMatches || new RegExp(sel.textMatches, 'i').test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')))) hits.unshift(el);
      } catch (e) {}
      for (var j = 0; j < hits.length; j++) if (!I.blockedByGuard(hits[j], guard)) return hits[j];
    }
    return null;
  }
  // The container a chip lives in: climb from the name until the box holds the chip's own link or download button,
  // and never so far that it holds another file's name.
  function hasAction(box, cfg) {
    if (box.matches && box.matches('a[href], img[src]')) return true;
    if (box.querySelector && box.querySelector('a[href], img[src]')) return true;
    return (cfg.downloadSelectors || []).some(function (s) { return I.matchOne(box, s).length > 0; });
  }
  function chipBox(el, target, cfg, name) {
    var box = el, up = 0, max = cfg.climb == null ? 4 : cfg.climb;
    while (!hasAction(box, cfg) && box.parentElement && box.parentElement !== target && up < max) {
      var p = box.parentElement;
      var others = namesBelow(p).filter(function (x) { return x !== name.toLowerCase(); });
      if (others.length || String(p.textContent || '').length > 400) break;
      box = p; up++;
    }
    return box;
  }
  function wholeName(el) {
    var t = String(el.textContent || '').trim();
    if (!t || t.length > 125 || el.children.length > 2) return '';
    var n = cleanName(t);
    return n && n === t.replace(/\s+/g, '-') ? n : '';
  }
  function namesBelow(el) {
    var set = {}, list = [el].concat(Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll('*') : []));
    list.forEach(function (n) { var a = wholeName(n) || cleanName(n.getAttribute && n.getAttribute('download')); if (a) set[a.toLowerCase()] = 1; });
    return Object.keys(set);
  }
  function findChips(win, target, cfg) {
    var out = [], seen = new Set(), names = {};
    function add(el, how) {
      if (!el || seen.has(el) || inCode(el, target)) return;
      if (how === 'selector' && namesBelow(el).length > 1) return;                        // a list of files, not one chip: its names are found one by one below
      var name = chipName(el); if (!name || names[name.toLowerCase()]) return;
      var box = chipBox(el, target, cfg, name);
      if (how === 'name' && !(box.matches && box.matches('a, button, [role=button]')) && !(box.querySelector && box.querySelector('a, button, [role=button], img'))) return;   // a name in the text, not a chip
      seen.add(el); seen.add(box); names[name.toLowerCase()] = 1;
      out.push({ el: box, name: name, how: how });
    }
    (cfg.selectors || []).forEach(function (s) { I.matchOne(target, s).forEach(function (el) { add(el, 'selector'); }); });
    if (cfg.textNames !== false) {
      // An element whose whole text is a file name (how chips show the name), not inside code.
      var all = target.querySelectorAll('*');
      for (var i = 0; i < all.length && out.length < LIM.files * 2; i++) {
        if (wholeName(all[i])) add(all[i], 'name');
      }
    }
    return out.slice(0, LIM.files);
  }
  function countTags(text, cfg) {
    var re; try { re = new RegExp(cfg.tagText || '\\[file-tag:\\s*[^\\]]{1,120}\\]', 'gi'); } catch (e) { return 0; }
    return (String(text || '').match(re) || []).length;
  }

  // ---- collect ----
  async function collectAssets(win, doc, instr, baseline, env) {
    env = env || {};
    var steps = instr.steps || {}, cfg = steps.files && steps.files.generated;
    var res = { assets: [], missed: [], tags: 0 };
    if (!cfg) return res;
    var msgs = I.resolveAll(doc, steps.assistantMessage.selectors).els;
    if (msgs.length <= (baseline || 0)) return res;
    var target = (steps.assistantMessage.pick === 'first-new') ? msgs[baseline] : msgs[msgs.length - 1];
    res.tags = countTags(target.textContent, cfg);
    var chips = findChips(win, target, cfg);
    if (!chips.length) return res;
    var hook = cfg.useHook ? await hookAlive(win, 600) : false;
    if (cfg.useHook && !hook && env.ensureHook) { try { await env.ensureHook(); } catch (e) {} hook = await hookAlive(win, 1500); }
    var total = 0, t0 = Date.now(), budget = cfg.timeoutMs || 25000;
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i], got = null, via = '';
      if (Date.now() - t0 > budget) { res.missed.push({ name: c.name, why: 'time' }); continue; }
      var url = chipUrl(c.el, cfg);
      if (url && hostOk(url, cfg.allowedHosts, win)) {
        got = hook ? await hookCall(win, { type: 'fetch', url: url }, cfg.fetchMs || 12000) : await directFetch(win, url);
        via = 'link';
      }
      if ((!got || !got.ok) && hook && cfg.click !== false) {
        var btn = chipButton(c.el, cfg, instr.guard);
        if (btn) { got = await captureClick(win, btn, cfg.captureMs || 8000); via = 'download'; }
      }
      if (!got || !got.ok) { res.missed.push({ name: c.name, why: (got && got.why) || (url ? 'fetch' : 'no_link') }); continue; }
      var name = c.name;
      if (!bytesMatch(name, got.u8)) { res.missed.push({ name: name, why: 'type' }); continue; }
      if (got.u8.length > LIM.file || total + got.u8.length > LIM.total) { res.missed.push({ name: name, why: 'size' }); continue; }
      total += got.u8.length;
      res.assets.push({ name: name, mime: EXT_MIME[extOf(name)], b64: b64(got.u8), size: got.u8.length, via: via });
    }
    return res;
  }

  return { collectAssets: collectAssets, findChips: findChips, bytesMatch: bytesMatch, assetName: cleanName, ASSET_LIM: LIM };
});
