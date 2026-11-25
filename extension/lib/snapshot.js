/* DW Chat Integration: redacted structure snapshot of an AI chat page (v0.1.8).
 * For debugging selectors. Keeps tags, id/class/role, aria-*, data-* and testid, contenteditable/disabled,
 * shadow and iframe structure, and button / label / placeholder text. Chat text and input values become
 * length markers. Scripts, styles and query strings are dropped. Works in the page and in node (jsdom). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var MAX_BYTES = 300 * 1024;
  var MAX_NODES = 8000;
  var MAX_TEXT = 80;
  var DROP_TAG = /^(SCRIPT|STYLE|LINK|NOSCRIPT|META|TEMPLATE|BASE)$/i;
  var VOID_TAG = /^(AREA|BR|COL|EMBED|HR|IMG|INPUT|PARAM|SOURCE|TRACK|WBR)$/i;
  var KEEP_ATTR = /^(id|class|role|contenteditable|disabled|placeholder|type|name|for|hidden|tabindex|part|slot|open|multiple|checked|selected|readonly|aria-.*|data-.*|testid|test-id)$/i;
  var URL_ATTR = /^(href|src|action|poster|formaction|cite)$/i;
  var SEL_KEYS = { selectors: 1, textSelectors: 1, openSelectors: 1, itemSelectors: 1, ignoreSelectors: 1, langSelectors: 1 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function marker(s) {
    var n = String(s || '').replace(/\s+/g, ' ').trim().length;
    return n ? '#' + n : '';
  }
  function cap(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s;
  }
  function cleanUrl(v, base) {
    try {
      var u = new URL(String(v), base || (typeof location !== 'undefined' ? location.href : 'https://invalid.example/'));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.origin + u.pathname;
    } catch (e) { return ''; }
  }
  function keepText(el) {
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'LABEL' || tag === 'SUMMARY' || tag === 'LEGEND' || tag === 'OPTION') return true;
    var role = (el.getAttribute && (el.getAttribute('role') || '')) || '';
    return role === 'button' || role === 'menuitem' || role === 'tab';
  }
  function isBtnInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    return t === 'submit' || t === 'button' || t === 'reset';
  }
  function attrVal(name, raw, base) {
    if (URL_ATTR.test(name)) return cleanUrl(raw, base);
    var s = String(raw == null ? '' : raw);
    // Keep short structural tokens (data-* hooks, aria-label of a button). Longer values are treated as content.
    if (s.length > MAX_TEXT || /[\r\n]/.test(s)) return marker(s);
    return s;
  }
  function collectRoots(doc, stats, seen, out, depth) {
    if (!doc || seen.indexOf(doc) >= 0 || depth > 8) return;
    seen.push(doc);
    out.push(doc);
    try {
      var all = doc.querySelectorAll ? doc.querySelectorAll('*') : [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.shadowRoot) { stats.shadows++; collectRoots(el.shadowRoot, stats, seen, out, depth + 1); }
        if (el.tagName === 'IFRAME') {
          stats.iframes++;
          try {
            var idoc = el.contentDocument;
            if (idoc && idoc.documentElement) collectRoots(idoc, stats, seen, out, depth + 1);
          } catch (e) { /* cross-origin */ }
        }
      }
    } catch (e) {}
  }
  function serialize(el, base, state) {
    if (!el || state.bytes >= MAX_BYTES || state.nodes >= MAX_NODES) { state.truncated = true; return ''; }
    if (el.nodeType === 3) {
      var t = el.nodeValue;
      if (!t || !String(t).trim()) return '';
      var keep = el.parentElement && keepText(el.parentElement);
      var out = keep ? esc(cap(t)) : esc(marker(t));
      if (out) { state.bytes += out.length; }
      return out;
    }
    if (el.nodeType !== 1) return '';
    var tag = el.tagName;
    if (!tag || DROP_TAG.test(tag)) return '';
    state.nodes++;
    var name = tag.toLowerCase();
    var parts = '<' + name;
    var attrs = el.attributes;
    if (attrs) {
      for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i], an = a.name;
        if (URL_ATTR.test(an) || KEEP_ATTR.test(an)) {
          var v = attrVal(an, a.value, base);
          if (an === 'value' && !isBtnInput(el)) v = marker(a.value);
          parts += ' ' + an + '="' + esc(v) + '"';
        }
      }
    }
    // input/textarea/select values live on the property, which may differ from the attribute
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !isBtnInput(el)) {
      var val = '';
      try { val = el.value; } catch (e) {}
      if (val) parts += ' value="' + esc(marker(val)) + '"';
    } else if (isBtnInput(el)) {
      try { if (el.value) parts += ' value="' + esc(cap(el.value)) + '"'; } catch (e) {}
    }
    if (el.shadowRoot) parts += ' data-dw-shadow="open"';
    if (tag === 'IFRAME') {
      var kind = 'empty';
      try { kind = (el.contentDocument && el.contentDocument.documentElement) ? 'same-origin' : (el.src ? 'cross-origin' : 'empty'); } catch (e) { kind = 'cross-origin'; }
      parts += ' data-dw-iframe="' + kind + '"';
    }
    if (VOID_TAG.test(tag)) { parts += '/>'; state.bytes += parts.length; return parts; }
    parts += '>';
    state.bytes += parts.length;
    var inner = '';
    if (el.shadowRoot) {
      inner += '<!--shadow-root-->' + serializeChildren(el.shadowRoot, base, state) + '<!--/shadow-root-->';
    }
    if (tag === 'IFRAME') {
      try {
        var idoc = el.contentDocument;
        if (idoc && idoc.documentElement) inner += '<!--iframe-->' + serialize(idoc.documentElement, base, state) + '<!--/iframe-->';
      } catch (e) {}
    }
    inner += serializeChildren(el, base, state);
    var close = '</' + name + '>';
    state.bytes += close.length;                                // (children already counted their own bytes)
    if (state.bytes >= MAX_BYTES) { state.truncated = true; }
    return parts + inner + close;
  }
  function serializeChildren(parent, base, state) {
    var s = '', ch = parent.childNodes;
    if (!ch) return s;
    for (var i = 0; i < ch.length; i++) {
      if (state.bytes >= MAX_BYTES || state.nodes >= MAX_NODES) { state.truncated = true; break; }
      s += serialize(ch[i], base, state);
    }
    return s;
  }

  function collectSelectors(instr) {
    var out = [];
    function walk(o, path) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(function (v, i) { walk(v, path + '[' + i + ']'); }); return; }
      Object.keys(o).forEach(function (k) {
        var p = path ? path + '.' + k : k;
        if (SEL_KEYS[k] && Array.isArray(o[k])) {
          o[k].forEach(function (s, i) {
            var rec = { path: p + '[' + i + ']' };
            if (typeof s === 'string') rec.css = s;
            else if (s && typeof s.css === 'string') {
              rec.css = s.css;
              if (typeof s.textMatches === 'string') rec.textMatches = s.textMatches;
              if (s.visible != null) rec.visible = !!s.visible;
            } else return;
            out.push(rec);
          });
          return;
        }
        walk(o[k], p);
      });
    }
    walk(instr, '');
    return out;
  }

  function visible(el) {
    try {
      var st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      var r = el.getBoundingClientRect && el.getBoundingClientRect();
      if (r && (r.width || r.height)) return true;
      // jsdom / zero-box: treat as visible unless explicitly hidden
      return !r || (r.width === 0 && r.height === 0 && !st);
    } catch (e) { return false; }
  }

  function matchOne(rec, roots) {
    rec.count = 0;
    rec.pass = false;
    var nodes = [];
    try {
      for (var r = 0; r < roots.length; r++) {
        var found = roots[r].querySelectorAll(rec.css);
        for (var i = 0; i < found.length; i++) nodes.push(found[i]);
      }
    } catch (e) { rec.error = 'bad_selector'; rec.count = 0; rec.pass = false; return rec; }
    var rx = null;
    if (rec.textMatches) {
      try { rx = new RegExp(rec.textMatches, 'i'); } catch (e) { rec.error = 'bad_textMatches'; rec.count = 0; rec.pass = false; return rec; }
    }
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (rx) {
        var text = '';
        try { text = (el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''); } catch (e) {}
        if (!rx.test(text)) continue;
      }
      if (rec.visible && !visible(el)) continue;
      n++;
    }
    rec.count = n;
    rec.pass = n > 0;
    return rec;
  }

  function hostOf(win) {
    try { return String((win && win.location && win.location.hostname) || '').toLowerCase(); } catch (e) { return ''; }
  }

  function pageSnapshot(win, instr) {
    var doc = win.document;
    var stats = { nodes: 0, shadows: 0, iframes: 0, bytes: 0, truncated: false };
    var roots = [], seen = [];
    collectRoots(doc, stats, seen, roots, 0);
    var state = { nodes: 0, bytes: 0, truncated: false };
    var base = 'https://invalid.example/';
    try { base = win.location.href; } catch (e) {}
    var dom = serialize(doc.documentElement, base, state);
    stats.nodes = state.nodes;
    stats.bytes = state.bytes;
    stats.truncated = !!state.truncated;
    var selectors = collectSelectors(instr || {}).map(function (s) { return matchOne(s, roots); });
    return {
      ok: true,
      host: hostOf(win),
      dom: dom,
      selectors: selectors,
      stats: stats
    };
  }

  return { pageSnapshot: pageSnapshot, collectSelectors: collectSelectors };
});
