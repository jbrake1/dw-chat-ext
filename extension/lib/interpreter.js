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

  function matchOne(rootNode, sel) {
    sel = normSel(sel);
    var list;
    try { list = Array.prototype.slice.call(rootNode.querySelectorAll(sel.css)); } catch (e) { return []; }
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

  function makeDataTransfer(win, file) {
    if (!win.DataTransfer) throw new Error('no DataTransfer');
    var dt = new win.DataTransfer();
    dt.items.add(file);
    return dt;
  }

  var ATTACH_STRATEGIES = {
    fileInput: function (win, doc, strat, promptEl, file) {
      var r = resolve(doc, strat.selectors);
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
    drop: function (win, doc, strat, promptEl, file) {
      var target = strat.selectors ? (resolve(doc, strat.selectors).el || promptEl) : promptEl;
      var dt = makeDataTransfer(win, file);
      ['dragenter', 'dragover', 'drop'].forEach(function (t) {
        target.dispatchEvent(new win.DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }
  };

  async function attachFile(win, doc, step, promptEl, file, signal) {
    var strategies = step.strategies || [];
    var lastCode = 'attach_failed';
    for (var i = 0; i < strategies.length; i++) {
      var s = strategies[i];
      var fn = ATTACH_STRATEGIES[s.type];
      if (!fn) continue;
      try {
        if (s.type === 'fileInput' && s.waitMs) {
          try { await waitFor(win, doc, s.selectors, { timeoutMs: s.waitMs, step: 'attach', signal: signal }); } catch (e) { if (e.code === 'aborted') throw e; }
        }
        fn(win, doc, s, promptEl, file);
        if (step.confirm && step.confirm.selectors && step.confirm.selectors.length) {
          await waitFor(win, doc, step.confirm.selectors, { timeoutMs: step.confirm.timeoutMs || 15000, step: 'attach', timeoutCode: 'attach_not_confirmed', signal: signal });
        }
        return { strategy: s.type, index: i };
      } catch (e) {
        if (e && e.code === 'aborted') throw e;
        lastCode = (e && e.code) || 'attach_failed';
      }
    }
    throw StepError('attach', lastCode === 'selector_not_found' || lastCode === 'attach_not_confirmed' ? lastCode : 'attach_failed');
  }

  // ---------- send ----------
  async function clickSend(win, doc, step, promptEl, signal) {
    var accept = step.requireEnabled === false ? null : isEnabled;
    try {
      var r = await waitFor(win, doc, step.selectors, { timeoutMs: step.timeoutMs || 15000, step: 'send', accept: accept, signal: signal });
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
      text = textOf(tr.el || target).trim();
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

  return {
    StepError: StepError, normSel: normSel, matchOne: matchOne, resolve: resolve, resolveAll: resolveAll, waitFor: waitFor,
    isEnabled: isEnabled, setText: setText, fileFromDataUrl: fileFromDataUrl, attachFile: attachFile, clickSend: clickSend,
    readState: readState, readFiles: readFiles, countMessages: countMessages, urlInfo: urlInfo, textOf: textOf
  };
});
