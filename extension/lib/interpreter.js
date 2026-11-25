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
  async function waitForCount(win, doc, selectors, n, timeoutMs, signal) {
    var t0 = Date.now(), best = 0;
    for (;;) {
      if (signal && signal.aborted) throw StepError('attach', 'aborted');
      best = 0;
      (selectors || []).forEach(function (sel) { var c = matchOne(doc, sel).length; if (c > best) best = c; });
      if (best >= n || Date.now() - t0 >= timeoutMs) return best;
      await new Promise(function (r) { win.setTimeout(r, 150); });
    }
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
        var n = Array.isArray(file) ? file.length : 1, shown = null;
        if (step.confirm && step.confirm.selectors && step.confirm.selectors.length) {
          await waitFor(win, doc, step.confirm.selectors, { timeoutMs: step.confirm.timeoutMs || 15000, step: 'attach', timeoutCode: 'attach_not_confirmed', signal: signal });
          if (n > 1) shown = await waitForCount(win, doc, step.confirm.selectors, n, step.confirm.timeoutMs || 15000, signal);
        }
        return { strategy: s.type, index: i, count: n, shown: shown };
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

  // v0.1.4: the code blocks of the newest reply, in order, each with the text just before it (where the model writes
  // "File: /path"). Read once, when the reply is done. Code comes from the <code> element (no "Copy code" header).
  var BLOCK_LIM = { blocks: 12, code: 2 * 1024 * 1024, total: 6 * 1024 * 1024, label: 300 };
  function readBlocks(win, doc, instr, baseline) {
    var steps = instr.steps, out = [], total = 0;
    var msgs = resolveAll(doc, steps.assistantMessage.selectors).els;
    if (msgs.length <= baseline) return out;
    var target = (steps.assistantMessage.pick === 'first-new') ? msgs[baseline] : msgs[msgs.length - 1];
    var SHOW_TEXT = 4, between = '', inPre = null;
    var walker = doc.createTreeWalker(target, SHOW_TEXT, null);
    function preOf(n) { var e = n.parentNode; while (e && e !== target) { if (e.nodeName === 'PRE') return e; e = e.parentNode; } return null; }
    var node;
    while ((node = walker.nextNode())) {
      var pre = preOf(node);
      if (!pre) { inPre = null; between += node.data; if (between.length > 4000) between = between.slice(-4000); continue; }
      if (pre === inPre) continue;
      inPre = pre;
      if (out.length >= BLOCK_LIM.blocks) break;
      var code = pre.querySelector('code');
      var text = code ? code.textContent : textOf(pre).replace(/^[^\n]{0,24}\n(?:Copy(?: code)?\n)?/, '');
      var lm = /(?:^|\s)language-([A-Za-z0-9+#._-]{1,20})/.exec((code && code.getAttribute('class')) || '');
      if (text.length > BLOCK_LIM.code || total + text.length > BLOCK_LIM.total) { between = ''; continue; }
      total += text.length;
      out.push({ label: norm(between).slice(-BLOCK_LIM.label), lang: lm ? lm[1].toLowerCase() : '', code: text });
      between = '';
    }
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
    StepError: StepError, normSel: normSel, matchOne: matchOne, resolve: resolve, resolveAll: resolveAll, waitFor: waitFor,
    isEnabled: isEnabled, setText: setText, fileFromDataUrl: fileFromDataUrl, attachFile: attachFile, clickSend: clickSend,
    readState: readState, detectLimit: detectLimit, limitMatch: limitMatch, limitWhen: limitWhen, readFiles: readFiles, readBlocks: readBlocks, BLOCK_LIM: BLOCK_LIM, countMessages: countMessages, urlInfo: urlInfo, textOf: textOf
  };
});
