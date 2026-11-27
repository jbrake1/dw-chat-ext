/* DW Chat Integration: generic site-instructions interpreter.
 * This file contains NO knowledge of any chat site. Everything site-specific (selectors, strategies, timings,
 * done rule) comes from the instructions JSON (bundled default, or the remote file the service worker downloaded).
 * All DOM access goes through a `win` (window) argument so it runs in a content script and in jsdom unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function StepError(step, code, message) {
    var e = new Error(message || (step + ': ' + code));
    e.name = 'StepError'; e.step = step; e.code = code;
    return e;
  }

  // ---------- selectors ----------
  // A selector entry is a CSS string, or {css, textMatches?, visible?}. A step lists entries in priority order.
  function normSel(s) { return typeof s === 'string' ? { css: s } : s; }

  function isVisible(el) {
    if (!el.getClientRects) return true;
    return el.getClientRects().length > 0;
  }

  // v0.1.15: chat UIs often put the transcript in a (sometimes closed) shadow root, while the composer
  // stays in the light DOM. Light-DOM query first; if it misses, walk open and closed shadow roots.
  function shadowOf(el) {
    if (!el) return null;
    try { if (el.shadowRoot) return el.shadowRoot; } catch (e) {}
    try { if (typeof el.openOrClosedShadowRoot !== 'undefined' && el.openOrClosedShadowRoot) return el.openOrClosedShadowRoot; } catch (e2) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot) return chrome.dom.openOrClosedShadowRoot(el) || null;
    } catch (e3) {}
    return null;
  }
  function queryAllDeep(rootNode, css, cap) {
    var out = [], capN = cap || 4000;
    if (!rootNode) return out;
    function walk(root) {
      if (!root || out.length >= capN) return;
      var list = [];
      try { list = root.querySelectorAll ? root.querySelectorAll(css) : []; } catch (e) { list = []; }
      for (var i = 0; i < list.length && out.length < capN; i++) if (out.indexOf(list[i]) < 0) out.push(list[i]);
      if (root.nodeType === 1) { var s0 = shadowOf(root); if (s0) walk(s0); }
      var all = [];
      try { all = root.querySelectorAll ? root.querySelectorAll('*') : []; } catch (e2) { return; }
      for (var j = 0; j < all.length && out.length < capN; j++) {
        var sh = shadowOf(all[j]);
        if (sh) walk(sh);
      }
    }
    walk(rootNode);
    return out;
  }
  function matchOne(rootNode, sel) {
    sel = normSel(sel);
    var list;
    try { list = Array.prototype.slice.call(rootNode.querySelectorAll(sel.css)); } catch (e) { list = []; }
    if (!list.length) list = queryAllDeep(rootNode, sel.css);
    if (sel.textMatches) {
      var re;
      try { re = new RegExp(sel.textMatches, 'i'); } catch (e) { return []; }
      list = list.filter(function (el) { return re.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')); });
    }
    if (sel.visible) list = list.filter(isVisible);
    return list;
  }

  // First selector entry (in order) that matches anything wins. index = which entry matched (0 = primary).
  function resolveAll(rootNode, selectors) {
    var list = selectors || [];
    for (var i = 0; i < list.length; i++) {
      var els = matchOne(rootNode, list[i]);
      if (els.length) return { els: els, index: i };
    }
    return { els: [], index: -1 };
  }
  function resolve(rootNode, selectors, accept) {
    var list = selectors || [];
    for (var i = 0; i < list.length; i++) {
      var els = matchOne(rootNode, list[i]);
      for (var j = 0; j < els.length; j++) if (!accept || accept(els[j])) return { el: els[j], index: i };
    }
    return { el: null, index: -1 };
  }

  function isEnabled(el) {
    return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('data-disabled');
  }

  // v0.1.6: safety guard. instr.guard.neverClick is a list of case-insensitive regexes; the runner refuses to click any
  // element whose text or aria-label matches one (e.g. upgrade buttons, model pickers, share/delete/rename/settings).
  function guardRes(guard) {
    var out = [];
    ((guard && guard.neverClick) || []).forEach(function (src) { try { out.push(new RegExp(src, 'i')); } catch (e) {} });
    return out;
  }
  function blockedByGuard(el, guard) {
    var res = guardRes(guard);
    if (!res.length || !el) return false;
    var t = norm((el.textContent || '') + ' ' + ((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + ((el.getAttribute && el.getAttribute('title')) || ''));
    return res.some(function (re) { return re.test(t); });
  }
  function safeClick(el, guard, step) {
    if (blockedByGuard(el, guard)) throw StepError(step || 'guard', 'blocked_click');
    el.click();
  }

  // Wait until predicate() is true, re-checking on DOM mutations (no polling). One one-shot timer = the timeout.
  function waitUntil(win, doc, predicate, opts) {
    opts = opts || {};
    return new Promise(function (resolveP, reject) {
      var mo = null, timer = null;
      function cleanup() { if (mo) { mo.disconnect(); mo = null; } if (timer != null) { win.clearTimeout(timer); timer = null; } }
      function check() { var v = false; try { v = predicate(); } catch (e) {} if (v) { cleanup(); resolveP(true); } return v; }
      if (opts.signal && opts.signal.aborted) return reject(StepError(opts.step || 'wait', 'aborted'));
      if (check()) return;
      mo = new win.MutationObserver(check);
      mo.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true });
      timer = win.setTimeout(function () { cleanup(); reject(StepError(opts.step || 'wait', opts.timeoutCode || 'timeout')); }, opts.timeoutMs == null ? 10000 : opts.timeoutMs);
    });
  }

  // Wait for a selector list to match, using a MutationObserver (no polling). One one-shot timer = the timeout.
  function waitFor(win, rootNode, selectors, opts) {
    opts = opts || {};
    var step = opts.step || 'wait';
    return new Promise(function (resolveP, reject) {
      var doc = rootNode.ownerDocument || rootNode;
      var mo = null, timer = null;
      function cleanup() {
        if (mo) { mo.disconnect(); mo = null; }
        if (timer != null) { win.clearTimeout(timer); timer = null; }
        if (opts.signal && opts.signal.removeEventListener) opts.signal.removeEventListener('abort', onAbort);
      }
      function check() {
        var r = resolve(rootNode, selectors, opts.accept);
        if (r.el) { cleanup(); resolveP(r); return true; }
        return false;
      }
      function onAbort() { cleanup(); reject(StepError(step, 'aborted')); }
      if (opts.signal) {
        if (opts.signal.aborted) return reject(StepError(step, 'aborted'));
        opts.signal.addEventListener('abort', onAbort);
      }
      if (check()) return;
      mo = new win.MutationObserver(function () { check(); });
      mo.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true });
      timer = win.setTimeout(function () { cleanup(); reject(StepError(step, opts.timeoutCode || 'selector_not_found')); }, opts.timeoutMs == null ? 10000 : opts.timeoutMs);
    });
  }

  // ---------- text ----------
  function isTextInput(el) { var t = (el.tagName || '').toUpperCase(); return t === 'TEXTAREA' || t === 'INPUT'; }
  function textOf(el) { return (typeof el.innerText === 'string' && el.innerText !== '') ? el.innerText : (el.textContent || ''); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function promptText(el) { return isTextInput(el) ? el.value : (el.textContent || ''); }

  function fire(win, el, type, extra) {
    var ev;
    try { ev = new win.InputEvent(type, Object.assign({ bubbles: true, cancelable: type === 'beforeinput' }, extra || {})); }
    catch (e) { ev = new win.Event(type, { bubbles: true }); }
    el.dispatchEvent(ev);
  }

  function selectAllIn(win, el) {
    try {
      var sel = win.getSelection(); var r = win.document.createRange();
      r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) {}
  }

  var TEXT_STRATEGIES = {
    execCommand: function (win, el, text, clearFirst) {
      var doc = win.document;
      if (typeof doc.execCommand !== 'function') return false;
      el.focus();
      if (clearFirst) selectAllIn(win, el);
      return !!doc.execCommand('insertText', false, text);
    },
    paste: function (win, el, text, clearFirst) {
      if (!win.DataTransfer || !win.ClipboardEvent) return false;
      el.focus();
      if (clearFirst) selectAllIn(win, el);
      var dt = new win.DataTransfer(); dt.setData('text/plain', text);
      var ev = new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return true;
    },
    textContent: function (win, el, text) {
      el.focus && el.focus();
      el.textContent = text;
      fire(win, el, 'input', { inputType: 'insertText', data: text });
      return true;
    }
  };

  function setText(win, el, text, strategies, clearFirst) {
    if (isTextInput(el)) {
      el.focus && el.focus();
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text); else el.value = text;
      fire(win, el, 'input', { inputType: 'insertText', data: text });
      return 'nativeValue';
    }
    var want = norm(text).slice(0, 40);
    var list = strategies && strategies.length ? strategies : ['execCommand', 'paste', 'textContent'];
    for (var i = 0; i < list.length; i++) {
      var fn = TEXT_STRATEGIES[list[i]];
      if (!fn) continue;
      try {
        if (fn(win, el, text, clearFirst !== false) && norm(promptText(el)).indexOf(want) !== -1) return list[i];
      } catch (e) { /* try next strategy */ }
    }
    throw StepError('prompt', 'text_not_accepted');
  }

  // ---------- files ----------
  function fileFromDataUrl(win, f) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(f.dataUrl || '');
    if (!m) throw StepError('attach', 'bad_file');
    var bin = m[2] ? win.atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new win.Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new win.File([bytes], f.name || 'file', { type: f.type || m[1] || 'application/octet-stream' });
  }

  // file: one File or an array of Files (screenshot first, then page source files). All go in ONE DataTransfer,
  // so the chat site receives them as a single multi-file upload in the same message.
  function makeDataTransfer(win, file) {
    if (!win.DataTransfer) throw new Error('no DataTransfer');
    var dt = new win.DataTransfer();
    (Array.isArray(file) ? file : [file]).forEach(function (f) { dt.items.add(f); });
    return dt;
  }
  // Best effort: wait until the attachment chips for every file are shown (max of all confirm entries).
  // Never fails the job; the send step still waits for the send button to be enabled (uploads finished).
  // v0.1.9: per-selector match counts. Confirmation looks for GROWTH against the counts taken before the attempt, so a chip,
  // a "Remove" button or a blob thumbnail that was already on the page can never be mistaken for the new upload.
  function snapCounts(doc, selectors) { return (selectors || []).map(function (sel) { return matchOne(doc, sel).length; }); }
  function growth(doc, selectors, before) {          // the largest increase over any one selector (one chip per file)
    var now = snapCounts(doc, selectors), best = 0;
    for (var i = 0; i < now.length; i++) { var g = now[i] - (before[i] || 0); if (g > best) best = g; }
    return best;
  }
  async function waitForGrowth(win, doc, selectors, before, n, timeoutMs, signal) {
    var t0 = Date.now(), best = 0;
    for (;;) {
      if (signal && signal.aborted) throw StepError('attach', 'aborted');
      best = growth(doc, selectors, before);
      if (best >= n || Date.now() - t0 >= timeoutMs) return best;
      await new Promise(function (r) { win.setTimeout(r, 150); });
    }
  }

  // ---------- v0.1.9: page-world upload hook (content/ai-hook.js) ----------
  function postHook(win, msg) {
    try { win.postMessage(Object.assign({ source: 'dw-ext-hook' }, msg), win.location.origin || '*'); } catch (e) { win.postMessage(Object.assign({ source: 'dw-ext-hook' }, msg), '*'); }
  }
  function hookWait(win, type, ms) {
    return new Promise(function (res, rej) {
      var t = null;
      function done() { win.removeEventListener('message', on); if (t != null) win.clearTimeout(t); }
      function on(ev) {
        var d = ev && ev.data;
        if ((!ev.source || ev.source === win) && d && d.source === 'dw-ext-hook-reply' && d.type === type) { done(); res(d); }
      }
      win.addEventListener('message', on);
      t = win.setTimeout(function () { done(); rej(StepError('attach', 'hook_timeout')); }, ms);
    });
  }
  async function ensureHook(win, env) {
    var pong = hookWait(win, 'pong', 500); postHook(win, { type: 'ping' });
    try { await pong; return; } catch (e) { /* not there yet: ask the service worker to inject it */ }
    if (env && env.ensureHook) { try { await env.ensureHook(); } catch (e) {} }
    var pong2 = hookWait(win, 'pong', 2000); postHook(win, { type: 'ping' });
    try { await pong2; } catch (e) { throw StepError('attach', 'hook_unavailable'); }
  }

  // The text files of a job as plain text for the "send them inside the message" fallback. Images and binaries are
  // skipped (and counted). Returns { text, used, skipped, bytes }.
  var TEXT_EXT = /\.(html?|css|js|mjs|json|txt|md|xml|svg|csv|tsv|php|py|rb|ya?ml|toml|ini|sh|ts|jsx|tsx|vue|svelte|sql|log)$/i;
  var TEXT_MIME = /^(text\/|application\/(json|javascript|xml|x-yaml|x-sh|x-php)|image\/svg)/i;
  function inlineFilesText(win, list, cfg) {
    cfg = cfg || {};
    var maxTotal = cfg.maxBytes || 120000, maxOne = cfg.maxFileBytes || 60000;
    var out = '', used = 0, skipped = 0, bytes = 0;
    (list || []).forEach(function (f) {
      var name = f.path || f.name || 'file';
      if (!(TEXT_MIME.test(f.type || f.mime || '') || TEXT_EXT.test(name))) { skipped++; return; }
      var m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(f.dataUrl || '');
      if (!m) { skipped++; return; }
      var txt;
      try {
        if (m[2]) {
          var bin = win.atob(m[3]), u8 = new win.Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          txt = new win.TextDecoder('utf-8').decode(u8);
        } else txt = decodeURIComponent(m[3]);
      } catch (e) { skipped++; return; }
      if (txt.length > maxOne) txt = txt.slice(0, maxOne) + '\n[... cut: file longer than ' + maxOne + ' characters ...]';
      var block = '\n\n----- FILE: ' + name + ' -----\n' + txt + '\n----- END FILE: ' + name + ' -----';
      if (bytes + block.length > maxTotal) { skipped++; return; }
      out += block; bytes += block.length; used++;
    });
    if (!used) return { text: '', used: 0, skipped: skipped, bytes: 0 };
    var head = '\n\n[The upload to this chat did not work, so the contents of ' + used + (used === 1 ? ' file is' : ' files are') + ' pasted below instead. There is no screenshot' + (skipped ? '; ' + skipped + ' other file' + (skipped === 1 ? ' was' : 's were') + ' left out' : '') + '.]';
    return { text: head + out, used: used, skipped: skipped, bytes: bytes };
  }

  var ATTACH_STRATEGIES = {
    fileInput: function (win, doc, strat, promptEl, file, given) {
      var r = (given && given.nodeType === 1) ? { el: given } : resolve(doc, strat.selectors);
      if (!r.el) throw StepError('attach', 'selector_not_found');
      var dt = makeDataTransfer(win, file);
      try { r.el.files = dt.files; } catch (e) { Object.defineProperty(r.el, 'files', { value: dt.files, configurable: true }); }
      r.el.dispatchEvent(new win.Event('input', { bubbles: true }));
      r.el.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    paste: function (win, doc, strat, promptEl, file) {
      var dt = makeDataTransfer(win, file);
      promptEl.focus && promptEl.focus();
      promptEl.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    // v0.1.6: open the site's upload menu (e.g. a "+" button), then hand the files to the file input the menu renders.
    // It never clicks the menu item that opens the OS file chooser unless itemSelectors is set, and even then any
    // click that reaches a file input is cancelled (no native dialog), the files are set on that input directly.
    menuFileInput: async function (win, doc, strat, promptEl, file, signal, guard) {
      var input = resolve(doc, strat.selectors).el;
      var block = null;
      try {
        if (!input) {
          var open = resolve(doc, strat.openSelectors).el;
          if (!open) throw StepError('attach', 'selector_not_found');
          safeClick(open, guard, 'attach');
          if (strat.itemSelectors && strat.itemSelectors.length) {
            var it = await waitFor(win, doc, strat.itemSelectors, { timeoutMs: strat.waitMs || 3000, step: 'attach', signal: signal });
            block = function (e) { var t = e.target; if (t && (t.tagName || '').toUpperCase() === 'INPUT' && String(t.type).toLowerCase() === 'file') e.preventDefault(); };
            doc.addEventListener('click', block, true);
            safeClick(it.el, guard, 'attach');
          }
          input = (await waitFor(win, doc, strat.selectors, { timeoutMs: strat.waitMs || 3000, step: 'attach', signal: signal })).el;
        }
        ATTACH_STRATEGIES.fileInput(win, doc, { selectors: [] }, promptEl, file, input);
      } finally {
        if (block) doc.removeEventListener('click', block, true);
        if (strat.closeMenu !== false) {
          try { (doc.activeElement || doc.body).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); } catch (e) {}
          try { promptEl && promptEl.focus && promptEl.focus(); } catch (e) {}
        }
      }
    },
    // v0.1.9 (Gemini): open the site's upload menu, arm the page-world hook with the files, click the site's own
    // "Upload files" item. The site calls input.click() to open the OS file chooser; the hook hands the files to that
    // input instead, so no dialog ever appears. Menu and item clicks go through the guard (never Upgrade, model picker, ...).
    hookedChooser: async function (win, doc, strat, promptEl, file, signal, guard, env) {
      var files = Array.isArray(file) ? file : [file];
      await ensureHook(win, env);
      var open = resolve(doc, strat.openSelectors).el;
      if (!open) throw StepError('attach', 'selector_not_found');
      try {
        if (!(open.getAttribute && open.getAttribute('aria-expanded') === 'true')) safeClick(open, guard, 'attach');
        var it = await waitFor(win, doc, strat.itemSelectors, { timeoutMs: strat.waitMs || 4000, step: 'attach', signal: signal, accept: function (el) { return !blockedByGuard(el, guard); } });
        var armed = hookWait(win, 'armed', 2000);
        postHook(win, { type: 'arm', files: files, ttlMs: 8000 });
        try { await armed; } catch (e) { throw StepError('attach', 'hook_unavailable'); }   // postMessage is async: be armed BEFORE the click
        var fired = hookWait(win, 'fired', 4000);
        fired.catch(function () {});
        try { it.el.scrollIntoView && it.el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        safeClick(it.el, guard, 'attach');
        try { await fired; } catch (e) { throw StepError('attach', 'chooser_not_hooked'); }
      } finally {
        postHook(win, { type: 'disarm' });
        try { (doc.activeElement || doc.body).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); } catch (e) {}
        try { promptEl && promptEl.focus && promptEl.focus(); } catch (e) {}
      }
    },
    drop: function (win, doc, strat, promptEl, file) {
      var target = strat.selectors ? (resolve(doc, strat.selectors).el || promptEl) : promptEl;
      var dt = makeDataTransfer(win, file);
      ['dragenter', 'dragover', 'drop'].forEach(function (t) {
        target.dispatchEvent(new win.DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }
  };

  async function attachFile(win, doc, step, promptEl, file, signal, guard, env) {
    var strategies = step.strategies || [];
    var lastCode = 'attach_failed', trace = [];
    var conf = step.confirm && step.confirm.selectors && step.confirm.selectors.length ? step.confirm : null;
    var n = Array.isArray(file) ? file.length : 1;
    for (var i = 0; i < strategies.length; i++) {
      var s = strategies[i];
      var fn = ATTACH_STRATEGIES[s.type];
      if (!fn) continue;
      var t0 = Date.now();
      var before = conf ? snapCounts(doc, conf.selectors) : [];
      try {
        if (s.type === 'fileInput' && s.waitMs) {
          try { await waitFor(win, doc, s.selectors, { timeoutMs: s.waitMs, step: 'attach', signal: signal }); } catch (e) { if (e.code === 'aborted') throw e; }
        }
        await fn(win, doc, s, promptEl, file, (s.type === 'menuFileInput' || s.type === 'hookedChooser') ? signal : undefined, guard, env);
        var shown = null;
        if (conf) {
          var ms = s.confirmMs || conf.timeoutMs || 15000;
          await waitUntil(win, doc, function () { return growth(doc, conf.selectors, before) > 0; }, { timeoutMs: ms, step: 'attach', timeoutCode: 'attach_not_confirmed', signal: signal });
          if (n > 1) shown = await waitForGrowth(win, doc, conf.selectors, before, n, Math.min(ms, 5000), signal);
        }
        trace.push(s.type + ':ok:' + (Date.now() - t0));
        return { strategy: s.type, index: i, count: n, shown: shown, trace: trace };
      } catch (e) {
        if (e && (e.code === 'aborted' || e.code === 'blocked_click')) throw e;
        lastCode = (e && e.code) || 'attach_failed';
        trace.push(s.type + ':' + lastCode + ':' + (Date.now() - t0));
      }
    }
    var err = StepError('attach', lastCode === 'selector_not_found' || lastCode === 'attach_not_confirmed' ? lastCode : 'attach_failed');
    err.trace = trace;
    throw err;
  }

  // ---------- send ----------
  async function clickSend(win, doc, step, promptEl, signal, guard) {
    var accept = step.requireEnabled === false ? null : isEnabled;
    try {
      var r = await waitFor(win, doc, step.selectors, { timeoutMs: step.timeoutMs || 15000, step: 'send', accept: function (el) { return (!accept || accept(el)) && !blockedByGuard(el, guard); }, signal: signal });
      r.el.click();
      return { index: r.index, via: 'click' };
    } catch (e) {
      if (e.code === 'aborted') throw e;
      if (step.fallbackKey && promptEl) {
        promptEl.focus && promptEl.focus();
        var init = { key: step.fallbackKey, code: step.fallbackKey, keyCode: 13, which: 13, bubbles: true, cancelable: true };
        promptEl.dispatchEvent(new win.KeyboardEvent('keydown', init));
        promptEl.dispatchEvent(new win.KeyboardEvent('keyup', init));
        return { index: -1, via: 'key' };
      }
      throw StepError('send', e.code === 'selector_not_found' ? 'send_not_found' : e.code);
    }
  }

  // ---------- reply reading ----------
  function urlInfo(win, href, allowedHosts) {
    if (!href) return null;
    href = String(href).trim();
    var lower = href.toLowerCase();
    if (/^(javascript|data|vbscript|blob):/.test(lower)) return null;
    var isSandbox = lower.indexOf('sandbox:') === 0;
    var abs = href;
    if (!isSandbox && !/^https?:/i.test(href)) {
      try { abs = new win.URL(href, win.location.href).href; } catch (e) { return null; }
    }
    var host = '';
    if (!isSandbox) { try { host = new win.URL(abs).hostname; } catch (e) { return null; } }
    var pageHost = win.location && win.location.hostname;
    var direct = !isSandbox && host !== pageHost && (allowedHosts || []).some(function (h) { return host === h || host.slice(-h.length - 1) === '.' + h; });
    return { url: abs, needsTab: !direct, host: host };
  }

  function nameFor(el, url) {
    var dl = el.getAttribute && el.getAttribute('download');
    if (dl) return dl;
    var t = norm(el.textContent || (el.getAttribute && el.getAttribute('alt')) || '');
    if (t && t.length <= 120) return t;
    var seg = String(url).split(/[?#]/)[0].split('/').pop();
    try { return decodeURIComponent(seg) || 'file'; } catch (e) { return seg || 'file'; }
  }

  function readFiles(win, container, filesStep, elementMap) {
    var out = [];
    if (!filesStep) return out;
    var n = 0;
    function add(kind, el, href) {
      var info = urlInfo(win, href, filesStep.allowedHosts);
      if (!info) return;
      var id = kind + ':' + (n++);
      elementMap && elementMap.set(id, el);
      out.push({ id: id, kind: kind, name: nameFor(el, info.url), url: info.url, needsTab: info.needsTab });
    }
    // Unlike steps with fallback lists, file entries collect from EVERY selector (union); an element is reported once,
    // under the first entry that matched it.
    var seen = new Set();
    function each(entry, kind, attr) {
      (entry.selectors || []).forEach(function (sel) {
        matchOne(container, sel).forEach(function (el) {
          if (seen.has(el)) return;
          seen.add(el);
          add(kind, el, el.getAttribute(attr));
        });
      });
    }
    (filesStep.links || []).forEach(function (entry) { each(entry, entry.kind || 'file', 'href'); });
    (filesStep.images || []).forEach(function (entry) { each(entry, 'image', 'src'); });
    return out;
  }

  // v0.1.4: the code blocks of the newest reply, in order, each with the text just before it (where the model writes
  // "File: /path"). Read once, when the reply is done. Code comes from the <code> element (no "Copy code" header).
  var BLOCK_LIM = { blocks: 12, code: 10 * 1024 * 1024, total: 30 * 1024 * 1024, label: 300 };
  function readBlocks(win, doc, instr, baseline) {
    var steps = instr.steps, out = [], total = 0;
    var msgs = resolveAll(doc, steps.assistantMessage.selectors).els;
    if (msgs.length <= baseline) return out;
    var target = (steps.assistantMessage.pick === 'first-new') ? msgs[baseline] : msgs[msgs.length - 1];
    var SHOW_TEXT = 4, between = '', inPre = null;
    var bcfg = steps.blocks || {};
    if (bcfg.markdownText) {
      var tr0 = steps.assistantMessage.textSelectors && steps.assistantMessage.textSelectors.length ? resolve(target, steps.assistantMessage.textSelectors) : { el: null };
      return replyMarkdown(win, doc, tr0.el || target, instr, true).blocks;
    }
    // v0.1.6: text inside these elements (code-block headers such as a language chip or copy button) is not part of
    // the "File: /path" label; langSelectors read the language from such a header when <code> has no language- class.
    var ignored = new Set();
    (bcfg.ignoreSelectors || []).forEach(function (sel) { matchOne(target, sel).forEach(function (e) { ignored.add(e); }); });
    function isIgnored(n) { var e = n.parentNode; while (e && e !== target) { if (ignored.has(e)) return true; e = e.parentNode; } return false; }
    function langNear(pre) {
      if (!bcfg.langSelectors) return '';
      var e = pre.parentNode;
      for (var k = 0; k < 5 && e && e !== target; k++, e = e.parentNode) {
        var r = resolve(e, bcfg.langSelectors);
        if (r.el && !r.el.contains(pre)) { var t = norm(r.el.textContent).toLowerCase(); return /^[a-z0-9+#._-]{1,20}$/.test(t) ? t : ''; }
      }
      return '';
    }
    var walker = doc.createTreeWalker(target, SHOW_TEXT, null);
    function preOf(n) { var e = n.parentNode; while (e && e !== target) { if (e.nodeName === 'PRE') return e; e = e.parentNode; } return null; }
    var node;
    while ((node = walker.nextNode())) {
      var pre = preOf(node);
      if (!pre && isIgnored(node)) continue;
      if (!pre) { inPre = null; between += node.data; if (between.length > 4000) between = between.slice(-4000); continue; }
      if (pre === inPre) continue;
      inPre = pre;
      if (out.length >= BLOCK_LIM.blocks) break;
      var code = pre.querySelector('code');
      var text = code ? code.textContent : textOf(pre).replace(/^[^\n]{0,24}\n(?:Copy(?: code)?\n)?/, '');
      var lm = /(?:^|\s)language-([A-Za-z0-9+#._-]{1,20})/.exec((code && code.getAttribute('class')) || '');
      if (text.length > BLOCK_LIM.code || total + text.length > BLOCK_LIM.total) { between = ''; continue; }
      total += text.length;
      out.push({ label: norm(between).slice(-BLOCK_LIM.label), lang: lm ? lm[1].toLowerCase() : langNear(pre), code: text });
      between = '';
    }
    return out;
  }


  // ---------- v0.1.10: reply text as markdown, code blocks as fences, raw HTML recovered ----------
  // textOf() flattens a reply: a code block becomes plain paragraphs (and a whole HTML page shows up as raw source lines).
  // With instructions steps.blocks.markdownText the reply is walked instead: <pre> becomes a ```lang fence (shown as a
  // collapsed code block in the chat window), headings, lists, bold, inline code and https links become markdown, and
  // header chrome (copy buttons, language chips, icons) is left out. When the model put HTML into ordinary paragraphs
  // instead of a code block (it happens on Gemini), that run of lines is fenced too, and a whole document in it
  // (<!doctype>/<html>...</html>) also becomes a block, so it can be staged like any other file.
  var MD_BLOCK = /^(P|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|NAV|UL|OL|LI|H[1-6]|TABLE|THEAD|TBODY|TR|BLOCKQUOTE|HR|FIGURE|DETAILS|SUMMARY|CODE-BLOCK|MESSAGE-CONTENT|RESPONSE-ELEMENT|TABLE-BLOCK)$/;
  var RAW_LINE = /^\s*<[A-Za-z!\/]/;
  function plainLabel(s) { return norm(String(s).replace(/\*\*|[`*]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).slice(-BLOCK_LIM.label); }
  function fenceSafe(code) { return String(code).replace(/```/g, '`\u200b``'); }
  function trimNl(s) { return String(s).replace(/^\n+/, '').replace(/\n+$/, ''); }
  function detectRawHtml(normalText, pushBlock) {
    // normalText: markdown-ish text WITHOUT fences. Returns text with raw HTML runs fenced; pushBlock(label, lang, code) for whole documents.
    var lines = String(normalText).split('\n'), out = [], i = 0, label = '';
    function isRaw(l) { return RAW_LINE.test(l); }
    while (i < lines.length) {
      if (!isRaw(lines[i])) { out.push(lines[i]); i++; continue; }
      var j = i, lastRaw = i, raws = 0;
      while (j < lines.length) {
        var l = lines[j];
        if (l.trim() === '') { j++; continue; }
        if (isRaw(l) || /<\/?[A-Za-z][^>]*>\s*$/.test(l)) { if (isRaw(l)) raws++; lastRaw = j; j++; continue; }
        break;
      }
      var run = lines.slice(i, lastRaw + 1).filter(function (l) { return l.trim() !== ''; }).join('\n');
      if (raws >= 3 && run.length >= 200) {
        var prior = plainLabel(out.join(' '));
        var whole = /(?:<!doctype html[^>]*>\s*)?<html[\s>][\s\S]*<\/html>/i.exec(run);
        if (whole && pushBlock) pushBlock(prior, 'html', whole[0].trim() + '\n');
        out.push('', '```html', fenceSafe(trimNl(run)), '```', '');
        i = lastRaw + 1;
      } else { out.push(lines[i]); i++; }
    }
    return out.join('\n');
  }
  function replyMarkdown(win, doc, root, instr, wantBlocks) {
    var bcfg = (instr.steps && instr.steps.blocks) || {};
    var ignored = new Set();
    (bcfg.ignoreSelectors || []).forEach(function (sel) { matchOne(root, sel).forEach(function (e) { ignored.add(e); }); });
    var segs = [], buf = '', blocks = [], total = 0, between = '';
    function flush() { if (buf) { segs.push({ t: buf }); between += buf; if (between.length > 4000) between = between.slice(-4000); buf = ''; } }
    function langNear(pre) {
      if (!bcfg.langSelectors) return '';
      var e = pre.parentNode;
      for (var k = 0; k < 5 && e && e !== root; k++, e = e.parentNode) {
        var r = resolve(e, bcfg.langSelectors);
        if (r.el && !r.el.contains(pre)) { var t = norm(r.el.textContent).toLowerCase(); return /^[a-z0-9+#._-]{1,20}$/.test(t) ? t : ''; }
      }
      return '';
    }
    function pre(p) {
      var code = p.querySelector('code');
      var text = code ? code.textContent : textOf(p).replace(/^[^\n]{0,24}\n(?:Copy(?: code)?\n)?/, '');
      var lm = /(?:^|\s)language-([A-Za-z0-9+#._-]{1,20})/.exec((code && code.getAttribute('class')) || '');
      var lang = lm ? lm[1].toLowerCase() : langNear(p);
      flush();
      if (wantBlocks && blocks.length < BLOCK_LIM.blocks && text.length <= BLOCK_LIM.code && total + text.length <= BLOCK_LIM.total) {
        total += text.length; blocks.push({ label: plainLabel(between), lang: lang, code: text });
      }
      between = '';
      segs.push({ fence: true, t: '```' + lang + '\n' + fenceSafe(trimNl(text)) + '\n```' });
    }
    function walk(n) {
      if (n.nodeType === 3) { buf += n.data.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1) return;
      if (ignored.has(n)) return;
      var tag = n.nodeName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'PRE') { pre(n); return; }
      if (tag === 'BR') { buf += '\n'; return; }
      var block = MD_BLOCK.test(tag), gap = tag === 'LI' ? '\n' : '\n\n';
      if (block) buf += (tag === 'LI' && /\n$/.test(buf)) ? '' : gap;
      var pfx = '', sfx = '';
      if (tag === 'LI') pfx = (n.parentNode && n.parentNode.nodeName === 'OL') ? (1 + Array.prototype.indexOf.call(n.parentNode.children, n)) + '. ' : '- ';
      else if (/^H[1-3]$/.test(tag)) pfx = '## ';
      else if (tag === 'STRONG' || tag === 'B') { pfx = '**'; sfx = '**'; }
      else if (tag === 'EM' || tag === 'I') { pfx = '*'; sfx = '*'; }
      else if (tag === 'CODE') { pfx = '`'; sfx = '`'; }
      buf += pfx;
      var href = tag === 'A' ? (n.getAttribute('href') || '') : '';
      var start = buf.length;
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (tag === 'A' && /^https:\/\//i.test(href) && buf.length > start) { var label = buf.slice(start).trim(); if (label && !/[\[\]\n]/.test(label)) buf = buf.slice(0, start) + '[' + label + '](' + href + ')'; }
      buf += sfx;
      if (block) buf += gap;
    }
    walk(root);
    flush();
    var parts = [];
    var pending = [];
    function addBlock(label, lang, code) { if (wantBlocks && blocks.length < BLOCK_LIM.blocks) blocks.push({ label: label, lang: lang, code: code }); }
    segs.forEach(function (s) {
      if (s.fence) { parts.push(s.t); return; }
      var t = s.t.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
      parts.push(detectRawHtml(t, addBlock));
    });
    var text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/^[ \t]*\n/, '').trim();
    return { text: text, blocks: blocks };
  }

  // v0.1.6: the first known notice (limit, sign-in, error banner) on the page, or null. Same entries as steps.errors.
  function readNotice(doc, instr) {
    var code = null;
    ((instr.steps && instr.steps.errors) || []).some(function (e) { if (resolve(doc, e.selectors).el) { code = e.code; return true; } return false; });
    return code;
  }

  function countMessages(doc, instr) {
    return resolveAll(doc, instr.steps.assistantMessage.selectors).els.length;
  }

  // One read of the page: stop button, newest assistant message text, files, known error banners.
  function readState(win, doc, instr, baseline, elementMap) {
    var steps = instr.steps;
    var msgs = resolveAll(doc, steps.assistantMessage.selectors).els;
    var newMessage = msgs.length > baseline;
    var target = null;
    if (newMessage) target = (steps.assistantMessage.pick === 'first-new') ? msgs[baseline] : msgs[msgs.length - 1];
    var text = '';
    var files = [];
    if (target) {
      var tsel = steps.assistantMessage.textSelectors;
      var tr = tsel && tsel.length ? resolve(target, tsel) : { el: null };
      if (steps.blocks && steps.blocks.markdownText) { try { text = replyMarkdown(win, doc, tr.el || target, instr, false).text; } catch (e) { text = textOf(tr.el || target).trim(); } }
      else text = textOf(tr.el || target).trim();
      if (elementMap) elementMap.clear();
      files = readFiles(win, target, steps.files, elementMap);
    }
    var present = {};
    ['stop'].forEach(function (s) { if (steps[s]) present[s] = !!resolve(doc, steps[s].selectors).el; });
    var error = null;
    (steps.errors || []).some(function (e) {
      if (resolve(doc, e.selectors).el) { error = e.code; return true; }
      return false;
    });
    var signature = text + '\u0001' + files.map(function (f) { return f.url; }).join('\u0002');
    return { newMessage: newMessage, text: text, files: files, present: present, error: error, signature: signature, nonEmpty: text.length > 0 || files.length > 0 };
  }


  // ChatGPT's free-tier file / data-analysis limit ("You're out of data analysis for now. Start a free Plus trial for more,
  // or try again tomorrow after 4:37 PM."). It is a notice, not a reply, so without this the job ends as no_reply.
  // Detection only reads text. Nothing on the page is ever clicked for it (no "Try Plus" / upgrade button).
  var LIMIT_RES = [
    /\b(?:you(?:'|\u2019)?re|you are|you have)\s+(?:currently\s+)?out of\s+(?:data analysis|file uploads?|uploads?|image generations?)\b/i,
    /\b(?:reached|hit|exceeded)\s+(?:your|the)\s+(?:free\s+)?(?:plan(?:'|\u2019)?s?\s+)?(?:limit|cap)s?\s+(?:for|on)\s+(?:data analysis|file uploads?|uploads?)\b/i,
    /\b(?:data analysis|file uploads?|uploads?)(?:\s+limit)?\s+(?:limit\s+)?(?:reached|exceeded)\b/i
  ];
  var LIMIT_SKIP = 'textarea, [contenteditable], script, style, noscript';                 // plain HTML; chat messages come from the instructions
  function limitMatch(t) { t = String(t || ''); for (var i = 0; i < LIMIT_RES.length; i++) if (LIMIT_RES[i].test(t)) return true; return false; }
  // Time and day from the notice text: "...try again tomorrow after 4:37 PM." -> {retryAfter: '4:37 PM', retryDay: 'tomorrow'}
  function limitWhen(t) {
    t = String(t || '').replace(/\s+/g, ' ');
    var m = /(?:\b(tomorrow|today)\s+)?\bafter\s+(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?|\d{1,2}:\d{2})/i.exec(t);
    if (!m) return { retryAfter: '', retryDay: '' };
    return { retryAfter: m[2].replace(/\./g, '').replace(/\s+/g, ' ').toUpperCase().replace(/^(\d{1,2}(?::\d{2})?)([AP]M)$/, '$1 $2'), retryDay: (m[1] || '').toLowerCase() };
  }
  // Looks for the notice outside the chat messages and the prompt box (replyText: the newest assistant text, only a
  // short reply that is itself the notice counts). Returns {code:'file_limit', retryAfter, retryDay} or null.
  function safeClosest(el, sel) { try { return !!(el.closest && el.closest(sel)); } catch (e) { return false; } }
  function detectLimit(win, doc, replyText, instr, sentText) {
    var ctx = null, skip = [LIMIT_SKIP];
    var st = instr && instr.steps;
    [st && st.assistantMessage, st && st.prompt].forEach(function (step) {
      ((step && step.selectors) || []).forEach(function (sel) { var c = normSel(sel).css; if (c) skip.push(c); });
    });
    skip = skip.join(', ');
    if (replyText && replyText.length < 500 && limitMatch(replyText)) ctx = replyText;
    if (ctx == null && doc.body) {
      var w = doc.createTreeWalker(doc.body, 4, null), n, seen = 0;
      while ((n = w.nextNode()) && seen++ < 20000) {
        var v = n.nodeValue; if (!v || v.length < 12 || v.length > 600 || !limitMatch(v)) continue;
        if (sentText && String(sentText).indexOf(v.trim()) >= 0) continue;            // my own message, whatever it says
        var par = n.parentElement; if (!par || safeClosest(par, skip)) continue;
        var blk = par, up = 0;                                                       // the notice's own block: the time may sit in a sibling node
        ctx = v;
        while (blk && up < 4 && blk !== doc.body) {
          var bt = blk.textContent || '';
          if (bt.length > 800) break;
          ctx = bt; if (limitWhen(bt).retryAfter) break;
          blk = blk.parentElement; up++;
        }
        break;
      }
    }
    if (ctx == null) return null;
    var when = limitWhen(ctx);
    return { code: 'file_limit', retryAfter: when.retryAfter, retryDay: when.retryDay };
  }

  return {
    StepError: StepError, normSel: normSel, matchOne: matchOne, resolve: resolve, resolveAll: resolveAll, waitFor: waitFor, queryAllDeep: queryAllDeep, shadowOf: shadowOf,
    isEnabled: isEnabled, setText: setText, fileFromDataUrl: fileFromDataUrl, attachFile: attachFile, replyMarkdown: replyMarkdown, inlineFilesText: inlineFilesText, growth: growth, clickSend: clickSend,
    readNotice: readNotice, waitUntil: waitUntil, safeClick: safeClick, blockedByGuard: blockedByGuard,
    readState: readState, detectLimit: detectLimit, limitMatch: limitMatch, limitWhen: limitWhen, readFiles: readFiles, readBlocks: readBlocks, BLOCK_LIM: BLOCK_LIM, countMessages: countMessages, urlInfo: urlInfo, textOf: textOf
  };
});
