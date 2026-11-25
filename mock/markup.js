/* DW Alliance "Suggest an edit" markup button (2026-10-28; page files for dw-chat-ext v0.1.3 2026-11-23, staging).
 * Loaded by the small inline loader that 404.php adds to pages of brands in markup.json, only for visitors
 * with the dw_mk hint cookie or a #suggest-edit link. Shows a button only when /markup/?a=status says this
 * visitor has a signed-in session with rights on this brand. Everyone else sees nothing.
 * Screenshot capture uses html2canvas 1.4.1 (MIT), served locally from /markup/vendor/. */
(function () {
  'use strict';
  if (window.__dwMarkup) return;
  window.__dwMarkup = true;
  var me = document.currentScript;
  var brand = (me && me.getAttribute('data-brand')) || '';
  var BASE = '/markup/';
  var csrf = '';
  var host, root, ui = {};

  // ----- DW Chat Integration extension hook (2026-11-22; dw-chat-ext SERVER_CONTRACT.md item 4) -----
  // Speaks dw-ext-hello / dw-ext-submit / dw-ext-control with the browser extension (only when it is installed and
  // active for this signed-in editor), and stages the AI reply's updated files as a 10-minute /files preview (staging:true),
  // with Publish / Discard controls, all under the person's own session via /markup/?a=files.
  // Nothing here runs a network request unless the extension says it is active or the editor clicks Publish / Discard.
  // Discard only drops staged bytes (and a staged-only new file); live files and history are never deleted.
  var XT = { acked: false, active: false, paired: false, job: null, host: null, root: null, box: null, app: false, sent: null, gotStatus: false, missing: false, timer: null, cdTimer: null, last: null };
  var XT_INSTALL = 'https://dwalliance.com/editor-ai/index.html#install';
  var XT_AI = { chatgpt: 'ChatGPT', gemini: 'Gemini' };
  // v0.1.6: which AI gets the request (ChatGPT or Gemini). Remembered here and by the extension (it reports it in its status).
  var XT_AI_KEY = 'dw_ext_ai';
  function xtAiPref() {
    if (ui.aiSel && XT_AI[ui.aiSel.value]) return ui.aiSel.value;                 // what's on the picker (may differ from a stale localStorage pref)
    try { var v = localStorage.getItem(XT_AI_KEY); if (XT_AI[v]) return v; } catch (e) {}
    if (XT.ai && XT_AI[XT.ai]) return XT.ai;
    return (XT.last && XT_AI[XT.last.provider] && XT.last.provider) || 'chatgpt';
  }
  function xtAiName(id) { return XT_AI[id || ''] || XT_AI[xtAiPref()] || 'the AI'; }
  function xtAiUse() { XT.ai = xtAiPref(); return XT.ai; }
  var XT_VER = /^[0-9A-Za-z._-]{1,32}$/;
  function xtPost(type, extra) { var m = { source: 'dw-edit', type: type, v: 1 }; for (var k in (extra || {})) m[k] = extra[k]; window.postMessage(m, location.origin); }
  function xtHello() { xtPost('dw-ext-hello', { panel: true, wantEvents: true }); }
  function xtAskStatus() { xtPost('dw-ext-status'); }
  function xtVer(v) { v = String(v || ''); return v ? (v.charAt(0) === 'v' ? v : 'v' + v) : ''; }
  function xtParseStatus(d) {
    if (!d || d.source !== 'dw-ext' || d.v !== 1) return null;
    var extVersion = typeof d.extVersion === 'string' && XT_VER.test(d.extVersion) ? d.extVersion : '';
    var editor = d.editor === true;
    var paired = editor && d.paired === true;
    var ai = (paired && typeof d.ai === 'string' && XT_AI[d.ai]) ? d.ai : null;
    var revision = (typeof d.revision === 'number' && isFinite(d.revision) && d.revision >= 0 && d.revision === Math.floor(d.revision)) ? d.revision : null;
    var provider = (editor && typeof d.provider === 'string' && XT_AI[d.provider]) ? d.provider : null;   // v0.1.6+ only
    return { extVersion: extVersion, paired: paired, ai: ai, revision: revision, editor: editor, provider: provider };
  }
  function xtLine(st) {
    if (!st) return { state: 'missing', text: 'AI/SI Editor extension not installed', href: XT_INSTALL, link: 'Install the extension', on: false };
    var ver = xtVer(st.extVersion);
    var inst = ver ? 'Installed ' + ver : 'Installed';
    if (!st.editor) {
      return { state: 'unconfirmed', text: inst + ', but this site is not enabled or has not confirmed you as an editor. Sign in as an editor, or click the DW Chat Integration icon and choose Enable on this site.', href: null, on: false };
    }
    if (st.paired && st.ai && (!st.provider || st.ai === st.provider)) {
      return { state: 'paired', text: 'Paired with ' + XT_AI[st.ai] + ' (' + (ver || 'extension') + ')', href: null, on: true };
    }
    if (st.provider) return { state: 'unpaired', text: inst + ', ' + XT_AI[st.provider] + ': an open ' + XT_AI[st.provider] + ' tab is used on Send, or one opens', href: null, on: true };
    return { state: 'unpaired', text: inst + ', not paired: open a ChatGPT or Gemini tab and click Pair this tab', href: null, on: false };
  }
  function xtPaintStatus() {
    if (!ui.note) return;
    var line = xtLine(XT.last);
    if (!ui.extStatus) {
      ui.extStatus = el('div', { class: 'ext-status', role: 'status', 'data-role': 'ext-status' });
      ui.extStatus.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' }));
      ui.extStatus.appendChild(el('span', { class: 'txt', 'data-role': 'ext-status-text' }));
      ui.note.appendChild(ui.extStatus);
    }
    if (ui.filesOpt) ui.filesOpt.style.display = (XT.last && XT.last.editor) ? '' : 'none';
    if (ui.aiOpt) {
      ui.aiOpt.style.display = (XT.last && XT.last.editor && XT.last.provider) ? '' : 'none';
      if (ui.aiSel && XT.last && XT.last.provider && ui.aiSel.value !== XT.last.provider) {
        ui.aiSel.value = XT.last.provider;
        try { localStorage.setItem(XT_AI_KEY, XT.last.provider); } catch (e) {}
      }
    }
    if (ui.attOpt) ui.attOpt.style.display = (XT.last && XT.last.editor) ? '' : 'none';
    ui.extStatus.setAttribute('data-state', line.state);
    ui.extStatus.classList.toggle('on', !!line.on);
    var txt = ui.extStatus.querySelector('[data-role=ext-status-text]');
    txt.textContent = '';
    txt.appendChild(document.createTextNode(line.text));
    var prev = txt.querySelector('a');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    // rebuild: textContent cleared children, then we only add a link if needed
    if (line.href) {
      txt.appendChild(document.createTextNode(' '));
      var a = el('a', { href: line.href, target: '_blank', rel: 'noopener noreferrer' }, line.link);
      txt.appendChild(a);
    }
  }
  function xtApplyStatus(st) {
    if (XT.timer) { clearTimeout(XT.timer); XT.timer = null; }
    XT.gotStatus = true;
    XT.missing = false;
    XT.last = st;
    if (st && st.editor) XT.active = true;
    if (st && !st.editor) XT.active = false;
    XT.paired = !!(st && st.paired);
    xtPaintStatus();
  }
  function xtStartDetect() {
    if (XT.timer) clearTimeout(XT.timer);
    XT.gotStatus = false;
    xtAskStatus();
    XT.timer = setTimeout(function () {
      XT.timer = null;
      if (!XT.gotStatus) { XT.last = null; XT.missing = true; xtPaintStatus(); }
    }, 1500);
  }
  // ----- relay log (v0.1.7) -----
  // A short ring of event names and codes in sessionStorage, so what happened before a reload, a closed editor or a
  // stall is still there afterwards. No notes, replies, screenshots, file names or page addresses.
  var XT_LOG_KEY = 'dw_ext_relaylog', XT_LOG_MAX = 80;
  function xtLogGet() { try { var a = JSON.parse(sessionStorage.getItem(XT_LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function xtLog(ev, data) {
    try {
      var arr = xtLogGet();
      var e = { t: Date.now(), ev: String(ev).slice(0, 30) };
      if (data && typeof data === 'object') Object.keys(data).slice(0, 6).forEach(function (k) { var v = data[k]; if (v === undefined) return; e[k] = (v === null || typeof v === 'number' || typeof v === 'boolean') ? v : String(v).slice(0, 60); });
      arr.push(e); if (arr.length > XT_LOG_MAX) arr = arr.slice(-XT_LOG_MAX);
      sessionStorage.setItem(XT_LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function xtLogEv(d) {
    var t = String(d.type || '').replace('dw-ext-', '');
    if (t === 'chunk') { if (XT.logChunk === d.jobId) return; XT.logChunk = d.jobId; }
    if (t === 'status') { var k = [d.editor, d.paired, d.provider].join('|'); if (XT.logStatus === k) return; XT.logStatus = k; xtLog('ext:status', { editor: d.editor, paired: d.paired, provider: d.provider, v: d.extVersion }); return; }
    if (t === 'diag-result') return;
    xtLog('ext:' + t, { step: d.step, ok: d.ok, code: d.code, status: d.status });
  }
  try { window.addEventListener('pagehide', function () { xtLog('pagehide'); }); } catch (e) {}
  // A request that started on an earlier load of this page in this tab and never ended (no done / error / stopped).
  function xtUnfinished() {
    var log = xtLogGet(), i, start = -1;
    for (i = log.length - 1; i >= 0; i--) if (log[i].ev === 'submit_start') { start = i; break; }
    if (start < 0 || log[start].shown) return null;
    var lastStep = '';
    for (i = start + 1; i < log.length; i++) {
      var ev = log[i].ev;
      if (ev === 'ext:done' || ev === 'ext:error' || ev === 'stopped' || ev === 'feed_error' || ev === 'no_relay' || ev === 'feed_closed') return null;
      if (ev === 'ext:step' && log[i].step) lastStep = log[i].step;
      else if (ev === 'ext:chunk') lastStep = 'reply started';
      else if (ev === 'submit_posted' && !lastStep) lastStep = 'handed to the extension';
      else if (ev === 'collect_done' && !lastStep) lastStep = 'files collected';
    }
    if (Date.now() - log[start].t > 30 * 60000) return null;
    return { idx: start, last: lastStep || 'collecting files' };
  }
  // v0.1.11: the editor feed and the last reply's code blocks, per page, in this tab (sessionStorage).
  // A refresh remounts the chat. Large screenshots are not stored (quota). The extension also keeps the last job
  // result and can re-read the AI tab if the reply finished after this page was gone.
  var XT_FEED_KEY = 'dw_ext_feed', XT_FEED_TTL = 30 * 60 * 1000;
  function xtFeedStoreKey() { return XT_FEED_KEY + ':' + xtPagePath(); }
  function xtSentLite(sent) {
    return (Array.isArray(sent) ? sent : []).map(function (f) {
      var row = { path: f.path, name: f.name, base: f.base || xtBase(f.path || f.name || ''), kind: f.kind, page: !!f.page };
      if (f.attach) row.attach = true;
      if (typeof f.text === 'string' && f.text.length <= 200000) row.text = f.text;
      return row;
    });
  }
  function xtFeedStepsSnap() {
    var steps = [];
    if (XT.feedSteps) {
      Array.prototype.forEach.call(XT.feedSteps.querySelectorAll('.step'), function (row) {
        steps.push({ name: row.getAttribute('data-step') || '', ok: row.getAttribute('data-ok') === '1', label: (row.textContent || '').replace(/^\u2713 /, '') });
      });
    }
    return steps;
  }
  function xtFeedRecordGet() {
    try {
      var v = JSON.parse(sessionStorage.getItem(xtFeedStoreKey()) || 'null');
      if (!v || v.v < 1 || v.path !== xtPagePath() || !v.t || Date.now() - v.t > XT_FEED_TTL) return null;
      return v;
    } catch (e) { return null; }
  }
  function xtFeedRecordSet(v) {
    if (!v) { try { sessionStorage.removeItem(xtFeedStoreKey()); } catch (e) {} return; }
    var o = {
      v: 1, path: xtPagePath(), t: Date.now(), ai: v.ai || XT.ai || '', jobId: v.jobId || XT.job || null,
      note: String(v.note || '').slice(0, 5000), steps: Array.isArray(v.steps) ? v.steps.slice(0, 40) : xtFeedStepsSnap(),
      state: v.state || '', text: String(v.text || ''), files: Array.isArray(v.files) ? v.files.slice(0, 20) : [],
      blocks: Array.isArray(v.blocks) ? v.blocks.slice(0, 12) : [], status: v.status || '',
      error: v.error ? { code: String(v.error.code || '').slice(0, 80), step: String(v.error.step || '').slice(0, 40) } : null,
      sent: xtSentLite(v.sent || XT.sent)
    };
    try { sessionStorage.setItem(xtFeedStoreKey(), JSON.stringify(o)); }
    catch (e) {
      try { o.sent = (o.sent || []).map(function (f) { return { path: f.path, name: f.name, base: f.base, kind: f.kind, page: !!f.page, attach: !!f.attach }; }); sessionStorage.setItem(xtFeedStoreKey(), JSON.stringify(o)); }
      catch (e2) { try { delete o.files; sessionStorage.setItem(xtFeedStoreKey(), JSON.stringify(o)); } catch (e3) {} }
    }
  }
  function xtFeedPersist(extra) {
    var rec = Object.assign({}, XT.feedRec || {}, extra || {});
    if (XT.feed) rec.state = XT.feed.getAttribute('data-state') || rec.state;
    if (XT.feedReply) rec.text = XT.feedReply.getAttribute('data-plain') || rec.text;
    rec.steps = xtFeedStepsSnap();
    rec.ai = XT.ai || rec.ai;
    rec.jobId = XT.job || rec.jobId;
    rec.sent = XT.sent || rec.sent;
    if (!rec.note && XT.feedScroll) {
      var n = XT.feedScroll.querySelector('[data-role=feed-note]');
      if (n) rec.note = n.textContent;
    }
    XT.feedRec = rec;
    xtFeedRecordSet(rec);
  }
  function xtFeedPersistDone(d) {
    xtFeedPersist({ text: d && d.text, files: d && d.files, blocks: d && d.blocks, status: (d && d.status) || 'complete', state: (d && d.status === 'stopped') ? 'stopped' : 'done' });
  }
  function xtAskReplay() {
    if (XT.askedReplay) return;
    XT.askedReplay = true;
    xtPost('dw-ext-replay', { pageUrl: location.href, path: xtPagePath() });
    setTimeout(function () { if (!XT.feed || !XT.feed.querySelector('[data-role=feed-user],[data-role=reply]')) xtRestoreRelayNote(); }, 2500);
  }
  function xtRestoreFeed(fromExt) {
    var v = fromExt && (fromExt.text || fromExt.note || (fromExt.blocks && fromExt.blocks.length) || fromExt.status) ? fromExt : xtFeedRecordGet();
    if (!v) return false;
    if (v.path && v.path !== xtPagePath()) return false;
    var haveDone = XT.feed && XT.feed.querySelector('[data-role=reply][data-done=complete]');
    var incoming = fromExt && fromExt.status === 'complete' && fromExt.text && String(fromExt.text).length;
    var haveLen = (XT.feedReply && XT.feedReply.getAttribute('data-plain') || '').length;
    if (haveDone && !(incoming && incoming > haveLen)) {
      if (fromExt && fromExt.status === 'complete' && !xtStagedGet() && (fromExt.blocks || fromExt.text)) {
        if (v.sent && v.sent.length) XT.sent = v.sent;
        xtDone({ status: 'complete', text: fromExt.text, files: fromExt.files, blocks: fromExt.blocks });
      }
      return true;
    }
    if (v.ai && XT_AI[v.ai]) XT.ai = v.ai;
    if (v.sent && v.sent.length) XT.sent = v.sent;
    if (v.jobId && (v.status === 'streaming' || v.status === 'sending' || v.state === 'streaming' || v.state === 'sending' || v.running)) XT.job = v.jobId;
    xtFeedUser(v.note || '(no note)', null);
    (v.steps || []).forEach(function (s) { if (s && (s.name || s.label)) xtFeedAddStep(s.name || 'step', !!s.ok, s.label || xtFeedLabel(s.name || '')); });
    var text = v.text || '', files = v.files || [], blocks = v.blocks || [], status = v.status || '';
    if (text || (blocks && blocks.length)) {
      if (status === 'complete' || status === 'stopped' || v.state === 'done' || v.state === 'stopped') xtFeedDone({ text: text, files: files, blocks: blocks, status: status || 'complete' });
      else xtFeedChunk(text, files);
    }
    if (v.error && v.error.code) xtFeedError(v.error.code, v.error.step, v.error);
    XT.feedRec = { note: v.note, text: text, files: files, blocks: blocks, status: status, state: v.state, ai: XT.ai, jobId: v.jobId, sent: XT.sent };
    xtFeedRecordSet(XT.feedRec);
    if ((status === 'complete' || v.state === 'done') && !xtStagedGet()) xtDone({ status: 'complete', text: text, files: files, blocks: blocks });
    xtLog('feed_restored', { state: v.state || status, hasText: !!text, from: fromExt ? 'ext' : 'store' });
    return true;
  }
  function xtRestoreRelayNote() {
    if (XT.feed && XT.feed.querySelector('[data-role=feed-user],[data-role=reply]')) return;
    var u = xtUnfinished();
    if (!u) return;
    try { var log = xtLogGet(); log[u.idx].shown = 1; sessionStorage.setItem(XT_LOG_KEY, JSON.stringify(log)); } catch (e) {}
    xtLog('restored', { last: u.last });
    xtCard('The last request did not finish before this page was reloaded or closed (last step: ' + u.last + '). Your edit request was saved. Press Suggest an edit to send another.', [{ act: 'diag', label: 'Copy diagnostics', fn: xtCopyDiag }], null, null, 'unfinished');
  }
  // Copy a snapshot: this page's log plus the extension's own (asked live over the page protocol).
  function xtCopyDiag(btn) {
    var done = false;
    function finish(ext) {
      if (done) return; done = true; XT.diagWait = null;
      var out = { page: { v: 'markup-0.1.7', t: Date.now(), active: XT.active, paired: XT.paired, missing: XT.missing, ai: XT.ai, log: xtLogGet().slice(-60) }, ext: ext || { note: 'extension did not answer' } };
      var text = JSON.stringify(out, null, 1);
      function fallback() {
        var host = XT.feedScroll || XT.box;
        if (!host) return;
        var ta = el('textarea', { rows: '6', readonly: 'readonly', style: 'width:100%;font:11px monospace;margin-top:6px' }); ta.value = text; host.appendChild(ta); ta.focus(); ta.select();
      }
      try { navigator.clipboard.writeText(text).then(function () { if (btn) btn.textContent = 'Copied'; }, fallback); } catch (e) { fallback(); }
    }
    XT.diagWait = finish;
    xtPost('dw-ext-diag', {});
    setTimeout(function () { finish(null); }, 1500);
  }
  function xtDiagButton() {
    if (!XT.feedFoot) return;
    if (XT.feedFoot.querySelector('[data-act=diag]')) return;
    var b = el('button', { type: 'button', 'data-act': 'diag' }, 'Copy diagnostics');
    b.addEventListener('click', function () { xtCopyDiag(b); });
    XT.feedFoot.style.display = ''; XT.feedFoot.appendChild(b);
  }
  function xtSnapDownload(r) {
    if (!r || r.via !== 'download' || !r.json) return;
    var a = el('a', { href: URL.createObjectURL(new Blob([r.json], { type: 'application/json' })), download: r.filename || ('dw-snap-' + r.id + '.json') });
    document.documentElement.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
  }
  function xtSnapButton() {
    var v = (XT.last && XT.last.extVersion) || '';
    var ok = false;
    try { var a = v.split('.').map(Number), b = [0,1,8]; for (var i = 0; i < 3; i++) { if ((a[i]||0)>(b[i]||0)) { ok = true; break; } if ((a[i]||0)<(b[i]||0)) break; if (i===2) ok = true; } } catch (e) {}
    if (!ok) return;                                                          // v0.1.7 and earlier have no snapshot handler; hide the button
    if (!XT.feedFoot) return;
    if (XT.feedFoot.querySelector('[data-act=snapshot]')) return;
    var b = el('button', { type: 'button', 'data-act': 'snapshot' }, 'Send page snapshot');
    var st = el('span', { 'data-role': 'snap-status', style: 'font-size:12px;align-self:center' }, '');
    b.addEventListener('click', function () {
      st.textContent = 'Capturing…';
      XT.snapWait = function (r) {
        XT.snapWait = null;
        if (!r || !r.ok) { st.textContent = 'Could not capture' + (r && r.code ? ' (' + r.code + ').' : '.'); return; }
        st.textContent = (r.via === 'upload' ? 'Sent. Snapshot id: ' : 'Downloaded. Snapshot id: ') + r.id;
        xtSnapDownload(r);
      };
      xtPost('dw-ext-snapshot', {});
      setTimeout(function () { if (XT.snapWait) XT.snapWait({ ok: false, code: 'no_answer' }); }, 20000);
    });
    XT.feedFoot.style.display = ''; XT.feedFoot.appendChild(b); XT.feedFoot.appendChild(st);
  }
  // Send pressed but the extension is not running on this page (it was installed or updated after the page loaded).
  function xtNoRelay(note, blob) {
    xtAiUse();
    xtLog('no_relay', { got: !!XT.gotStatus, missing: !!XT.missing, v: XT.last && XT.last.extVersion });
    xtFeedUser(note, blob);
    if (XT.feedSpin) XT.feedSpin.classList.add('off');
    if (XT.feedDot) XT.feedDot.className = 'dot err';
    if (XT.feed) { XT.feed.setAttribute('data-state', 'error'); XT.feedTitle.textContent = 'Not sent to ' + xtAiName(XT.ai); }
    if (XT.feedScroll) XT.feedScroll.appendChild(el('div', { class: 'err', 'data-role': 'error', 'data-code': 'ext_missing' }, 'Your edit request was saved, but the AI relay is not running on this page. If you just installed or updated the extension, reload this page, then press Send again.'));
    xtFeedScroll();
    xtDiagButton();
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.v !== 1) return;
    var d = e.data;
    if (d.source === 'dw-ext' && d.type === 'dw-ext-diag-result') { if (XT.diagWait) XT.diagWait(d.ext ? { ext: d.ext, extPage: d.page, extVersion: d.extVersion, active: d.active } : null); return; }
    if (d.source === 'dw-ext' && d.type === 'dw-ext-snapshot-result') { if (XT.snapWait) XT.snapWait(d); return; }
    if (d.source === 'dw-ext') xtLogEv(d);
    if (d.source === 'dw-edit' && d.type === 'dw-ext-submit') {
      if (!XT.feed || !XT.feed.querySelector('[data-role=feed-user]')) xtFeedUser(d.note, d.screenshot);
      return;
    }
    if (d.source !== 'dw-ext') return;
    if (d.type === 'dw-ext-ready') { XT.active = true; XT.paired = !!d.paired; if (!XT.acked) { XT.acked = true; xtHello(); } xtAskReplay(); }
    else if (d.type === 'dw-ext-status') { xtApplyStatus(xtParseStatus(d)); xtAskReplay(); }
    else if (d.type === 'dw-ext-restore') { xtRestoreFeed(d); }
    else if (d.type === 'dw-ext-inactive') { XT.active = false; XT.acked = false; xtApplyStatus({ extVersion: (XT.last && XT.last.extVersion) || '', paired: false, ai: null, revision: null, editor: false }); }
    else if (d.type === 'dw-ext-step') { if (XT.aborted) return; xtHeardRelay(); xtFeedStep(d.step, d.ok !== false, d); }
    else if (d.type === 'dw-ext-chunk') { if (XT.aborted) return; if (XT.job === null || XT.job === d.jobId) { XT.job = d.jobId; xtHeardRelay(); xtFeedChunk(d.text, d.files); } }
    else if (d.type === 'dw-ext-done') { XT.job = null; xtHeardRelay(); if (d && d.status === 'stopped') xtFeedStopped(); else { if (XT.aborted) return; xtFeedDone(d); xtFeedPersistDone(d); xtDone(d); } }
    else if (d.type === 'dw-ext-error') { XT.job = null; xtHeardRelay(); if (XT.aborted) return; xtFeedError(d.code, d.step, d); }
  });
  xtHello();
  xtAskStatus();

  // Called from submit() once /markup/ answered ok, inside the user's Send click.
  // v0.1.3: unless "Include page files" is unticked, it first downloads this page's source files (the HTML file as
  // stored, same-origin CSS and JS, and the images the note or the drawing points at) and sends them with the
  // screenshot, so the AI can return complete updated files.
  function xtSubmit(j, blob, sels, capture, viewport) {
    if (!blob) return;
    var note = ui.text ? ui.text.value : '';
    xtLog('submit_start', { active: !!XT.active, ai: XT.ai || xtAiPref() });
    if (!XT.active) { xtNoRelay(note, blob); return; }                          // v0.1.7: never fail silently
    XT.aborted = false;
    xtAiUse();                                                                   // set before the feed title is painted
    var withFiles = ui.filesChk ? !!ui.filesChk.checked : xtFilesOn();
    var imgs = withFiles ? xtImageCandidates(note) : [];
    xtFeedUser(note, blob);
    var nAtt = XT_ATT.length;                                                     // v0.1.5: files attached in the editor
    var attP = xtAttTake();
    var row = (withFiles || nAtt) ? xtFeedAddStep('collect', false, withFiles ? 'Collecting page files\u2026' : 'Reading your attached files\u2026') : null;
    var collected = attP.then(function (att) {
      return (withFiles ? xtCollectFiles(imgs, { files: att }) : Promise.resolve(null)).then(function (c) { return { att: att, c: c }; });
    });
    var shotP = new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = function () { res(''); }; fr.readAsDataURL(blob); });
    Promise.all([shotP, collected]).then(function (r) {
      if (XT.aborted) return;
      try {
        var att = r[1].att, c = r[1].c, all = att.concat(c ? c.files : []);
        var msg = { id: String(j.id), screenshot: r[0], note: note, pageUrl: location.href,
          element: { selectors: sels, capture: capture, viewport: viewport } };
        if (XT.ai && XT_AI[XT.ai]) msg.provider = XT.ai;                          // the picker (or pref); not a stale localStorage value
        xtRemember(all);
        XT.lastSend = { id: msg.id, screenshot: msg.screenshot, note: note, pageUrl: msg.pageUrl, element: msg.element, provider: XT.ai, hadFiles: all.length > 0 };
        if (c || att.length) {
          msg.files = all; msg.skipped = c ? c.skipped : [];
          if (row) { row.setAttribute('data-ok', '1'); row.setAttribute('data-count', String(all.length)); row.setAttribute('data-attached', String(att.length)); row.textContent = '\u2713 ' + (withFiles ? 'Collecting page files' : 'Your attached files') + ' (' + all.length + (att.length && withFiles ? ', ' + att.length + ' yours' : '') + ')'; }
        }
        xtLog('collect_done', { files: all.length });
        xtPost('dw-ext-submit', msg);
        xtLog('submit_posted', { ai: XT.ai });
        xtWaitForRelay();
      } catch (e) { xtFeedError('submit_failed', 'submit', {}); }
    }, function () { if (!XT.aborted) xtFeedError('collect_failed', 'collect', {}); });
  }

  // ----- page source files (v0.1.3) -----
  var XT_FILES_KEY = 'dw_ext_files';
  var XT_LIM = { files: 10, file: 10 * 1024 * 1024, total: 30 * 1024 * 1024, images: 4, ms: 10000 };
  var XT_MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain' };
  var XT_OURS = /^\/(?:markup\/|_dw\/|affiliates?\/keep-ref\.js$|files\/)/;
  function xtFilesOn() { try { return localStorage.getItem(XT_FILES_KEY) !== '0'; } catch (e) { return true; } }
  function xtExt(n) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  function xtUrl(u) { try { var x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x : null; } catch (e) { return null; } }
  function xtBase(pathname) { var n = pathname.split('/').pop() || 'index.html'; try { n = decodeURIComponent(n); } catch (e) {} return n.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '').slice(0, 100) || 'file'; }
  function xtPagePath() { var p = location.pathname || '/'; return p.slice(-1) === '/' ? p + 'index.html' : p; }
  // Undo what the server adds to a stored page when it serves it (editor loader, affiliate tag, free-site credit),
  // so the AI edits the file as stored in /files and its reply can be saved back unchanged otherwise.
  function xtStripInjected(html) {
    return String(html)
      .replace(/<script>\(function\(\)\{if\([^<]*?\/_dw\/edit\.js[^<]*?<\/script>\n?/g, '')
      .replace(/<script src="\/affiliate\/keep-ref\.js" defer><\/script>\n?/g, '')
      .replace(/\n?<!-- dw-credit:server v2 -->\n<style id="dw-credit-pad">[\s\S]*?<\/style><(dw-[a-z0-9]{2,16}) [\s\S]*?<\/\1>\n<script>[\s\S]*?<\/script>\n?/, '');
  }
  function xtToDataUrl(blob) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(blob); });
  }
  // Images worth sending: named in the note, under the drawing, or visible when Send was pressed. Same origin only.
  function xtImageCandidates(note) {
    var n = String(note || '').toLowerCase(), seen = {}, out = [];
    var boxes = shapes.map(bounds);
    var vy0 = window.scrollY, vy1 = window.scrollY + window.innerHeight;
    Array.prototype.forEach.call(document.images, function (img) {
      var u = xtUrl(img.currentSrc || img.src);
      if (!u) return;
      var key = u.origin + u.pathname;
      if (seen[key]) return; seen[key] = 1;
      var b = img.getBoundingClientRect();
      if (!b.width || !b.height) return;
      var x0 = b.left + window.scrollX, y0 = b.top + window.scrollY, x1 = x0 + b.width, y1 = y0 + b.height;
      var name = xtBase(u.pathname).toLowerCase(), score = 0;
      if (name.length > 3 && n.indexOf(name) >= 0) score = 3;
      else if (boxes.some(function (q) { return q.x0 < x1 && q.x1 > x0 && q.y0 < y1 && q.y1 > y0; })) score = 2;
      else if (y1 > vy0 && y0 < vy1) score = 1;
      if (score) out.push({ url: u, score: score, i: out.length });
    });
    out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    return out;
  }
  // ----- v0.1.5: files the user attaches in the editor (picker or drag and drop), each with an optional target path -----
  // An attached file counts against the same caps as the page files and uses the same type allowlist. Its target path is
  // where it should go on this site (blank = only shown to the AI, never saved). Nothing is uploaded to the site here:
  // the files go to the AI with the screenshot, and what comes back is staged by the same preview/publish flow as before.
  var XT_ATT = [], XT_ATT_SEQ = 0;
  var XT_BLOCKED = /^\/(?:markup|_dw|files|affiliates?|link_tree|oauth|session|crm|relation|domain|dns|account_setup|lib|infra|\.well-known)(?:\/|$)/i;
  function xtAttName(raw) { return String(raw || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '').slice(0, 100); }
  // A typed target path -> { path } ('' when blank) or { err }. The server checks again; this is for a clear message.
  function xtAttPath(raw, name) {
    var p = String(raw || '').trim();
    if (!p) return { path: '' };
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.slice(-1) === '/') p += name;
    if (p.length > 300 || !/^\/[A-Za-z0-9._~\/%-]+$/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p) || p.indexOf('//') >= 0) return { err: 'use letters, numbers, . _ - and / only, like /images/logo.png' };
    var base = p.split('/').pop();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(base)) return { err: 'the file name in the path must start with a letter or number' };
    if (XT_BLOCKED.test(p)) return { err: 'that folder is not part of the site files' };
    if (XT_MIME[xtExt(base)] !== XT_MIME[xtExt(name)]) return { err: 'the path must end in the same type as the file (.' + xtExt(name) + ')' };
    return { path: p };
  }
  function xtAttAddOne(f) {
    var name = xtAttName(f.name), ext = xtExt(name);
    if (!name || !XT_MIME[ext]) return 'is not a supported type (html, css, js, json, svg, png, jpg, gif, webp, pdf, txt)';
    if (!f.size) return 'is empty';
    if (f.size > XT_LIM.file) return 'is over ' + Math.round(XT_LIM.file / 1024 / 1024) + ' MB';
    if (XT_ATT.length >= XT_LIM.files) return 'is over the limit of ' + XT_LIM.files + ' files';
    var total = XT_ATT.reduce(function (n, a) { return n + a.size; }, 0);
    if (total + f.size > XT_LIM.total) return 'would pass the ' + Math.round(XT_LIM.total / 1024 / 1024) + ' MB total';
    var used = {}; XT_ATT.forEach(function (a) { used[a.name] = 1; });
    var nm = name, k = 2, dot = name.lastIndexOf('.');
    while (used[nm]) nm = name.slice(0, dot) + '-' + (k++) + name.slice(dot);
    XT_ATT.push({ id: ++XT_ATT_SEQ, file: f, name: nm, ext: ext, size: f.size, path: '', err: '' });
    return '';
  }
  function xtAttAdd(list) {
    var bad = [];
    Array.prototype.forEach.call(list || [], function (f) { var e = xtAttAddOne(f); if (e) bad.push(String(f.name || 'file').slice(0, 60) + ' ' + e); });
    xtAttRender(bad.length ? 'Not attached: ' + bad.join('; ') + '.' : '');
  }
  // First problem with the attached files, or '' (checked before Send).
  function xtAttCheck() {
    for (var i = 0; i < XT_ATT.length; i++) {
      var a = XT_ATT[i], r = xtAttPath(a.path, a.name); a.err = r.err || '';
      var dup = r.path && XT_ATT.some(function (b, j) { return j < i && xtAttPath(b.path, b.name).path === r.path; });
      if (!a.err && dup) a.err = 'two files have the same path';
      if (a.err) return a.name + ': ' + a.err;
    }
    return '';
  }
  function xtAttRender(msg) {
    var box = ui.attList; if (!box) return;
    box.textContent = '';
    XT_ATT.forEach(function (a) {
      var chip = el('div', { class: 'att-chip', 'data-role': 'att-chip', 'data-name': a.name });
      var top = el('div', { class: 'att-top' });
      top.appendChild(el('span', { class: 'att-name', title: a.name }, a.name));
      top.appendChild(el('span', { class: 'att-size' }, xtKB(a.size)));
      var rm = el('button', { type: 'button', class: 'att-x', 'data-role': 'att-remove', 'aria-label': 'Remove ' + a.name, title: 'Remove' }, '\u2715');
      rm.addEventListener('click', function () { XT_ATT = XT_ATT.filter(function (b) { return b.id !== a.id; }); xtAttRender(''); });
      top.appendChild(rm);
      chip.appendChild(top);
      var inp = el('input', { type: 'text', class: 'att-path', 'data-role': 'att-path', 'aria-label': 'Where should ' + a.name + ' go on the site?', placeholder: 'Put it at e.g. /images/' + a.name + ' (blank: only show it to the AI)', maxlength: '300', spellcheck: 'false', autocomplete: 'off' });
      inp.value = a.path;
      var er = el('div', { class: 'att-err', 'data-role': 'att-err' }, a.err || '');
      inp.addEventListener('input', function () { a.path = inp.value; var r = xtAttPath(a.path, a.name); a.err = r.err || ''; er.textContent = a.err; });
      chip.appendChild(inp); chip.appendChild(er);
      box.appendChild(chip);
    });
    if (ui.attMsg) ui.attMsg.textContent = msg || '';
    if (ui.attHint) ui.attHint.textContent = XT_ATT.length ? XT_ATT.length + ' attached. They go to the AI with your screenshot. A file with a path can be added to the site from the AI\u2019s reply, as a preview first.' : 'Add your own images, HTML, CSS, JS, JSON, SVG, PDF or text files (up to ' + XT_LIM.files + ' files, ' + Math.round(XT_LIM.file / 1024 / 1024) + ' MB each, ' + Math.round(XT_LIM.total / 1024 / 1024) + ' MB in all). Or drop them here.';
  }
  function xtHasFiles(e) { var t = e && e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
  function xtDragOver(e) { if (!xtHasFiles(e) || !ui.note) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; ui.note.classList.add('drag'); }
  function xtDragLeave(e) { if (ui.note && !e.relatedTarget) ui.note.classList.remove('drag'); }
  function xtDrop(e) {
    if (!xtHasFiles(e) || !ui.note) return;
    e.preventDefault(); e.stopPropagation(); ui.note.classList.remove('drag');
    if (!(XT.last && XT.last.editor)) { xtAttRender('Attaching files needs the DW Chat Integration extension, signed in as an editor.'); return; }
    xtAttAdd(e.dataTransfer.files);
  }
  // The attached files for dw-ext-submit (attached:true, path '' = shown to the AI only). Clears the list.
  function xtAttTake() {
    var list = XT_ATT.slice(); XT_ATT = [];
    return Promise.all(list.map(function (a) {
      var mime = XT_MIME[a.ext], path = xtAttPath(a.path, a.name).path || '';
      return xtToDataUrl(a.file).then(function (d) {
        var b64 = String(d).split(',')[1] || '';
        return { name: a.name, path: path, mime: mime, size: a.size, dataUrl: 'data:' + mime + ';base64,' + b64, attached: true };
      }, function () { return null; });
    })).then(function (r) { return r.filter(Boolean); });
  }
  function xtCollectFiles(imgs, pre) {
    pre = pre || { files: [] };                                     // attached files count first against the caps and keep their paths
    var files = [], skipped = [], total = pre.files.reduce(function (n, a) { return n + a.size; }, 0), seen = {}, names = { 'markup.jpg': 1 };
    pre.files.forEach(function (a) { names[a.name] = 1; if (a.path) seen[a.path] = 1; });
    var list = [{ url: xtUrl(location.href), path: xtPagePath(), html: true }];
    function add(u, kind) {
      if (!u) return;
      if (u.origin !== location.origin) { if (skipped.length < 20) skipped.push({ path: (u.host + u.pathname).slice(0, 290).replace(/^/, '/'), reason: 'third_party' }); return; }
      if (XT_OURS.test(u.pathname)) return;
      list.push({ url: u, path: u.pathname, kind: kind });
    }
    Array.prototype.forEach.call(document.querySelectorAll('link[rel~="stylesheet"][href]'), function (l) { add(xtUrl(l.href), 'css'); });
    Array.prototype.forEach.call(document.querySelectorAll('script[src]'), function (sc) { add(xtUrl(sc.src), 'js'); });
    imgs.forEach(function (c, i) {
      if (i >= XT_LIM.images) { if (c.url.origin === location.origin && skipped.length < 20) skipped.push({ path: c.url.pathname, reason: 'limit' }); return; }
      add(c.url, 'img');
    });
    function one(it) {
      if (seen[it.path]) return Promise.resolve(); seen[it.path] = 1;   // (a path the user attached is theirs: the page copy is not sent)
      var name = xtBase(it.path), ext = xtExt(name), mime = XT_MIME[ext];
      if (!mime) { skipped.push({ path: it.path, reason: 'type' }); return Promise.resolve(); }
      if (files.length + pre.files.length >= XT_LIM.files) { skipped.push({ path: it.path, reason: 'limit' }); return Promise.resolve(); }
      var u = new URL(it.url.href); u.hash = '';
      return fetch(u.href, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http');
        return it.html ? r.text().then(function (t) { return new Blob([xtStripInjected(t)], { type: mime }); }) : r.blob().then(function (b) { return new Blob([b], { type: mime }); });
      }).then(function (b) {
        if (b.size > XT_LIM.file) { skipped.push({ path: it.path, reason: 'too_large' }); return; }
        if (files.length + pre.files.length >= XT_LIM.files || total + b.size > XT_LIM.total) { skipped.push({ path: it.path, reason: 'limit' }); return; }
        var nm = name, k = 2, dot = name.lastIndexOf('.');
        while (names[nm]) nm = name.slice(0, dot) + '-' + (k++) + name.slice(dot);
        names[nm] = 1; total += b.size;
        var entry = { name: nm, path: it.path, mime: mime, size: b.size, dataUrl: null };
        files.push(entry);
        return xtToDataUrl(b).then(function (d) { entry.dataUrl = d; });
      }).catch(function () { skipped.push({ path: it.path, reason: 'fetch_failed' }); });
    }
    // One at a time, in priority order (page HTML, CSS, JS, images), so the caps keep the most useful files.
    var p = Promise.resolve();
    list.forEach(function (it) { p = p.then(function () { return one(it); }); });
    var timeout = new Promise(function (res) { setTimeout(res, XT_LIM.ms); });
    return Promise.race([p, timeout]).then(function () {
      var done = files.filter(function (f) { return f.dataUrl; });
      return { files: done, skipped: skipped.slice(0, 20) };
    });
  }


  // Persistent in-editor transcript (survives stop() after Send). Screenshot thumbs use a page-local object URL only.
  function xtFeedLabel(name) {
    var N = xtAiName(XT.ai);
    return ({ instructions: 'Getting ready', open_tab: 'Opening ' + N, newChat: 'New chat', prompt: 'Opening ' + N, text: 'Writing your note', attach: 'Screenshot sent', send: 'Screenshot sent', stream: N + ' is reading\u2026', stop: 'Stopped', retry_bundled: 'Trying the bundled instructions', attach_inline: N + ' did not take the upload, so the files went in the message as text (no screenshot)' })[name] || name;
  }
  var FEED_CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.feed{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(380px,calc(100vw - 24px));max-height:min(52vh,440px);background:#1b1d21;color:#e8eaed;border:1px solid #2d3138;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:13px;line-height:1.45;display:flex;flex-direction:column;overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:7px 8px;background:#14161a;border-bottom:1px solid #2d3138}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#6b7280;flex:none}.dot.on{background:#34d399}.dot.paused{background:#fbbf24}.dot.err{background:#f87171}',
    '.spin{width:10px;height:10px;border:2px solid #3f4550;border-top-color:#93c5fd;border-radius:50%;flex:none;animation:dwxspin .7s linear infinite}.spin.off{visibility:hidden}',
    '@keyframes dwxspin{to{transform:rotate(360deg)}}',
    '.title{font-weight:600;flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hd button{border:0;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;background:#2a2f36;color:#e8eaed}',
    '.hd button:hover:not(:disabled){background:#3a404a}.hd button:disabled{opacity:.4;cursor:default}',
    '.scroll{overflow:auto;flex:1;min-height:80px;padding:8px 9px;display:flex;flex-direction:column;gap:8px}',
    '.me{display:flex;gap:8px;align-items:flex-start;background:#252830;border:1px solid #333844;border-radius:8px;padding:7px 8px}',
    '.me .thumb{width:56px;height:56px;object-fit:cover;border-radius:6px;background:#111;flex:none;border:1px solid #3a3f48}',
    '.me .txt{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;color:#d5d9e0;font-size:12px}',
    '.steps{display:flex;flex-direction:column;gap:4px;color:#9aa3ad;font-size:11px}',
    '.steps .step{display:flex;align-items:center;gap:6px}',
    '.reply{background:#22252b;border:1px solid #333844;border-radius:8px;padding:8px 9px;word-break:break-word}',
    '.reply.live::after{content:" \\258B";color:#93c5fd}',
    '.reply p{margin:0 0 6px}.reply p:last-child{margin:0}',
    '.reply h1,.reply h2,.reply h3{margin:0 0 6px;font-size:13px}',
    '.reply pre{margin:6px 0;padding:8px;background:#111318;border-radius:6px;overflow:auto;font-size:12px}',
    '.reply details.code{margin:6px 0;border:1px solid #333844;border-radius:6px;background:#111318}.reply details.code>summary{cursor:pointer;padding:5px 8px;font-size:12px;color:#9aa3ad}.reply details.code>pre{margin:0;border-radius:0 0 6px 6px;max-height:320px}',
    '.reply code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
    '.reply a{color:#93c5fd}',
    '.files{display:flex;flex-direction:column;gap:3px;margin-top:4px}.files a{color:#93c5fd;font-size:12px}',
    '.err{color:#f87171;font-size:12px}',
    '.foot{display:flex;gap:6px;flex-wrap:wrap;padding:8px 9px;border-top:1px solid #2d3138}',
    '.foot button{border:0;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;background:#2a2f36;color:#e8eaed}',
    '.foot button.go{background:#2563eb;color:#fff;font-weight:600}',
    '.foot a{color:#93c5fd;font-size:12px;align-self:center}'
  ].join('\n');

  function xtMdInline(doc, parent, s) {
    var re = new RegExp('(`[^`]+`|\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|\\[([^\\]]+)\\]\\((https://[^\\s)]+)\\))', 'g');
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) parent.appendChild(doc.createTextNode(s.slice(last, m.index)));
      var tok = m[0];
      if (tok.charAt(0) === '`') parent.appendChild(el('code', null, tok.slice(1, -1)));
      else if (tok.slice(0, 2) === '**') parent.appendChild(el('strong', null, tok.slice(2, -2)));
      else if (tok.charAt(0) === '*') parent.appendChild(el('em', null, tok.slice(1, -1)));
      else parent.appendChild(el('a', { href: m[3], target: '_blank', rel: 'noopener noreferrer' }, m[2]));
      last = m.index + tok.length;
    }
    if (last < s.length) parent.appendChild(doc.createTextNode(s.slice(last)));
  }
  function xtMd(text, into) {
    var wasOpen = [];                                                           // a code block the reader opened stays open while the reply keeps streaming
    Array.prototype.forEach.call(into.querySelectorAll('details.code'), function (d, n) { if (d.open) wasOpen.push(n); });
    into.textContent = '';
    var codeN = 0;
    var src = String(text || '').replace(/\r\n/g, '\n');
    var chunks = src.split(/```/);
    for (var i = 0; i < chunks.length; i++) {
      if (i % 2 === 1) {
        var body = chunks[i], nl = body.indexOf('\n'), lang = '';
        if (nl >= 0) { lang = body.slice(0, nl).trim(); body = body.slice(nl + 1); }
        if (body.slice(-1) === '\n') body = body.slice(0, -1);
        var pre = el('pre'); var code = el('code', lang ? { 'data-lang': lang } : null, body); pre.appendChild(code);
        var nLines = body ? body.split('\n').length : 0;
        if (nLines > 2) {                                                        // v0.1.10: code is collapsed (one line says what it is); click to open
          var det = el('details', { class: 'code' });
          det.appendChild(el('summary', null, (lang ? lang.toUpperCase() + ' \u00b7 ' : 'Code \u00b7 ') + nLines + ' lines \u00b7 click to show'));
          det.appendChild(pre);
          if (wasOpen.indexOf(codeN) >= 0) det.open = true;
          into.appendChild(det);
        } else into.appendChild(pre);
        codeN++;
        continue;
      }
      var lines = chunks[i].split('\n'), para = [], list = null;
      function flushP() {
        if (!para.length) return;
        var p = el('p'); xtMdInline(document, p, para.join(' ')); into.appendChild(p); para = [];
      }
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var hm = /^(#{1,3})\s+(.+)$/.exec(line);
        var ul = /^[-*]\s+(.+)$/.exec(line);
        var ol = /^(\d+)\.\s+(.+)$/.exec(line);
        if (hm) { if (list) { into.appendChild(list); list = null; } flushP(); var h = el('h' + hm[1].length); xtMdInline(document, h, hm[2]); into.appendChild(h); }
        else if (ul || ol) {
          flushP();
          var tag = ul ? 'ul' : 'ol';
          if (!list || list.tagName.toLowerCase() !== tag) { if (list) into.appendChild(list); list = el(tag); }
          var item = el('li'); xtMdInline(document, item, (ul || ol)[ul ? 1 : 2]); list.appendChild(item);
        } else if (line.trim() === '') { if (list) { into.appendChild(list); list = null; } flushP(); }
        else { if (list) { into.appendChild(list); list = null; } para.push(line); }
      }
      if (list) into.appendChild(list);
      flushP();
    }
  }

  function xtFeedMount() {
    if (XT.feedHost) return XT.feed;
    XT.feedHost = el('div', { id: 'dw-ext-feed', 'data-html2canvas-ignore': 'true' });
    XT.feedRoot = XT.feedHost.attachShadow({ mode: 'open' });
    XT.feedRoot.appendChild(el('style', null, FEED_CSS));
    var wrap = el('div', { class: 'feed', role: 'region', 'aria-label': 'AI reply', 'data-role': 'dw-ext-feed' });
    var hd = el('div', { class: 'hd' });
    XT.feedDot = el('span', { class: 'dot on', 'aria-hidden': 'true' });
    XT.feedTitle = el('span', { class: 'title', 'data-role': 'feed-status' }, xtAiName(XT.ai));
    XT.feedSpin = el('span', { class: 'spin off', 'data-role': 'feed-spin', 'aria-hidden': 'true' });
    XT.feedPause = el('button', { type: 'button', 'data-act': 'pause' }, 'Pause');
    XT.feedStop = el('button', { type: 'button', 'data-act': 'stop' }, 'Stop');
    XT.feedClose = el('button', { type: 'button', 'data-act': 'close', 'aria-label': 'Close' }, '\u2715');
    XT.feedPaused = false;
    XT.feedPause.addEventListener('click', function () {
      var p = !XT.feedPaused;
      xtPost('dw-ext-control', { action: p ? 'pause' : 'resume' });
      XT.feedPaused = p;
      XT.feedPause.textContent = p ? 'Resume' : 'Pause';
      XT.feedDot.className = 'dot' + (p ? ' paused' : ' on');
    });
    XT.feedStop.addEventListener('click', function () { xtPost('dw-ext-control', { action: 'stop' }); xtFeedStopped(); });
    XT.feedClose.addEventListener('click', function () { xtFeedClose(); });
    [XT.feedDot, XT.feedTitle, XT.feedSpin, XT.feedPause, XT.feedStop, XT.feedClose].forEach(function (n) { hd.appendChild(n); });
    XT.feedScroll = el('div', { class: 'scroll', 'data-role': 'feed-scroll', role: 'log', 'aria-live': 'polite' });
    XT.feedFoot = el('div', { class: 'foot', 'data-role': 'feed-foot' });
    XT.feedFoot.style.display = 'none';
    wrap.appendChild(hd); wrap.appendChild(XT.feedScroll); wrap.appendChild(XT.feedFoot);
    XT.feedRoot.appendChild(wrap);
    XT.feed = wrap;
    document.documentElement.appendChild(XT.feedHost);
    XT.feedStick = true;
    XT.feedScroll.addEventListener('scroll', function () {
      XT.feedStick = XT.feedScroll.scrollTop + XT.feedScroll.clientHeight >= XT.feedScroll.scrollHeight - 16;
    });
    return XT.feed;
  }
  function xtFeedScroll() { if (XT.feedStick && XT.feedScroll) XT.feedScroll.scrollTop = XT.feedScroll.scrollHeight; }
  function xtFeedClose() {
    xtLog('feed_closed');
    if (XT.feedThumbUrl) { try { URL.revokeObjectURL(XT.feedThumbUrl); } catch (e) {} XT.feedThumbUrl = null; }
    if (XT.feedHost && XT.feedHost.parentNode) XT.feedHost.parentNode.removeChild(XT.feedHost);
    XT.feedHost = XT.feedRoot = XT.feed = XT.feedScroll = XT.feedFoot = XT.feedReply = XT.feedSteps = null;
  }
  function xtClearWait() { if (XT.waitTimer) { clearTimeout(XT.waitTimer); XT.waitTimer = null; } }
  function xtHeardRelay() { XT.heard = true; xtClearWait(); }
  // If the extension never answers after collect (no Getting ready / Opening ...), say so instead of hanging.
  function xtWaitForRelay() {
    XT.heard = false;
    xtClearWait();
    XT.waitTimer = setTimeout(function () {
      XT.waitTimer = null;
      if (XT.aborted || XT.heard || XT.job) return;
      xtFeedError('relay_timeout', 'submit', {});
    }, 25000);
  }
  function xtFeedStopped() {
    xtLog('stopped');
    xtClearWait();
    XT.aborted = true;
    XT.job = null;
    xtFeedMount();
    if (XT.feedSpin) XT.feedSpin.classList.add('off');
    if (XT.feedDot) XT.feedDot.className = 'dot';
    if (XT.feed) {
      XT.feed.setAttribute('data-state', 'stopped');
      XT.feed.setAttribute('data-done', 'stopped');
      XT.feedTitle.textContent = 'Stopped';
    }
    if (XT.feedScroll && !XT.feedScroll.querySelector('[data-role=feed-stopped]')) {
      XT.feedScroll.appendChild(el('div', { class: 'err', 'data-role': 'feed-stopped' }, 'Stopped. Nothing changed.'));
    }
    xtFeedScroll();
  }
  function xtFeedUser(note, blob) {
    xtFeedMount();
    XT.feed.setAttribute('data-state', 'sending');
    XT.feedTitle.textContent = 'Sending to ' + xtAiName(XT.ai) + '\u2026';
    XT.feedSpin.classList.remove('off');
    XT.feedFoot.style.display = 'none'; XT.feedFoot.textContent = '';
    XT.feedReply = null;
    if (XT.feedThumbUrl) { try { URL.revokeObjectURL(XT.feedThumbUrl); } catch (e) {} XT.feedThumbUrl = null; }
    XT.feedScroll.textContent = '';
    var row = el('div', { class: 'me', 'data-role': 'feed-user' });
    if (blob) {
      try {
        var src = (typeof blob === 'string' && blob.slice(0, 11) === 'data:image/') ? blob : (XT.feedThumbUrl = URL.createObjectURL(blob));
        if (src) row.appendChild(el('img', { class: 'thumb', 'data-role': 'feed-thumb', alt: 'Screenshot sent', src: src }));
      } catch (e) {}
    }
    row.appendChild(el('div', { class: 'txt', 'data-role': 'feed-note' }, note || '(no note)'));
    XT.feedRec = { note: note || '(no note)', ai: XT.ai, state: 'sending', sent: XT.sent };
    xtFeedRecordSet(XT.feedRec);
    XT.feedScroll.appendChild(row);
    XT.feedSteps = el('div', { class: 'steps', 'data-role': 'feed-steps' });
    XT.feedScroll.appendChild(XT.feedSteps);
    XT.feedStick = true;
    xtFeedScroll();
  }
  function xtFeedAddStep(name, ok, label) {
    xtFeedMount();
    if (!XT.feedSteps) { XT.feedSteps = el('div', { class: 'steps', 'data-role': 'feed-steps' }); XT.feedScroll.appendChild(XT.feedSteps); }
    var row = el('div', { class: 'step', 'data-step': name, 'data-ok': ok ? '1' : '0' }, (ok ? '\u2713 ' : '') + label);
    XT.feedSteps.appendChild(row);
    xtFeedScroll();
    return row;
  }
  function xtFeedStep(name, ok, d) {
    if (!ok && name === 'submit') return;
    if ((name === 'send' || name === 'attach') && ok) {
      var haveShot = XT.feedSteps && XT.feedSteps.querySelector('[data-step=send],[data-step=attach]');
      var nf = d && typeof d.files === 'number' && d.files > 0 ? Math.min(50, d.files | 0) : 0;
      var row = xtFeedAddStep(name, true, (name === 'send' && d && d.inline) ? 'Sent with the files as text (no screenshot)' : nf ? 'Uploaded screenshot + ' + nf + (nf === 1 ? ' file' : ' files') : 'Screenshot sent');
      if (nf && row) row.setAttribute('data-files', String(nf));
      if (haveShot && row) row.style.display = 'none';
      if (XT.feedSteps && !XT.feedSteps.querySelector('[data-role=reading]')) {
        var r = xtFeedAddStep('stream', false, xtAiName(XT.ai) + ' is reading\u2026');
        r.setAttribute('data-role', 'reading');
      }
      if (XT.feed) { XT.feed.setAttribute('data-state', 'streaming'); XT.feedTitle.textContent = xtAiName(XT.ai) + ' is reading\u2026'; XT.feedSpin.classList.remove('off'); }
      return;
    }
    if (name === 'stream') {
      if (XT.feed) { XT.feed.setAttribute('data-state', 'streaming'); XT.feedSpin.classList.remove('off'); }
      if (XT.feedSteps && !XT.feedSteps.querySelector('[data-role=reading],[data-step=stream]')) {
        var r2 = xtFeedAddStep('stream', false, xtAiName(XT.ai) + ' is reading\u2026');
        r2.setAttribute('data-role', 'reading');
      }
      return;
    }
    if (name === 'attach_inline' && d && d.files > 0) { var ni = Math.min(50, d.files | 0); xtFeedAddStep(name, true, xtAiName(XT.ai) + ' did not take the upload, so ' + ni + (ni === 1 ? ' file' : ' files') + ' went in the message as text (no screenshot)'); return; }
    xtFeedAddStep(name, ok, xtFeedLabel(name));
  }
  function xtFeedChunk(text, files) {
    xtFeedMount();
    if (XT.feed) { XT.feed.setAttribute('data-state', 'streaming'); XT.feedTitle.textContent = xtAiName(XT.ai) + ' is answering\u2026'; XT.feedSpin.classList.remove('off'); }
    var reading = XT.feedSteps && XT.feedSteps.querySelector('[data-role=reading]');
    if (reading) { reading.setAttribute('data-ok', '1'); reading.textContent = '\u2713 ' + xtAiName(XT.ai) + ' is reading\u2026'; }
    if (!XT.feedReply) {
      XT.feedReply = el('div', { class: 'reply live', 'data-role': 'reply' });
      XT.feedFiles = el('div', { class: 'files', 'data-role': 'files' });
      XT.feedScroll.appendChild(XT.feedReply);
      XT.feedScroll.appendChild(XT.feedFiles);
    }
    xtMd(text, XT.feedReply);
    // keep a plain-text copy for tests that read textContent of [data-role=reply]
    XT.feedReply.setAttribute('data-plain', String(text || ''));
    if (XT.feedPersistT) clearTimeout(XT.feedPersistT);
    XT.feedPersistT = setTimeout(function () { XT.feedPersistT = null; xtFeedPersist({ text: text, files: files, state: 'streaming', status: 'streaming' }); }, 250);
    XT.feedFiles.textContent = '';
    (files || []).forEach(function (f) {
      if (f && !f.needsTab && f.url && /^https:/i.test(f.url)) {
        XT.feedFiles.appendChild(el('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, f.name || 'file'));
      }
    });
    xtFeedScroll();
  }
  function xtFeedDone(d) {
    if (XT.feedReply) XT.feedReply.classList.remove('live');
    if (XT.feedSpin) XT.feedSpin.classList.add('off');
    if (d && d.text) xtFeedChunk(d.text, d.files);
    if (XT.feedReply) XT.feedReply.classList.remove('live');
    if (XT.feed) {
      XT.feed.setAttribute('data-state', (d && d.status === 'stopped') ? 'stopped' : 'done');
      XT.feed.setAttribute('data-done', (d && d.status) || 'complete');
      XT.feedTitle.textContent = (d && d.status === 'stopped') ? 'Stopped' : xtAiName(XT.ai) + ' reply';
    }
    if (XT.feedReply) XT.feedReply.setAttribute('data-done', (d && d.status) || 'complete');
    if (d && d.status === 'stopped' && XT.feedScroll) {
      XT.feedScroll.appendChild(el('div', { class: 'err', 'data-role': 'feed-stopped' }, 'Stopped. Nothing changed.'));
    }
    xtFeedScroll();
  }
  // v0.1.5: ChatGPT's free-tier file limit. Plain text only (the time is checked), and a retry that sends the note and
  // screenshot with no page files and no attached files. The user clicks it; nothing is sent automatically.
  function xtLimitWhen(d) {
    var time = d && typeof d.retryAfter === 'string' && /^\d{1,2}(?::\d{2})?(?: ?[AP]M)?$/.test(d.retryAfter) ? d.retryAfter : '';
    var day = d && (d.retryDay === 'tomorrow' || d.retryDay === 'today') ? d.retryDay : '';
    return time ? (day ? day + ' ' : '') + 'after ' + time : 'later';
  }
  function xtLimitText(d, hadFiles) {
    return xtAiName(XT.ai) + '\u2019s file limit was reached. Try again ' + xtLimitWhen(d) + (hadFiles ? ', or send without page files.' : '.');
  }
  function xtRetryTextOnly() {
    var l = XT.lastSend;
    if (!l || !XT.active || XT.job !== null) return;
    if (XT.box && XT.box.parentNode) XT.box.parentNode.removeChild(XT.box);
    XT.box = null;
    xtRemember([]);                                                              // only the page itself can be saved from this reply
    XT.aborted = false;
    if (l.provider && XT_AI[l.provider]) XT.ai = l.provider; else xtAiUse();
    xtFeedUser(l.note, l.screenshot);
    xtPost('dw-ext-submit', { id: l.id, screenshot: l.screenshot, note: l.note, pageUrl: l.pageUrl, element: l.element, provider: XT.ai });
    xtWaitForRelay();
  }
  function xtFeedError(code, step, d) {
    xtLog('feed_error', { code: code, step: step });
    xtFeedMount();
    if (XT.feedSpin) XT.feedSpin.classList.add('off');
    if (XT.feedDot) XT.feedDot.className = 'dot err';
    if (XT.feed) { XT.feed.setAttribute('data-state', 'error'); XT.feedTitle.textContent = 'Relay stopped'; }
    var N = xtAiName(XT.ai);
    var msg = { not_logged_in: N + ' tab is not signed in.', no_stream: N + ' did not start answering.', done_timeout: N + ' took too long.', rate_limited: N + ' says the rate limit was hit.', usage_limit: N + ' says its usage limit was reached. Try again later, or pick the other AI.', not_paired: 'No ' + N + ' tab is paired.', busy: N + ' is still answering the previous request.', tab_open_failed: 'Could not open a ' + N + ' tab.', blocked_click: 'Stopped for safety on the ' + N + ' page.', relay_timeout: 'The ' + N + ' relay did not start after the files were collected. Try Send again, or check that a signed-in ' + N + ' tab is open.', submit_failed: 'The request could not be sent to ' + N + '.', collect_failed: 'Could not finish collecting the page files.', chat_tab_unreachable: 'Could not reach the ' + N + ' tab.', no_instructions: 'No instructions were loaded for ' + N + '.', sw_unreachable: 'The extension was reloaded or updated. Reload this page to reconnect it.', ext_inactive: 'The extension is not active on this page. Reload the page and press Send again.', relay_off: 'The relay is switched off in the extension. Switch it on, then press Send again.', no_gesture: 'The extension needs a fresh click. Press Send again.' }[code] || ('The AI relay stopped (' + String(code || 'error') + ').');
    var lim = code === 'file_limit', hadFiles = !!(XT.lastSend && XT.lastSend.hadFiles);
    if (lim) msg = xtLimitText(d, hadFiles);
    if (XT.feedScroll) XT.feedScroll.appendChild(el('div', { class: 'err', 'data-role': 'error', 'data-code': code }, msg + ' Nothing else changed.'));
    xtDiagButton();
    xtSnapButton();
    if (lim && hadFiles) xtCard(msg, [{ act: 'retry-text', label: 'Send without page files', cls: 'go', fn: xtRetryTextOnly }], null, null, 'limit');
    xtFeedScroll();
  }
  var XT_CSS = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'
    + '.card{position:fixed;left:16px;bottom:16px;z-index:2147483646;width:min(360px,calc(100vw - 32px));background:#fff;color:#1d2a20;border-radius:12px;padding:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:13px;line-height:1.4}'
    + '.card p{margin:0 0 8px}.row{display:flex;gap:6px;flex-wrap:wrap}.card a{color:#1f4d2b;font-weight:600}'
    + 'button{border:0;border-radius:8px;padding:7px 11px;font-size:13px;cursor:pointer;background:#eef2ec;color:#1d2a20}'
    + 'button.go{background:#1f4d2b;color:#fff;font-weight:600}button[disabled]{opacity:.5;cursor:default}.x{margin-left:auto;background:transparent}'
    + '.cd{font-weight:600;color:#8a4b00}.files{margin:0 0 8px;padding:0 0 0 16px;max-height:140px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}';
  function xtCard(text, buttons, link, items, state) {
    if (!XT.host) {
      XT.host = el('div', { id: 'dw-ext-actions', 'data-html2canvas-ignore': 'true' });
      XT.root = XT.host.attachShadow({ mode: 'open' });
      XT.root.appendChild(el('style', null, XT_CSS));
      document.documentElement.appendChild(XT.host);
    }
    if (XT.box && XT.box.parentNode) XT.box.parentNode.removeChild(XT.box);
    XT.box = el('div', { class: 'card', role: 'status', 'data-role': 'dw-ext-actions' });
    if (state) XT.box.setAttribute('data-state', state);
    XT.box.appendChild(el('p', null, text));
    if (state === 'staged') XT.box.appendChild(el('p', { class: 'cd', 'data-role': 'dw-ext-countdown', 'aria-live': 'off' }, ''));
    if (items && items.length) {
      var ul = el('ul', { class: 'files', 'data-role': 'dw-ext-files' });
      items.forEach(function (it) {
        var li = el('li', { 'data-path': it.path || '' }, it.text);
        if (it.href) { li.appendChild(document.createTextNode(' ')); li.appendChild(el('a', { href: it.href, target: '_blank', rel: 'noopener', 'data-act': it.act || 'link', 'data-path': it.path || '' }, it.linkText || 'Open')); }
        ul.appendChild(li);
      });
      XT.box.appendChild(ul);
    }
    if (link) { var p = el('p'); var a = el('a', { href: link.href, target: '_blank', rel: 'noopener', 'data-act': link.act || 'link' }, link.text); p.appendChild(a); XT.box.appendChild(p); }
    var row = el('div', { class: 'row' });
    buttons.forEach(function (b) { var n = el('button', { type: 'button', class: b.cls || '', 'data-act': b.act }, b.label); n.addEventListener('click', function () { b.fn(n); }); row.appendChild(n); });
    var close = el('button', { type: 'button', class: 'x', 'data-act': 'close', 'aria-label': 'Close' }, '\u2715');
    close.addEventListener('click', function () { if (XT.box && XT.box.parentNode) XT.box.parentNode.removeChild(XT.box); XT.box = null; if (XT.cdTimer) { clearInterval(XT.cdTimer); XT.cdTimer = null; } });
    row.appendChild(close);
    XT.box.appendChild(row);
    XT.root.appendChild(XT.box);
  }

  // ----- v0.1.4: stage the AI's updated files in /files (staged preview -> publish or discard; /files keeps history) -----
  // Only files that were sent to the AI with this request can be saved, under their own path on this site.
  // Code blocks come from the extension (dw-ext-done blocks: [{label, lang, code}], "File: /path" just above each);
  // with an older extension, the page's own HTML is taken from the reply text as before.
  var XT_SAVE_TYPES = { html: 'html', htm: 'html', css: 'css', js: 'js', json: 'json', svg: 'svg', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', pdf: 'pdf', txt: 'txt' };
  var XT_LANG = { html: 'html', htm: 'html', xml: 'html', css: 'css', scss: 'css', js: 'js', javascript: 'js', jsx: 'js', json: 'json', svg: 'svg', text: 'txt', txt: 'txt', plaintext: 'txt' };
  function xtHtmlFrom(text) {
    var re = /(?:<!doctype html[^>]*>\s*)?<html[\s>][\s\S]*?<\/html>/gi, m, best = null;
    while ((m = re.exec(String(text || '')))) best = m[0];
    return best ? best.trim() + '\n' : null;
  }
  function xtKind(path) { return XT_SAVE_TYPES[xtExt(path)] || null; }
  function xtDecodeText(dataUrl) {
    try { var b = atob(String(dataUrl).split(',')[1] || ''); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new TextDecoder().decode(u); } catch (e) { return null; }
  }
  // Which sent file a code block belongs to: a path or file name in the text above it, else the only sent file of
  // its language, else (a whole HTML document) this page.
  function xtMatchBlock(b, sent) {
    var label = String(b.label || ''), best = null;
    var lang = XT_LANG[String(b.lang || '').toLowerCase()];
    if (!lang && /^\s*(?:<!doctype html|<html[\s>])/i.test(b.code)) lang = 'html';
    var fm = label.match(/(?:file|path)\s*[:\uFF1A]\s*[`'"*]*[^\s`'"*]+/gi);          // prefer the last "File: x" in the label
    if (fm) label = fm[fm.length - 1];
    var re = /(\/?[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+)*\.[A-Za-z0-9]{1,5})/g, m;
    while ((m = re.exec(label))) {
      var tok = m[1], hit = null;
      sent.forEach(function (f) { if (f.path === tok || f.path === '/' + tok.replace(/^\/+/, '')) hit = f; });
      if (!hit) sent.forEach(function (f) { if (!hit && (f.base === tok || f.name === tok)) hit = f; });
      if (hit && (!lang || hit.kind === lang)) best = hit;                       // a file named in passing of another type is skipped
    }
    if (best) return best;
    if (!lang) return null;
    var same = sent.filter(function (f) { return f.kind === lang; });
    if (same.length === 1) return same[0];
    if (lang === 'html') return sent.filter(function (f) { return f.page; })[0] || null;
    return null;
  }
  function xtUpdatesFrom(d, sent) {
    var byPath = {}, order = [];
    function put(f, content) {
      if (!f || content == null) return;
      if (f.kind === 'html' && !f.attach && !/<html[\s>]/i.test(content)) return;  // never a fragment: a staged file replaces the whole file
      if (f.kind === 'img' || f.kind === 'pdf') {
        var dm = /^\s*data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/.exec(content);
        if (!dm || dm[1] !== XT_MIME[xtExt(f.path)]) return;                    // binary files only as a data URL of the same type
        content = { b64: dm[2].replace(/\s+/g, '') };
      } else if (f.kind === 'html') {
        content = xtHtmlFrom(content) || content;
      }
      var size = typeof content === 'string' ? new Blob([content]).size : Math.floor(content.b64.length * 3 / 4);
      if (!size || size > XT_LIM.file) return;
      if (!f.attach && typeof content === 'string' && f.text != null && content.replace(/\s+$/, '') === f.text.replace(/\s+$/, '')) return;  // unchanged
      if (!byPath[f.path]) order.push(f.path);
      byPath[f.path] = { file: f, content: content, size: size };
    }
    var blocks = Array.isArray(d.blocks) ? d.blocks : [];
    blocks.forEach(function (b) { if (b && typeof b.code === 'string') put(xtMatchBlock(b, sent), b.code); });
    if (!blocks.length) {                                                       // older extension: the page HTML only
      var page = sent.filter(function (f) { return f.page; })[0];
      if (page) put(page, xtHtmlFrom(d.text));
    }
    return xtCap(order.map(function (p) { return byPath[p]; }));
  }
  function xtCap(list) {
    var total = 0;
    return list.filter(function (u) { total += u.size; return total <= XT_LIM.total; }).slice(0, XT_LIM.files);
  }
  // v0.1.5: does the AI's reply name this path as its own words (not just inside code)? The path must stand alone.
  function xtNamed(prose, path) {
    var i = -1; prose = String(prose || '');
    while ((i = prose.indexOf(path, i + 1)) >= 0) {
      var before = prose.charAt(i - 1), after = prose.charAt(i + path.length), next = prose.charAt(i + path.length + 1);
      var okB = !before || !/[A-Za-z0-9._~%\/-]/.test(before);
      var okA = !after || (!/[A-Za-z0-9_~%\/-]/.test(after) && !(after === '.' && /[A-Za-z0-9]/.test(next)));
      if (okB && okA) return true;
    }
    return false;
  }
  // The reply without its code blocks: where the AI says which of my files to use.
  function xtProse(d) {
    var t = String(d.text || '');
    (Array.isArray(d.blocks) ? d.blocks : []).forEach(function (b) {
      if (!b || typeof b.code !== 'string' || b.code.length < 8) return;
      t = t.split(b.code).join(' ');
      if (b.code.trim() !== b.code) t = t.split(b.code.trim()).join(' ');
    });
    return t.replace(/```[^\n]*\n[\s\S]*?\n?```/g, ' ');                      // v0.1.10: the reply text carries code as fences; prose is what is outside them
  }
  // Files the user attached (with a path) that the reply names but did not send back as code: staged from the original
  // bytes. Only a path the reply names, only under the path the user typed, only a type on the allowlist.
  function xtAsIs(d, sent, have) {
    var prose = xtProse(d), out = [];
    sent.forEach(function (f) {
      if (!f.attach || !f.dataUrl || have[f.path] || !xtNamed(prose, f.path)) return;
      var bin = f.kind === 'img' || f.kind === 'pdf';
      var content = bin ? { b64: String(f.dataUrl).split(',')[1] || '' } : f.text;
      if (content == null || (bin && !content.b64)) return;
      var size = bin ? Math.floor(content.b64.length * 3 / 4) : new Blob([content]).size;
      if (!size || size > XT_LIM.file) return;
      have[f.path] = 1; out.push({ file: f, content: content, size: size, asis: true });
    });
    return out;
  }
  // What was sent with this request: the page itself always, plus the collected page files.
  function xtRemember(files) {
    var page = xtPagePath();
    var sent = [{ path: page, name: xtBase(page), base: xtBase(page), kind: xtKind(page), page: true, text: null }];
    (files || []).forEach(function (f) {
      if (f.attached && !f.path) return;                                        // shown to the AI only: never saved to the site
      var k = xtKind(f.path); if (!k) return;
      var row = sent.filter(function (s) { return s.path === f.path; })[0];
      if (!row) { row = { path: f.path, name: f.name, base: xtBase(f.path), kind: k, page: false, text: null }; sent.push(row); }
      row.name = f.name;
      if (f.attached) { row.attach = true; row.dataUrl = f.dataUrl; }          // the user's own file: kept so it can be staged as uploaded
      if (k !== 'img' && k !== 'pdf' && f.dataUrl) row.text = xtDecodeText(f.dataUrl);
    });
    XT.sent = sent.filter(function (s) { return s.kind; });
    if (typeof xtFeedPersist === 'function') xtFeedPersist({ sent: XT.sent });
  }
  // The /files name and folder for a page path. On the app host pages live under /<brand>/, which is not part of the folder.
  function xtTargetOf(path) {
    var p = path; try { p = decodeURIComponent(path); } catch (e) {}
    p = p.replace(/^\/+/, '');
    if (XT.app && brand && p.indexOf(brand + '/') === 0) p = p.slice(brand.length + 1);
    var parts = p.split('/'); var name = parts.pop();
    return { file_name: name, file_path: parts.join('/') };
  }
  // Staged saves go to /markup/?a=files (same origin, X-DW-Markup, CSRF; the server hands them to /files under the
  // editor's own session). Only create with staging:true, publish_staging and discard_staging are accepted there.
  function xtCall(body) {
    return fetch(q('?a=files'), { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-DW-Markup': '1', 'X-DW-CSRF': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) { if (j && !j.ok) j.status = r.status; return j; }); })
      .then(function (j) { if (!j || !j.ok) { var e = new Error((j && (j.error_code || j.error)) || 'failed'); e.status = j && j.status; throw e; } return j; });
  }
  // Runs fn over items one at a time; resolves with [{item, ok, res|err}].
  function xtEach(items, fn) {
    var out = [], p = Promise.resolve();
    items.forEach(function (it) { p = p.then(function () { return fn(it).then(function (r) { out.push({ item: it, ok: true, res: r }); }, function (e) { out.push({ item: it, ok: false, err: String(e && e.message || e).slice(0, 160), status: e && e.status }); }); }); });
    return p.then(function () { return out; });
  }
  function xtKB(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; }
  function xtFail(err) { xtCard('That did not work: ' + (err && err.message ? err.message : err) + '. Nothing else changed.', []); }
  // What is staged in this tab (survives the reload that shows the preview): {exp: ms, items: [{id, path, isNew}]}.
  var XT_STAGED_KEY = 'dw_ext_staged';
  var XT_TTL = 10 * 60 * 1000;
  function xtStagedStoreKey() { return XT_STAGED_KEY + ':' + xtPagePath(); }
  function xtStagedGet() {
    try {
      var raw = sessionStorage.getItem(xtStagedStoreKey()) || sessionStorage.getItem(XT_STAGED_KEY);
      var v = JSON.parse(raw || 'null');
      return v && Array.isArray(v.items) && v.items.length && v.exp > Date.now() ? v : null;
    } catch (e) { return null; }
  }
  function xtStagedSet(v) {
    try {
      if (v && v.items.length) sessionStorage.setItem(xtStagedStoreKey(), JSON.stringify(v));
      else sessionStorage.removeItem(xtStagedStoreKey());
      sessionStorage.removeItem(XT_STAGED_KEY); // migrate off the pre-v0.1.11 tab-global key
    } catch (e) {}
  }
  function xtLeft(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function xtTick(stopAt) {
    if (XT.cdTimer) { clearInterval(XT.cdTimer); XT.cdTimer = null; }
    function paint() {
      var el2 = XT.root && XT.root.querySelector('[data-role=dw-ext-countdown]'); if (!el2) { clearInterval(XT.cdTimer); XT.cdTimer = null; return; }
      var left = stopAt - Date.now();
      if (left <= 0) { clearInterval(XT.cdTimer); XT.cdTimer = null; xtStagedSet(null); xtCard('The preview expired (previews last 10 minutes). Nothing was published; the live site is unchanged.', [{ act: 'reload', label: 'Reload page', fn: function () { location.reload(); } }]); return; }
      el2.textContent = 'Preview expires in ' + xtLeft(left) + ' unless you publish it.';
    }
    paint(); XT.cdTimer = setInterval(paint, 1000);
  }
  function xtDone(d) {
    if (d.status !== 'complete') { return; }
    var sent = XT.sent || [{ path: xtPagePath(), name: xtBase(xtPagePath()), base: xtBase(xtPagePath()), kind: 'html', page: true, text: null }];
    var ups = xtUpdatesFrom(d, sent), have = {};
    ups.forEach(function (u) { have[u.file.path] = 1; });
    ups = xtCap(ups.concat(xtAsIs(d, sent, have)));
    if (!ups.length) {
      var frag = (Array.isArray(d.blocks) ? d.blocks : []).some(function (b) { return b && typeof b.code === 'string' && (XT_LANG[String(b.lang || '').toLowerCase()] === 'html') && !/<html[\s>]/i.test(b.code); }) ||
        /```html\s*\n(?![\s\S]*?<html[\s>])/i.test(String(d.text || ''));
      if (frag) xtCard('The AI sent only part of a page (a fragment), and a fragment cannot replace the page, so nothing was uploaded and the live site is unchanged. Ask it for the complete file, starting with <!DOCTYPE html> and ending with </html>.', []);
      return;
    }
    var n = ups.length;
    xtCard('The AI sent ' + (n === 1 ? 'an updated file' : n + ' updated files') + '. Uploading ' + (n === 1 ? 'it' : 'them') + ' as a preview\u2026 Nothing goes live until you publish.', [], null,
      ups.map(function (u) { return { text: u.file.path + ' \u00b7 ' + xtKB(u.size) + (u.asis ? ' \u00b7 your file, as you attached it' : (u.file.attach ? ' \u00b7 your file, changed by the AI' : '')), path: u.file.path }; }), 'staging');
    xtEach(ups, function (u) {
      var t = xtTargetOf(u.file.path), body = { action: 'create', staging: true, file_name: t.file_name, file_path: t.file_path };
      if (typeof u.content === 'string') body.file_text = u.content; else body.file_data = u.content.b64;
      return xtCall(body);
    }).then(function (rs) {
      var ok = rs.filter(function (r) { return r.ok; }), bad = rs.filter(function (r) { return !r.ok; });
      var prev = xtStagedGet(), items = prev ? prev.items.slice() : [];
      ok.forEach(function (r) {
        var it = { id: String(r.res.id), path: r.item.file.path, isNew: r.res.staged_on_existing === false, mine: !!r.item.file.attach };
        items = items.filter(function (x) { return x.id !== it.id; }); items.push(it);
      });
      var st = ok.length ? { exp: Date.now() + XT_TTL - 5000, items: items } : prev;   // every new staged upload restarts its own 10 minutes
      xtStagedSet(st);
      xtStagedCard(st, bad.length ? 'Not uploaded: ' + bad.map(function (r) { return r.item.file.path + ' (' + r.err + ')'; }).join(', ') + '.' : '', false);
    }, xtFail);
  }
  // Publish / Discard controls for whatever is staged in this tab.
  function xtStagedCard(st, extra, reloaded) {
    if (!st || !st.items.length) { xtCard('Nothing was uploaded. ' + (extra || ''), []); return; }
    var n = st.items.length;
    var here = st.items.some(function (it) { return xtTargetOf(it.path).file_name === xtTargetOf(xtPagePath()).file_name && xtTargetOf(it.path).file_path === xtTargetOf(xtPagePath()).file_path; });
    var msg = (reloaded ? 'Preview on: while you are signed in, this site shows you ' + (n === 1 ? 'the staged file' : 'the ' + n + ' staged files') + '. Visitors still get the live site.'
      : (n === 1 ? '1 file is' : n + ' files are') + ' staged for preview. Visitors still see the live site.') + (extra ? ' ' + extra : '');
    var items = st.items.map(function (it) {
      return { text: it.path + (it.isNew ? ' (new)' : '') + (it.mine ? ' \u00b7 your file' : ''), path: it.path, href: location.origin + it.path, act: 'preview', linkText: 'Open preview' };
    });
    xtCard(msg, [
      { act: 'publish', label: n === 1 ? 'Publish' : 'Publish ' + n + ' files', cls: 'go', fn: function (b) {
        if (!window.confirm('Publish ' + (n === 1 ? 'this staged file' : 'these ' + n + ' staged files') + ' to the live site? The current versions are kept in /files history.')) return;
        b.disabled = true; b.textContent = 'Publishing\u2026';
        xtEach(st.items, function (it) { return xtCall({ action: 'publish_staging', id: it.id }); }).then(xtPublished, xtFail);
      } },
      { act: 'discard', label: 'Discard', fn: function (b) {
        b.disabled = true; b.textContent = 'Discarding\u2026';
        xtEach(st.items, function (it) { return xtCall({ action: 'discard_staging', id: it.id }); }).then(xtDiscarded, xtFail);
      } },
      { act: 'reload', label: reloaded ? 'Reload preview' : (here ? 'Show preview (reload)' : 'Reload page'), fn: function () { location.reload(); } }
    ], null, items, 'staged');
    xtTick(st.exp);
  }
  function xtPublished(rs) {
    var ok = rs.filter(function (r) { return r.ok; }), bad = rs.filter(function (r) { return !r.ok; });
    var st = xtStagedGet(); if (st) { st.items = st.items.filter(function (it) { return !ok.some(function (r) { return r.item.id === it.id; }) && !bad.some(function (r) { return r.item.id === it.id && r.status === 409; }); }); xtStagedSet(st); }
    var msg = 'Published ' + ok.length + ' of ' + rs.length + '. Visitors see the new version now; the previous version is kept in /files history.'
      + (bad.length ? ' Not published: ' + bad.map(function (r) { return r.item.path + ' (' + (r.status === 409 ? 'the preview expired' : r.err) + ')'; }).join(', ') + '.' : '');
    xtCard(msg, [{ act: 'reload', label: 'Reload page', fn: function () { location.reload(); } }], null, ok.map(function (r) { return { text: r.item.path, path: r.item.path }; }), 'published');
  }
  function xtDiscarded(rs) {
    var ok = rs.filter(function (r) { return r.ok; }), bad = rs.filter(function (r) { return !r.ok; });
    var st = xtStagedGet(); if (st) { st.items = st.items.filter(function (it) { return !ok.some(function (r) { return r.item.id === it.id; }); }); xtStagedSet(st); }
    xtCard('Discarded ' + ok.length + ' of ' + rs.length + '. The live site is unchanged.' + (bad.length ? ' Not discarded: ' + bad.map(function (r) { return r.item.path + ' (' + r.err + ')'; }).join(', ') + '.' : ''),
      [{ act: 'reload', label: 'Reload page', fn: function () { location.reload(); } }], null, null, 'discarded');
  }
  // After a reload: show the controls again while the preview is still staged.
  function xtRestoreStaged() { var st = xtStagedGet(); if (st) xtStagedCard(st, '', true); else xtStagedSet(null); }

  // dw_mk=1 only tells the page loader to fetch this script; it carries no secret. The session is the HttpOnly dw_markup cookie.
  function hint(on) {
    try {
      document.cookie = 'dw_mk=' + (on ? '1; Max-Age=2592000' : '; Max-Age=0') + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
  }

  function q(path) { return BASE + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'brand=' + encodeURIComponent(brand); }

  fetch(q('?a=status'), { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && j.ok && j.show && j.csrf) { hint(true); csrf = j.csrf; XT.app = j.app === true; mountButton(); xtRestoreStaged(); xtRestoreFeed(); xtAskReplay(); }
      else if (j && j.ok) { hint(false); }
      if (j && j.ok && !j.show && location.hash === '#suggest-edit') {
        location.href = q('?a=signin') + '&return=' + encodeURIComponent(location.pathname + location.search + '#suggest-edit');
      }
    })
    .catch(function () {});

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.fab{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;align-items:center;gap:8px;background:#1f4d2b;color:#fff;border:0;border-radius:999px;padding:11px 16px;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}',
    '.fab:hover{background:#2b6b3c}',
    '.dim{position:fixed;inset:0;z-index:2147483645;background:rgba(10,20,12,.22);pointer-events:none}',
    'canvas{position:fixed;left:0;top:0;z-index:2147483646;cursor:crosshair;touch-action:none}',
    'canvas.pan{cursor:grab}canvas.pan.dragging{cursor:grabbing}',
    '.hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:rgba(29,42,32,.88);color:#fff;font-size:12px;padding:6px 10px;border-radius:8px;pointer-events:none;max-width:calc(100vw - 380px);text-align:center}',
    '@media (max-width:760px){.hint{bottom:auto;top:calc(100% - 210px);max-width:calc(100vw - 24px)}}',
    '.bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:4px;align-items:center;background:#fff;color:#1d2a20;border-radius:12px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,.28);flex-wrap:wrap;max-width:calc(100vw - 20px)}',
    '.bar button{border:0;background:transparent;border-radius:8px;padding:7px 10px;font-size:13px;color:#1d2a20;cursor:pointer;display:flex;gap:5px;align-items:center}',
    '.bar button:hover{background:#eef2ec}.bar button.on{background:#1f4d2b;color:#fff}',
    '.bar .sep{width:1px;height:24px;background:#dde3db;margin:0 3px}',
    '.bar .send{background:#d4572a;color:#fff;font-weight:600}.bar .send:hover{background:#b8451c}',
    '.notebox{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(340px,calc(100vw - 32px));background:#fff;border-radius:12px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.28)}',
    '.notebox label{display:block;font-size:12px;font-weight:600;color:#4a5a4d;margin:0 0 5px}',
    '.notebox textarea{width:100%;height:92px;resize:vertical;border:1px solid #c8d1c6;border-radius:8px;padding:8px;font-size:14px;color:#1d2a20}',
    '.ext-status{display:flex;align-items:flex-start;gap:6px;margin:8px 0 0;font-size:11px;line-height:1.35;color:#4a5a4d}',
    '.ext-status .dot{width:8px;height:8px;border-radius:50%;background:#c5cdc4;flex:none;margin-top:3px}',
    '.ext-status.on .dot{background:#1f7a3a}',
    '.ext-status a{color:#1f4d2b;font-weight:600}',
    '.ext-status .txt{position:static;z-index:auto;font-size:11px;font-weight:400;color:inherit;border:0;background:none;padding:0;border-radius:0;min-width:0}',
    '.att{margin:8px 0 0;font-size:12px;color:#33433a}',
    '.att-btn{border:1px dashed #8aa38f;background:#f4f8f3;color:#1f4d2b;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;width:100%}.att-btn:hover{background:#e8f0e6}',
    '.notebox.drag{outline:3px dashed #1f4d2b;outline-offset:2px;background:#f2f8f1}',
    '.att-hint{margin:5px 0 0;font-size:11px;line-height:1.35;color:#4a5a4d}',
    '.att-msg{margin:4px 0 0;font-size:11px;color:#b3261e}.att-msg:empty{display:none}',
    '.att-list{display:flex;flex-direction:column;gap:6px;margin-top:6px;max-height:190px;overflow:auto}.att-list:empty{display:none}',
    '.att-chip{border:1px solid #c8d1c6;border-radius:8px;padding:5px 6px;background:#fafcf9}',
    '.att-top{display:flex;align-items:center;gap:6px}.att-name{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.att-size{color:#6b7a6e;font-size:11px}',
    '.att-x{border:0;background:#e8ece7;border-radius:50%;width:20px;height:20px;line-height:20px;padding:0;cursor:pointer;color:#33433a;font-size:11px}.att-x:hover{background:#d9dfd8}',
    '.att-path{width:100%;margin-top:4px;border:1px solid #c8d1c6;border-radius:6px;padding:4px 6px;font-size:12px;color:#1d2a20}',
    '.att-err{color:#b3261e;font-size:11px;margin-top:2px}.att-err:empty{display:none}',
    '.files-opt{display:flex;align-items:center;gap:6px;margin:7px 0 0;font-size:12px;color:#33433a;cursor:pointer}.files-opt input{margin:0}',
    '.txt{position:fixed;z-index:2147483647;font-size:16px;font-weight:700;color:#e0262b;border:2px dashed #e0262b;background:rgba(255,255,255,.9);padding:2px 5px;border-radius:4px;min-width:140px;outline:none}',
    '.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1d2a20;color:#fff;padding:11px 16px;border-radius:10px;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3)}',
    '.busy{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.45);font-size:15px;font-weight:600;color:#1d2a20}',
    '@media (max-width:600px){.bar{left:10px;right:10px;transform:none;justify-content:center;max-width:none}.bar .lbl{display:none}.bar button{min-width:38px;min-height:38px}.bar .send .lbl{display:inline}}',
  ].join('\n');

  // toolbar button: icon plus a label that narrow screens hide (aria-label keeps the name)
  function btn(attrs, icon, label) {
    attrs.type = 'button'; attrs['aria-label'] = label;
    var b = el('button', attrs, icon + ' ');
    b.appendChild(el('span', { class: 'lbl' }, label));
    return b;
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function mountButton() {
    host = el('div', { id: 'dw-markup-root', 'data-html2canvas-ignore': 'true' });
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', null, CSS));
    ui.fab = el('button', { class: 'fab', type: 'button', title: 'Mark up this page and send an edit request', part: 'fab' }, '\u270E Suggest an edit');
    ui.fab.addEventListener('click', start);
    root.appendChild(ui.fab);
    document.documentElement.appendChild(host);
    // #suggest-edit starts edit mode now and whenever the hash is set again later.
    window.addEventListener('hashchange', function () { if (location.hash === '#suggest-edit') start(); });
    if (location.hash === '#suggest-edit') start();
  }

  // ----- drawing state -----
  // Shapes are stored in document coordinates (pageX/pageY), so the page can scroll while marking up:
  // the canvas stays viewport-sized and is redrawn at the current scroll offset.
  var cv, ctx, dpr, tool = 'pen', shapes = [], cur = null, active = false, sending = false;
  var ptrs = {}, pan = null, raf = 0, nodes = [], offs = [];
  var TOOLS = [['pen', '\u270E', 'Pen'], ['arrow', '\u2197', 'Arrow'], ['box', '\u25A2', 'Box'], ['text', 'T', 'Text'], ['highlight', '\u25AE', 'Highlight'], ['pan', '\u270B', 'Scroll']];
  var RED = '#e0262b';

  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); offs.push(function () { target.removeEventListener(type, fn, opts); }); }
  function add(n) { root.appendChild(n); nodes.push(n); return n; }

  function start() {
    if (active || sending || !ui.fab) return;
    active = true;
    try {
      if (location.hash === '#suggest-edit' && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      shapes = []; cur = null; ptrs = {}; pan = null; nodes = []; offs = [];
      ui.fab.style.display = 'none';
      ui.dim = add(el('div', { class: 'dim' }));
      cv = add(el('canvas'));
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      ctx = cv.getContext('2d');
      sizeCanvas();
      ui.bar = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Markup tools' });
      ui.toolBtns = {};
      TOOLS.forEach(function (t) {
        var b = btn({ 'data-tool': t[0], title: t[0] === 'pan' ? 'Scroll the page (drag)' : t[2] }, t[1], t[2]);
        b.addEventListener('click', function () { setTool(t[0]); });
        ui.toolBtns[t[0]] = b; ui.bar.appendChild(b);
      });
      ui.bar.appendChild(el('span', { class: 'sep' }));
      var undo = btn({ 'data-act': 'undo', title: 'Undo' }, '\u21B6', 'Undo');
      undo.addEventListener('click', function () { shapes.pop(); redraw(); });
      var cancel = btn({ 'data-act': 'cancel', title: 'Cancel' }, '\u2715', 'Cancel');
      cancel.addEventListener('click', stop);
      var send = btn({ class: 'send', 'data-act': 'send', title: 'Send' }, '\u27A4', 'Send');
      send.addEventListener('click', submit);
      ui.bar.appendChild(undo); ui.bar.appendChild(cancel); ui.bar.appendChild(send);
      add(ui.bar);
      ui.note = el('div', { class: 'notebox' });
      ui.note.appendChild(el('label', { for: 'dw-mk-note' }, 'What should change?'));
      ui.text = el('textarea', { id: 'dw-mk-note', maxlength: '5000', placeholder: 'e.g. Change this headline to "Family owned since 1998"' });
      ui.note.appendChild(ui.text);
      ui.filesOpt = el('label', { class: 'files-opt', 'data-role': 'include-files-opt', title: 'Send this page\u2019s HTML, its CSS and JS files and the marked images to the AI with the screenshot' });
      ui.filesChk = el('input', { type: 'checkbox', id: 'dw-mk-files', 'data-role': 'include-files' });
      ui.filesChk.checked = xtFilesOn();
      ui.filesChk.addEventListener('change', function () { try { localStorage.setItem(XT_FILES_KEY, ui.filesChk.checked ? '1' : '0'); } catch (e) {} });
      ui.filesOpt.appendChild(ui.filesChk);
      ui.filesOpt.appendChild(el('span', null, 'Include page files (HTML, CSS, JS, images)'));
      ui.filesOpt.style.display = 'none';
      ui.note.appendChild(ui.filesOpt);
      ui.aiOpt = el('label', { class: 'files-opt', 'data-role': 'ai-opt', title: 'Which AI gets your request' });
      ui.aiOpt.appendChild(el('span', null, 'AI: '));
      ui.aiSel = el('select', { 'data-role': 'ai-provider', 'aria-label': 'AI' });
      Object.keys(XT_AI).forEach(function (k) { ui.aiSel.appendChild(el('option', { value: k }, XT_AI[k])); });
      ui.aiSel.value = xtAiPref();
      ui.aiSel.addEventListener('change', function () { try { localStorage.setItem(XT_AI_KEY, ui.aiSel.value); } catch (e) {} XT.ai = ui.aiSel.value; xtPost('dw-ext-provider', { provider: ui.aiSel.value }); });
      ui.aiOpt.appendChild(ui.aiSel);
      ui.aiOpt.style.display = 'none';
      ui.note.appendChild(ui.aiOpt);
      XT_ATT = [];
      ui.attOpt = el('div', { class: 'att', 'data-role': 'attach' });
      ui.attBtn = el('button', { type: 'button', class: 'att-btn', 'data-role': 'attach-btn', title: 'Add your own files for the AI to use: images, HTML, CSS, JS, JSON, SVG, PDF or text' }, '\uD83D\uDCCE Attach files');
      ui.attInput = el('input', { type: 'file', multiple: 'multiple', hidden: 'hidden', id: 'dw-mk-attach', 'data-role': 'attach-input', accept: '.html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt' });
      ui.attBtn.addEventListener('click', function () { ui.attInput.click(); });
      ui.attInput.addEventListener('change', function () { xtAttAdd(ui.attInput.files); ui.attInput.value = ''; });
      ui.attHint = el('div', { class: 'att-hint', 'data-role': 'attach-hint' });
      ui.attMsg = el('div', { class: 'att-msg', role: 'status', 'data-role': 'attach-msg' });
      ui.attList = el('div', { class: 'att-list', 'data-role': 'attach-list' });
      [ui.attBtn, ui.attInput, ui.attHint, ui.attMsg, ui.attList].forEach(function (n) { ui.attOpt.appendChild(n); });
      ui.attOpt.style.display = 'none';
      ui.note.appendChild(ui.attOpt);
      xtAttRender('');
      add(ui.note);
      ui.extStatus = null;
      if (XT.last || XT.missing) xtPaintStatus();
      xtStartDetect();
      ui.hint = add(el('div', { class: 'hint' }, ('ontouchstart' in window || navigator.maxTouchPoints > 0)
        ? 'Scroll with two fingers, or pick \u270B Scroll.' : 'Scroll with the mouse wheel or trackpad, or pick \u270B Scroll.'));
      setTimeout(function () { if (ui.hint && ui.hint.parentNode) ui.hint.parentNode.removeChild(ui.hint); }, 6000);
      setTool('pen');
      on(window, 'dragover', xtDragOver);
      on(window, 'dragleave', xtDragLeave);
      on(window, 'drop', xtDrop);
      on(cv, 'pointerdown', down);
      on(cv, 'pointermove', move);
      on(window, 'pointerup', up);
      on(window, 'pointercancel', up);
      on(window, 'resize', onResize);
      on(window, 'scroll', onScroll, { passive: true });
      on(window, 'keydown', onKey, true);
      // the canvas is touch-action:none, so stop the browser's own touch gestures there; two fingers scroll via down/move
      on(cv, 'touchmove', prevent, { passive: false });
      redraw();
    } catch (err) {
      stop();
      toast('Could not start markup: ' + (err && err.message ? err.message : err), 6000);
    }
  }

  function prevent(e) { e.preventDefault(); }
  function onKey(e) { if (e.key === 'Escape' && active && !ui.textInput && !sending) { e.stopPropagation(); stop(); } }
  function onResize() { sizeCanvas(); redraw(); }
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; placeText(); redraw(); });
  }

  function sizeCanvas() {
    var w = document.documentElement.clientWidth || window.innerWidth, h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  }

  // Leave edit mode completely: drop every node and listener we added and bring the button back.
  function stop() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    offs.forEach(function (f) { try { f(); } catch (e) {} });
    offs = [];
    if (ui.textInput) nodes.push(ui.textInput);
    nodes.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    nodes = [];
    ui.textInput = null; ui.dim = ui.bar = ui.note = ui.hint = ui.extStatus = ui.filesOpt = ui.filesChk = ui.aiOpt = ui.aiSel = null;
    ui.attOpt = ui.attBtn = ui.attInput = ui.attHint = ui.attMsg = ui.attList = null; XT_ATT = [];
    cv = ctx = null; cur = null; pan = null; ptrs = {}; shapes = [];
    if (ui.fab) ui.fab.style.display = '';
  }

  function setTool(t) {
    if (ui.textInput) commitText();
    tool = t;
    for (var k in ui.toolBtns) ui.toolBtns[k].classList.toggle('on', k === t);
    if (cv) cv.classList.toggle('pan', t === 'pan');
  }

  function pt(e) { return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY }; }
  function mid() {
    var ks = Object.keys(ptrs), x = 0, y = 0;
    ks.forEach(function (k) { x += ptrs[k].x; y += ptrs[k].y; });
    return { x: x / ks.length, y: y / ks.length };
  }

  function down(e) {
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    var n = Object.keys(ptrs).length;
    if (n >= 2 || tool === 'pan') {
      // two fingers (or the Scroll tool) pan the page; drop any half-drawn stroke
      cur = null; pan = mid(); cv.classList.add('dragging'); redraw();
      return;
    }
    if (ui.textInput) { commitText(); return; }
    var p = pt(e);
    if (tool === 'text') { e.preventDefault(); openText(p); return; }
    cur = { t: tool, pts: [p], a: p, b: p };
  }
  function move(e) {
    if (ptrs[e.pointerId]) ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pan) {
      var m = mid();
      // 'instant' so a site-wide scroll-behavior:smooth does not swallow the small steps
      window.scrollTo({ left: window.scrollX + pan.x - m.x, top: window.scrollY + pan.y - m.y, behavior: 'instant' });
      pan = m;
      return;
    }
    if (!cur) return;
    var p = pt(e);
    if (cur.t === 'pen') cur.pts.push(p); else cur.b = p;
    redraw();
  }
  function up(e) {
    if (e && e.pointerId != null) delete ptrs[e.pointerId];
    if (pan) {
      if (Object.keys(ptrs).length) { pan = mid(); return; }
      pan = null; if (cv) cv.classList.remove('dragging');
      return;
    }
    if (!cur) return;
    var c = cur; cur = null;
    var big = c.t === 'pen' ? c.pts.length > 2 : (Math.abs(c.a.x - c.b.x) + Math.abs(c.a.y - c.b.y) > 6);
    if (big) { c.sel = selectorFor(c); shapes.push(c); }
    redraw();
  }

  function placeText() {
    var inp = ui.textInput; if (!inp) return;
    inp.style.left = (inp._p.x - window.scrollX) + 'px'; inp.style.top = (inp._p.y - window.scrollY - 14) + 'px';
  }
  function openText(p) {
    var inp = el('div', { class: 'txt', contenteditable: 'true', role: 'textbox', 'aria-label': 'Text label' });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); }
      if (e.key === 'Escape') { e.preventDefault(); inp.textContent = ''; commitText(); }
    });
    inp._p = p;
    root.appendChild(inp);
    ui.textInput = inp;
    placeText();
    inp.focus();
    setTimeout(function () { if (ui.textInput === inp) inp.focus(); }, 0);
  }
  function commitText() {
    var inp = ui.textInput; if (!inp) return;
    ui.textInput = null;
    var t = (inp.textContent || '').trim().slice(0, 200);
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    if (t) { var s = { t: 'text', a: inp._p, text: t }; s.sel = selectorFor(s); shapes.push(s); }
    redraw();
  }

  // Draw shape s onto context c: document point (x, y) lands at ((x - ox) * k, (y - oy) * k).
  function drawShape(c, s, k, ox, oy) {
    var X = function (v) { return (v - ox) * k; }, Y = function (v) { return (v - oy) * k; };
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (s.t === 'highlight') {
      c.fillStyle = 'rgba(255,230,0,.38)'; c.strokeStyle = 'rgba(230,180,0,.9)'; c.lineWidth = 2 * k;
      var hx = X(Math.min(s.a.x, s.b.x)), hy = Y(Math.min(s.a.y, s.b.y)), hw = Math.abs(s.a.x - s.b.x) * k, hh = Math.abs(s.a.y - s.b.y) * k;
      c.fillRect(hx, hy, hw, hh); c.strokeRect(hx, hy, hw, hh);
    } else if (s.t === 'text') {
      c.font = 'bold ' + (18 * k) + 'px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
      c.textBaseline = 'middle';
      var w = c.measureText(s.text).width;
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.fillRect(X(s.a.x) - 5 * k, Y(s.a.y) - 14 * k, w + 10 * k, 28 * k);
      c.fillStyle = RED; c.fillText(s.text, X(s.a.x), Y(s.a.y));
    } else {
      c.strokeStyle = RED; c.lineWidth = 4 * k;
      c.beginPath();
      if (s.t === 'pen') {
        s.pts.forEach(function (p, i) { if (i) c.lineTo(X(p.x), Y(p.y)); else c.moveTo(X(p.x), Y(p.y)); });
      } else if (s.t === 'box') {
        c.rect(X(Math.min(s.a.x, s.b.x)), Y(Math.min(s.a.y, s.b.y)), Math.abs(s.a.x - s.b.x) * k, Math.abs(s.a.y - s.b.y) * k);
      } else if (s.t === 'arrow') {
        var ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x), L = 18 * k;
        c.moveTo(X(s.a.x), Y(s.a.y)); c.lineTo(X(s.b.x), Y(s.b.y));
        c.moveTo(X(s.b.x), Y(s.b.y)); c.lineTo(X(s.b.x) - L * Math.cos(ang - 0.45), Y(s.b.y) - L * Math.sin(ang - 0.45));
        c.moveTo(X(s.b.x), Y(s.b.y)); c.lineTo(X(s.b.x) - L * Math.cos(ang + 0.45), Y(s.b.y) - L * Math.sin(ang + 0.45));
      }
      c.stroke();
    }
    c.restore();
  }

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    var ox = window.scrollX, oy = window.scrollY;
    shapes.concat(cur ? [cur] : []).forEach(function (s) { drawShape(ctx, s, dpr, ox, oy); });
  }

  function bounds(s) {
    var ps = s.t === 'pen' ? s.pts : s.t === 'text' ? [s.a, { x: s.a.x + 10 * s.text.length + 10, y: s.a.y + 14 }, { x: s.a.x - 5, y: s.a.y - 14 }] : [s.a, s.b];
    var xs = ps.map(function (p) { return p.x; }), ys = ps.map(function (p) { return p.y; });
    return { x0: Math.min.apply(0, xs), y0: Math.min.apply(0, ys), x1: Math.max.apply(0, xs), y1: Math.max.apply(0, ys) };
  }

  // ----- selectors of marked elements -----
  function anchor(s) {
    if (s.t === 'pen') { var b = bounds(s); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; }
    if (s.t === 'arrow') return s.b;
    if (s.t === 'text') return s.a;
    return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  }
  function cssPath(n) {
    var parts = [];
    while (n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && document.querySelectorAll('#' + n.id).length === 1) { parts.unshift('#' + n.id); break; }
      var tag = n.tagName.toLowerCase(), part = tag;
      var cls = Array.prototype.filter.call(n.classList || [], function (c) { return /^[A-Za-z][\w-]*$/.test(c); }).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      var p = n.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === n.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(part);
      n = p;
    }
    return parts.join(' > ');
  }
  // Worked out when the shape is finished, while it is on screen (elementsFromPoint only sees the viewport).
  function selectorFor(s) {
    try {
      var a = anchor(s);
      var list = document.elementsFromPoint(a.x - window.scrollX, a.y - window.scrollY).filter(function (e) { return e !== host && e !== document.documentElement && e !== document.body; });
      return list.length ? cssPath(list[0]) : '';
    } catch (e) { return ''; }
  }
  function selectors() {
    var out = [];
    shapes.forEach(function (s) { if (s.sel && out.indexOf(s.sel) < 0) out.push(s.sel); });
    return out.slice(0, 30);
  }

  // ----- capture and send -----
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + 'vendor/html2canvas.min.js';
      s.onload = function () { window.html2canvas ? res(window.html2canvas) : rej(new Error('capture library missing')); };
      s.onerror = function () { rej(new Error('capture library failed to load')); };
      document.head.appendChild(s);
    });
  }
  function toBlob(c, type, qual) { return new Promise(function (res) { c.toBlob(res, type, qual); }); }

  // Lazy images below the fold would be blank in a full-page capture; ask for them now (max 4 s).
  function loadLazyImages(r) {
    var waits = [];
    Array.prototype.forEach.call(document.querySelectorAll('img[loading="lazy"]'), function (img) {
      var b = img.getBoundingClientRect(), top = b.top + window.scrollY;
      if (top > r.y + r.h || top + b.height < r.y) return;
      img.loading = 'eager';
      if (!img.complete) waits.push(new Promise(function (res) { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
    });
    return waits.length ? Promise.race([Promise.all(waits), new Promise(function (res) { setTimeout(res, 4000); })]) : Promise.resolve();
  }

  // What to capture: the whole page when it is a sensible size, otherwise the current view plus every drawing (padded).
  var FULL_MAX_H = 12000, MAX_PIXELS = 30000000, MAX_SIDE = 16000;
  function captureRect() {
    var de = document.documentElement, body = document.body;
    var dw = Math.max(de.clientWidth, Math.min(de.scrollWidth, body ? body.scrollWidth : 0)), dh = Math.max(de.scrollHeight, body ? body.scrollHeight : 0);
    var vw = de.clientWidth || window.innerWidth, vh = window.innerHeight;
    if (dh <= FULL_MAX_H) return { x: 0, y: 0, w: dw, h: dh, full: true };
    var y0 = window.scrollY, y1 = window.scrollY + vh;
    shapes.forEach(function (s) { var b = bounds(s); y0 = Math.min(y0, b.y0 - 200); y1 = Math.max(y1, b.y1 + 200); });
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(dh, Math.ceil(y1));
    if (y1 - y0 > FULL_MAX_H) { y0 = window.scrollY; y1 = Math.min(dh, window.scrollY + vh); }
    return { x: 0, y: y0, w: Math.max(vw, dw), h: y1 - y0, full: false };
  }

  function toast(t, ms) {
    var d = el('div', { class: 'toast', role: 'status' }, t);
    root.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 4000);
  }

  function submit() {
    if (sending || !active) return;
    if (ui.textInput) commitText();
    var attErr = xtAttCheck();
    if (attErr) { xtAttRender(''); toast('Fix the attached file: ' + attErr, 6000); return; }
    sending = true;
    var sels = selectors();
    var lastBlob = null;
    var vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    var sx = window.scrollX, sy = window.scrollY;
    var r = captureRect();
    var busy = el('div', { class: 'busy' }, 'Capturing\u2026');
    // hide our own UI from the capture (it is also marked data-html2canvas-ignore)
    ui.bar.style.visibility = 'hidden'; ui.note.style.visibility = 'hidden';
    var scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / Math.max(1, r.w * r.h)), MAX_SIDE / Math.max(1, r.h), MAX_SIDE / Math.max(1, r.w));
    root.appendChild(busy);
    loadH2C().then(function (h2c) {
      return loadLazyImages(r).then(function () {
        return h2c(document.body, {
          x: r.x, y: r.y, width: r.w, height: r.h,
          scrollX: 0, scrollY: 0,
          windowWidth: vw, windowHeight: vh,
          scale: scale, useCORS: true, logging: false, backgroundColor: '#ffffff',
          ignoreElements: function (n) { return n === host; }
        });
      });
    }).then(function (shot) {
      var out = document.createElement('canvas');
      out.width = shot.width; out.height = shot.height;
      var c = out.getContext('2d');
      c.drawImage(shot, 0, 0);
      var k = shot.width / r.w;
      shapes.forEach(function (s) { drawShape(c, s, k, r.x, r.y); });
      return toBlob(out, 'image/jpeg', 0.85).then(function (b) {
        return b && b.size > 9 * 1024 * 1024 ? toBlob(out, 'image/jpeg', 0.55) : b;
      });
    }).then(function (blob) {
      if (!blob) throw new Error('could not make the screenshot');
      lastBlob = blob;
      busy.textContent = 'Sending\u2026';
      var fd = new FormData();
      fd.append('a', 'submit');
      fd.append('brand', brand);
      fd.append('note', ui.text.value);
      fd.append('page_url', location.href);
      fd.append('capture', (r.full ? 'full page ' : 'part ') + r.w + 'x' + r.h + ' from y=' + r.y + ', view at ' + sx + ',' + sy);
      fd.append('viewport', vw + 'x' + vh + '@' + (Math.round((window.devicePixelRatio || 1) * 100) / 100));
      fd.append('selectors', JSON.stringify(sels));
      fd.append('image', blob, 'markup.jpg');
      return fetch(BASE, { method: 'POST', credentials: 'same-origin', headers: { 'X-DW-Markup': '1', 'X-DW-CSRF': csrf }, body: fd })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); });
    }).then(function (j) {
      sending = false;
      if (busy.parentNode) busy.parentNode.removeChild(busy);
      if (j && j.ok) {
        window.__dwMarkupLast = j.id;
        xtSubmit(j, lastBlob, sels, (r.full ? 'full page ' : 'part ') + r.w + 'x' + r.h, vw + 'x' + vh);
        stop();
        if (XT.active) toast('Edit request sent. The ' + xtAiName(XT.ai || xtAiPref()) + ' reply will appear in the panel.');
        else toast('Edit request saved. The AI relay is not running on this page: reload it, then Send again.', 8000);
      } else {
        if (ui.bar) { ui.bar.style.visibility = ''; ui.note.style.visibility = ''; }
        toast('Could not send: ' + ((j && j.error) || 'unknown error'), 6000);
      }
    }).catch(function (err) {
      sending = false;
      if (busy.parentNode) busy.parentNode.removeChild(busy);
      if (ui.bar) { ui.bar.style.visibility = ''; ui.note.style.visibility = ''; }
      toast('Could not send: ' + (err && err.message ? err.message : err), 6000);
    });
  }
})();
