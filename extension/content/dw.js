/* DW Chat Integration: DW-site content script. INACTIVE by default.
 * It does nothing (no network, no panel) on a page unless the page looks like an editor session
 * (dw_ed / dw_mk hint cookie, #suggest-edit in the URL, or the editor's #dw-markup-root appears). Then it asks the
 * site (same origin, cookies included) /_dw/whoami and POST /_dw/ext/pass. Only with a valid pass does it turn on:
 * panel, green icon, and relaying of submits to the paired chat tab. See SERVER_CONTRACT.md for the page protocol.
 */
(function () {
  'use strict';
  if (window.__dwExt) return;
  window.__dwExt = true;
  var EXT_VERSION = chrome.runtime.getManifest().version;
  var S = { active: false, relay: true, state: { active: false, paired: false, paused: false, busy: false }, nativeHook: false,
            nativePanel: false, wantEvents: false, panel: null, lastGesture: 0, jobId: null, pending: null, renewTimer: null, activating: false, activateP: null, cfg: {} };

  // After the extension is reloaded or updated, this old script is orphaned: chrome.runtime.sendMessage throws
  // ("Extension context invalidated"). Report that instead of failing silently.
  function send(msg) {
    try { return chrome.runtime.sendMessage(msg).catch(function () { return { ok: false, code: 'sw_unreachable' }; }); }
    catch (e) { return Promise.resolve({ ok: false, code: 'sw_unreachable' }); }
  }
  // Page-side relay log (v0.1.7): kept in sessionStorage so it survives a reload or a closed editor, and copied into the
  // extension's own ring buffer. Event names and codes only.
  var LOG_KEY = 'dwx_relaylog', LOG_MAX = 60;
  function dwLog(ev, data) {
    try {
      var arr = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]');
      var e = { t: Date.now(), ev: String(ev).slice(0, 30) };
      if (data && typeof data === 'object') Object.keys(data).slice(0, 6).forEach(function (k) { var v = data[k]; e[k] = (v == null || typeof v === 'number' || typeof v === 'boolean') ? v : String(v).slice(0, 60); });
      arr.push(e); if (arr.length > LOG_MAX) arr = arr.slice(-LOG_MAX);
      sessionStorage.setItem(LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
    try { chrome.runtime.sendMessage({ type: 'dw:log', ev: ev, data: data || {} }).catch(function () {}); } catch (e) {}
  }
  function pageLog() { try { return JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
  function withTimeout(promise, ms, code) {
    var t;
    return Promise.race([
      Promise.resolve(promise).finally(function () { clearTimeout(t); }),
      new Promise(function (_, rej) { t = setTimeout(function () { rej(Object.assign(new Error(code), { code: code })); }, ms); })
    ]).catch(function (e) { return { ok: false, code: (e && e.code) || code || 'timeout' }; });
  }
  function toPage(type, extra) { window.postMessage(Object.assign({ source: 'dw-ext', type: type, v: 1 }, extra || {}), location.origin); }
  function emitStatus() {
    return send({ type: 'dw:pageStatus' }).then(function (r) {
      var st = DWX.pageStatus({
        extVersion: EXT_VERSION,
        paired: !!(r && r.paired),
        ai: r && r.ai,
        revision: r && r.revision,
        editor: S.active,
        provider: (r && r.provider) || (S.state && S.state.provider)
      });
      toPage('dw-ext-status', st);
      return st;
    });
  }
  function replyStatus() {
    if (S.activateP) return S.activateP.then(function () { return emitStatus(); }, function () { return emitStatus(); });
    return emitStatus();
  }

  // ---------- gate ----------
  function candidate() {
    return /(?:^|;\s*)(?:dw_ed|dw_mk)=/.test(document.cookie) || location.hash === '#suggest-edit' || !!document.getElementById('dw-markup-root');
  }
  function maybeActivate() { if (!S.active && !S.activating && candidate()) return activate(); }

  // ---------- pass ----------
  async function fetchPass() {
    try {
      var w = await withTimeout(fetch('/_dw/whoami', { credentials: 'include', cache: 'no-store' }), 8000, 'pass_timeout');
      if (w && w.ok === false && w.code) return null;
      var wj = w && w.ok ? await w.json() : null;
      if (!wj || wj.edit !== true) return null;
      var receivedAt;
      var r = await withTimeout(fetch('/_dw/ext/pass', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'X-DW-Ext': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ extVersion: EXT_VERSION }) }), 8000, 'pass_timeout');
      receivedAt = Date.now();
      if (!r || !r.ok) return null;
      var pj = await r.json();
      return pj && pj.ok ? { pass: pj, receivedAt: receivedAt } : null;
    } catch (e) { return null; }
  }

  async function activate() {
    if (S.activateP) return S.activateP;
    S.activating = true;
    S.activateP = (async function () {
    try {
      var p = await fetchPass();
      if (!p) return deactivate();
      var r = await send({ type: 'dw:activate', pass: p.pass, receivedAt: p.receivedAt });
      if (!r || !r.ok) return deactivate();
      S.active = true; S.state = r.state; S.cfg = r.cfg || S.cfg;
      mountPanel();
      applyState();
      scheduleRenew(p);
      toPage('dw-ext-ready', { paired: !!S.state.paired });
      emitStatus();
      editorFallback();
      // Give a page that implements the hook time to answer with dw-ext-hello; only then fall back to the fetch tap.
      if (!S.tapTimer) S.tapTimer = setTimeout(function () {
        if (S.active && !S.nativeHook && !S.tapRequested) { S.tapRequested = true; send({ type: 'dw:injectTap' }); }
      }, 500);
    } finally { S.activating = false; S.activateP = null; }
    })();
    return S.activateP;
  }
  // v0.1.10: a page whose own inline loader is broken (a stray unterminated script in its source swallowed the loader, so
  // the editor never mounted and only this panel showed) gets the editor loaded from here, once per page, after 3 s.
  // Only when the page itself names /_dw/edit.js, no editor has mounted, and nothing has loaded it yet.
  function editorFallback() {
    if (S.fbTimer) return;
    S.fbTimer = setTimeout(function () {
      try {
        if (!S.active || document.getElementById('dw-markup-root') || document.querySelector('script[src*="/_dw/edit.js"],script[src*="/markup/markup.js"]')) return;
        var named = Array.prototype.some.call(document.scripts, function (s) { return !s.src && s.textContent.indexOf('/_dw/edit.js') >= 0; });
        if (!named) return;
        var el = document.createElement('script'); el.src = '/_dw/edit.js'; el.async = true; el.setAttribute('data-dw-ext-fallback', '1');
        (document.head || document.documentElement).appendChild(el);
        dwLog('editorFallback', {});
      } catch (e) {}
    }, 3000);
  }
  function scheduleRenew(p) {
    if (S.renewTimer) clearTimeout(S.renewTimer);
    var ttlMs = (p.pass.exp - p.pass.now) * 1000;
    S.renewTimer = setTimeout(function () { S.renewTimer = null; if (S.active) activate(); }, Math.max(15000, ttlMs * 0.6));
  }
  function deactivate() {
    var was = S.active;
    dwLog('deactivate', { was: was });
    S.active = false; S.pending = null;
    if (S.renewTimer) { clearTimeout(S.renewTimer); S.renewTimer = null; }
    if (S.panel) { S.panel.destroy(); S.panel = null; }
    if (was) { send({ type: 'dw:deactivate' }); toPage('dw-ext-inactive'); }
    emitStatus();
  }

  // ---------- panel ----------
  function mountPanel() {
    if (S.panel || S.nativePanel) return;
    S.panel = DWX.createPanel(document, {
      onStop: function () { localStop(); },
      onPause: function () { send({ type: 'dw:control', action: 'pause' }); },
      onResume: function () { send({ type: 'dw:control', action: 'resume' }); },
      onUnpair: function () { send({ type: 'dw:control', action: 'unpair' }); },
      onOpenFile: function (id) { send({ type: 'dw:control', action: 'openFile', id: id }); },
      onToggle: function (on) { S.relay = !!on; chrome.storage.local.set({ relayEnabled: !!on }); },
      onProvider: function (id) { if (DWX.providers.valid(id)) send({ type: 'dw:setProvider', provider: id }); },
      onSnapshot: function () { return send({ type: 'dw:snapshot' }); }
    });
    chrome.storage.local.get('relayEnabled').then(function (d) { S.relay = d.relayEnabled !== false; if (S.panel) S.panel.setRelayChecked(S.relay); });
  }
  function applyState() {
    if (S.panel) S.panel.setState(Object.assign({}, S.state, { active: S.active }));
    emitStatus();
    if (S.active && S.pending && !S.state.paused && !S.state.busy) { var j = S.pending; S.pending = null; submitJob(j); }
  }

  // ---------- submit ----------
  var DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;
  function buildPrompt(d) {
    var t = (S.cfg.promptTemplate || '{note}');
    return t.replace('{host}', location.hostname).replace('{pageUrl}', String(d.pageUrl || location.href)).replace('{note}', String(d.note || '(no note)'));
  }
  // "tomorrow after 4:37 PM" from the extension's own event; only plain time/day text is accepted.
  function limitWhen(e) {
    var time = typeof e.retryAfter === 'string' && /^\d{1,2}(?::\d{2})?(?: ?[AP]M)?$/.test(e.retryAfter) ? e.retryAfter : '';
    var day = e.retryDay === 'tomorrow' || e.retryDay === 'today' ? e.retryDay : '';
    return { time: time, day: day, phrase: time ? (day ? day + ' ' : '') + 'after ' + time : 'later' };
  }
  function onSubmitEvent(d, via) {
    if (!S.active || !S.relay) { dwLog('submit_ignored', { why: !S.active ? 'inactive' : 'relay_off', via: via }); if (via === 'native' && S.wantEvents) toPage('dw-ext-error', { code: !S.active ? 'ext_inactive' : 'relay_off', step: 'submit' }); return; }   // inactive or user switched the relay off
    if (via === 'tap' && S.nativeHook) return;               // page has its own hook; ignore the tap
    if (Date.now() - S.lastGesture > 120000) { dwLog('submit_ignored', { why: 'no_gesture', via: via }); if (via === 'native' && S.wantEvents) toPage('dw-ext-error', { code: 'no_gesture', step: 'submit' }); return; }   // must follow a real click/keypress by the user
    var note = String(d.note || '').slice(0, 5000);
    var shot = typeof d.screenshot === 'string' && DATA_URL.test(d.screenshot) && d.screenshot.length < 20 * 1024 * 1024 ? d.screenshot : null;
    var mime = shot ? DATA_URL.exec(shot)[1] : null;
    var file = shot ? { name: 'markup.' + (mime === 'jpeg' ? 'jpg' : mime), type: 'image/' + mime, dataUrl: shot } : null;
    // Page source files (v0.1.3): the page's HTML, same-origin CSS/JS and relevant images, downloaded by the editor.
    // Untrusted input: allowlisted types, safe names/paths, count and size caps (lib/pagefiles.js).
    var pf = { files: [], skipped: [] };
    // The editor's own "Include page files" checkbox decides whether any are sent; the tap fallback never sends files.
    if (via === 'native' && (Array.isArray(d.files) || Array.isArray(d.skipped))) {
      pf = DWX.sanitizePageFiles(d.files, d.skipped, { reserved: file ? [file.name] : [] });
    }
    var prompt = buildPrompt({ note: note, pageUrl: d.pageUrl }) + DWX.filesPrompt(pf.files, pf.skipped, file && file.name);
    // v0.1.6: the editor may name the AI (dw-ext-submit provider: 'chatgpt' | 'gemini'); anything else is ignored.
    var provider = (via === 'native' && DWX.providers.valid(d.provider)) ? d.provider : null;
    var job = { provider: provider, prompt: prompt.slice(0, 20000), file: file, files: pf.files.map(function (f) { return { name: f.name, path: f.path, type: f.type, dataUrl: f.dataUrl, attached: f.attached === true }; }), note: note, hadShot: !!shot };
    submitJob(job);
  }
  function localStop() {
    S.stopped = true;
    S.workGen = (S.workGen || 0) + 1;
    S.pending = null;
    S.jobId = null;
    send({ type: 'dw:control', action: 'stop' });
    if (S.panel) S.panel.done('stopped');
    if (S.wantEvents) toPage('dw-ext-done', { status: 'stopped', text: '', files: [] });
  }
  function aiName(id) { return DWX.providers.label(id || S.state.provider || DWX.providers.DEFAULT_ID); }
  function queue(job) { S.pending = job; if (S.panel) S.panel.note('Paused. This will be sent to ' + aiName(job.provider) + ' when you press Resume.'); }
  // A send that failed before the service worker was busy (not paired, no pass, no answer) must not leave the panel on
  // "Sending to ..." forever: no state event follows, so return it to idle here.
  function idlePanel() {
    if (S.panel) S.panel.setState(Object.assign({}, S.state, { active: S.active, provider: S.jobProvider, busy: false }));
  }
  async function submitJob(job) {
    if (S.state.paused) return queue(job);                   // nothing new is sent while paused
    S.jobProvider = job.provider || (S.state && S.state.provider) || DWX.providers.DEFAULT_ID;
    S.workGen = (S.workGen || 0) + 1;
    var gen = S.workGen;
    S.stopped = false;
    dwLog('submit', { provider: S.jobProvider, files: (job.files || []).length, shot: !!job.file });
    if (S.panel) {
      S.panel.setState(Object.assign({}, S.state, { active: S.active, provider: S.jobProvider, busy: true }));
      S.panel.addUser((job.note || '(no note)').slice(0, 300), job.file && job.file.dataUrl);
    }
    var p = await fetchPass();                               // fresh pass for every send
    dwLog('pass', { ok: !!p });
    if (gen !== S.workGen || S.stopped) return;
    if (!p) { idlePanel(); if (S.panel) S.panel.error('Not sent: the site did not confirm you are an editor.'); return deactivate(); }
    var sj = { prompt: job.prompt, file: job.file, files: job.files || [] };
    if (job.provider) sj.provider = job.provider;
    var r = await withTimeout(send({ type: 'dw:submit', pass: p.pass, receivedAt: p.receivedAt, job: sj }), 45000, 'relay_timeout');
    dwLog('submit_result', { ok: !!(r && r.ok), code: r && r.code });
    if (gen !== S.workGen || S.stopped) return;
    if (r && r.ok) { S.jobId = r.jobId; S.jobProvider = r.provider || job.provider || S.state.provider; return; }
    var code = (r && r.code) || 'unknown';
    if (code === 'paused') return queue(job);
    var pid = (r && r.provider) || job.provider || S.state.provider;
    var msg = (['not_paired', 'busy', 'chat_tab_unreachable', 'tab_open_failed'].indexOf(code) >= 0 && DWX.providers.message(pid, code))
      || (code === 'relay_timeout' ? ('Not sent: ' + aiName(pid) + ' did not start in time.') : null)
      || (code === 'sw_unreachable' ? 'Not sent: the extension was reloaded or updated. Reload this page to reconnect it.' : null)
      || (code === 'stopped' ? null : ('Not sent (' + code + ').'));
    if (code === 'stopped') return;
    idlePanel();
    if (S.panel) S.panel.error(msg);
    if (S.wantEvents) toPage('dw-ext-error', { code: code, step: 'submit' });
  }

  // ---------- events from the service worker ----------
  // v0.1.4: reply code blocks for the editor to stage as a /files preview. Strings only, capped again here.
  function blocks2(bs) {
    var out = [], total = 0;
    (Array.isArray(bs) ? bs : []).slice(0, 12).forEach(function (b) {
      if (!b || typeof b.code !== 'string' || b.code.length > 2 * 1024 * 1024 || total + b.code.length > 6 * 1024 * 1024) return;
      total += b.code.length;
      out.push({ label: String(b.label || '').slice(-300), lang: /^[A-Za-z0-9+#._-]{0,20}$/.test(String(b.lang || '')) ? String(b.lang || '').toLowerCase() : '', code: b.code });
    });
    return out;
  }
  function files2(fs) { return (fs || []).map(function (f) { return { name: f.name, url: f.url, kind: f.kind, needsTab: !!f.needsTab }; }); }
  async function uploadSnapshot(body) {
    var brand = '';
    try { var sc = document.querySelector('script[data-brand]'); if (sc) brand = sc.getAttribute('data-brand') || ''; } catch (e) {}
    function q(a) { return '/markup/?a=' + a + (brand ? '&brand=' + encodeURIComponent(brand) : ''); }
    try {
      var st = await fetch(q('status'), { credentials: 'same-origin', cache: 'no-store' });
      var sj = st && st.ok ? await st.json() : null;
      if (!sj || !sj.show || !sj.csrf) return { ok: false, code: 'not_editor' };
      var r = await fetch(q('snapshot'), { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-DW-Markup': '1', 'X-DW-CSRF': sj.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var j = await r.json().catch(function () { return null; });
      if (j && j.ok && j.id) return { ok: true, id: String(j.id).slice(0, 16), via: 'upload' };
      return { ok: false, code: (j && (j.error_code || j.error)) || ('http_' + r.status) };
    } catch (e) { return { ok: false, code: 'upload_failed' }; }
  }
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id || !msg) return;
    if (msg.type === 'sw:state') { S.state = msg.state; applyState(); return; }
    if (msg.type === 'sw:uploadSnap') { uploadSnapshot(msg.body).then(sendResponse); return true; }
    if (msg.type !== 'sw:event') return;
    var e = msg.event || {};
    var P = S.panel;
    if (e.kind === 'step' || e.kind === 'error' || e.kind === 'done') dwLog('ev:' + e.kind, { step: e.step, code: e.code, status: e.status, ok: e.ok });
    if (e.kind === 'step') {
      if (P) P.step(e.step, e.ok !== false, e.detail && (e.detail.strategy || e.detail.source || (e.detail.selectorIndex != null ? '#' + e.detail.selectorIndex : '')), e.step === 'attach' && e.detail ? e.detail.pageFiles : null);
      var stepMsg = { step: e.step, ok: e.ok !== false };
      if (e.step === 'attach' && e.detail && typeof e.detail.pageFiles === 'number') { stepMsg.files = Math.max(0, Math.min(50, e.detail.pageFiles | 0)); stepMsg.shot = e.detail.shot !== false; }
      if (e.step === 'attach_inline' && e.detail) stepMsg.files = Math.max(0, Math.min(50, e.detail.files | 0));
      if (e.step === 'send' && e.detail && e.detail.inline) stepMsg.inline = true;
      if (S.wantEvents) toPage('dw-ext-step', stepMsg);
    } else if (e.kind === 'chunk') {
      if (P) P.setReply(e.text, e.files);
      if (S.wantEvents) toPage('dw-ext-chunk', { jobId: msg.jobId, seq: e.seq, text: e.text, files: files2(e.files) });
    } else if (e.kind === 'done') {
      if (P) P.done(e.status);
      if (S.wantEvents) toPage('dw-ext-done', { jobId: msg.jobId, status: e.status, text: e.text, files: files2(e.files), blocks: blocks2(e.blocks) });
    } else if (e.kind === 'error') {
      var pidE = S.jobProvider || S.state.provider;
      var text = DWX.providers.message(pidE, e.code);
      // File / upload limit notice (v0.1.5): a clear message, the time the AI gave (plain text only), and the page-file
      // count so the editor can offer a text + screenshot retry. Nothing is clicked on the chat page.
      var when = e.code === 'file_limit' ? limitWhen(e) : null;
      if (when) text = DWX.providers.label(pidE) + '\u2019s file limit was reached. Try again ' + when.phrase + ', or send without page files.';
      if (P) P.error((text || ('Relay problem at step \u201c' + e.step + '\u201d: ' + e.code + '.')) + (e.sent ? '' : ' Nothing was sent.'));
      if (S.wantEvents) toPage('dw-ext-error', when ? { jobId: msg.jobId, code: e.code, step: e.step, retryAfter: when.time, retryDay: when.day, pageFiles: Math.max(0, Math.min(50, e.pageFiles | 0)) } : { jobId: msg.jobId, code: e.code, step: e.step });
    } else if (e.kind === 'status' && P) { P.note(e.state === 'paused' ? 'Paused.' : 'Resumed.'); }
  });

  // ---------- page protocol ----------
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source === 'dw-edit') {
      if (d.type === 'dw-ext-hello') {
        S.nativeHook = true; S.nativePanel = d.panel === true; S.wantEvents = d.wantEvents !== false;
        if (S.nativePanel && S.panel) { S.panel.destroy(); S.panel = null; }
        // Do not send dw-ext-ready here: a page that answers ready with hello would loop.
        // activate() already posts ready once; this hello is answered with status only.
        if (!S.active && candidate()) maybeActivate();
        replyStatus();
      } else if (d.type === 'dw-ext-status') {
        if (!S.active && candidate()) maybeActivate();
        replyStatus();
      } else if (d.type === 'dw-ext-diag') {
        // The editor asks for a snapshot of the relay (step names, codes and timings only; no notes, replies or screenshots).
        send({ type: 'dw:diag' }).then(function (r) { toPage('dw-ext-diag-result', { ok: !!(r && r.ok), code: r && r.code, ext: r && r.diag ? r.diag : null, page: pageLog(), active: S.active, extVersion: EXT_VERSION }); });
      } else if (d.type === 'dw-ext-snapshot') {
        send({ type: 'dw:snapshot' }).then(function (r) { toPage('dw-ext-snapshot-result', r && r.ok ? { ok: true, id: r.id, via: r.via, filename: r.filename, json: r.json } : { ok: false, code: (r && r.code) || 'no_answer' }); });
      } else if (d.type === 'dw-ext-submit') onSubmitEvent(d, 'native');
      else if (d.type === 'dw-ext-provider' && S.active && DWX.providers.valid(d.provider)) send({ type: 'dw:setProvider', provider: d.provider });
      else if (d.type === 'dw-ext-control' && d.action === 'stop') localStop();
      else if (d.type === 'dw-ext-control' && S.active && ['pause', 'resume'].indexOf(d.action) >= 0) send({ type: 'dw:control', action: d.action });
    } else if (d.source === 'dw-edit-tap' && d.type === 'dw-ext-submit') onSubmitEvent(d, 'tap');
  });
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, function (e) { if (e.isTrusted) S.lastGesture = Date.now(); }, true); });

  // ---------- start ----------
  window.addEventListener('hashchange', maybeActivate);
  new MutationObserver(function () { maybeActivate(); }).observe(document.documentElement, { childList: true });
  maybeActivate();
})();
