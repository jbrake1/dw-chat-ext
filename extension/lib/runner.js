/* DW Chat Integration: job runner. Runs one request against a chat page by interpreting the site instructions:
 * flow (text / attach / send) -> MutationObserver stream watcher -> done detection -> events.
 * Events go to hooks.emit(evt):
 *   {kind:'step', step, ok, detail}        progress of each interpreter step
 *   {kind:'chunk', seq, text, files}       snapshot of the assistant reply so far (relayed live; held while paused)
 *   {kind:'done', status:'complete'|'stopped', text, files}
 *   {kind:'error', step, code, sent, fatal}
 */
(function (root, factory) {
  var deps = (typeof module === 'object' && module.exports)
    ? { I: require('./interpreter.js'), D: require('./done.js') }
    : { I: root.DWX, D: root.DWX };
  var api = factory(deps.I, deps.D);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function (I, D) {
  'use strict';

  function runJob(win, instr, job, hooks) {
    var doc = win.document;
    var emit = hooks.emit || function () {};
    var ac = new win.AbortController();
    var steps = instr.steps;
    var stream = instr.stream;
    var elementMap = new Map();
    var ctl = {
      paused: false, stopRequested: false, finished: false, sent: false, seq: 0,
      observer: null, detector: null, timers: [], lastEmitAt: 0, trailing: null, pendingFinal: null,
      lastSig: null, last: null, baseline: 0, started: false, startedAt: 0, sawStop: false, sawMessage: false, grace: null
    };

    function later(fn, ms) { var t = win.setTimeout(fn, ms); ctl.timers.push(t); return t; }
    function cleanup() {
      ctl.finished = true;
      if (ctl.observer) { ctl.observer.disconnect(); ctl.observer = null; }
      if (ctl.detector) ctl.detector.cancel();
      ctl.timers.forEach(function (t) { win.clearTimeout(t); });
      ctl.timers = [];
      if (ctl.trailing != null) { win.clearTimeout(ctl.trailing); ctl.trailing = null; }
    }
    function fail(step, code) {
      if (ctl.finished) return;
      var wasSent = ctl.sent;
      var partial = ctl.last;
      cleanup();
      emit({ kind: 'error', step: step, code: code, sent: wasSent, fatal: true, text: partial ? partial.text : '' });
      result.resolve({ ok: false, step: step, code: code });
    }

    var result = {};
    result.promise = new Promise(function (res) { result.resolve = res; });

    function emitChunk(force) {
      if (ctl.finished || !ctl.last) return;
      if (ctl.paused) return; // hold the relay; resume() flushes the latest snapshot
      var now = Date.now();
      var min = stream.emitMinIntervalMs || 0;
      if (!force && now - ctl.lastEmitAt < min) {
        if (ctl.trailing == null) ctl.trailing = win.setTimeout(function () { ctl.trailing = null; emitChunk(false); }, min - (now - ctl.lastEmitAt));
        return;
      }
      if (ctl.last.signature === ctl.lastSig && !force) return;
      ctl.lastSig = ctl.last.signature; ctl.lastEmitAt = now;
      emit({ kind: 'chunk', seq: ++ctl.seq, text: ctl.last.text, files: ctl.last.files });
    }

    function finish(status) {
      if (ctl.finished) return;
      var s = ctl.last || { text: '', files: [] };
      cleanup();
      var evt = { kind: 'done', status: status, text: s.text, files: s.files };
      if (ctl.paused) { ctl.pendingFinal = evt; ctl.finished = true; }
      else { emit({ kind: 'chunk', seq: ++ctl.seq, text: s.text, files: s.files }); emit(evt); }
      result.resolve({ ok: true, status: status, text: s.text });
    }

    function evaluate() {
      if (ctl.finished) return;
      var st = I.readState(win, doc, instr, ctl.baseline, elementMap);
      ctl.last = st;
      if (st.present.stop) ctl.sawStop = true;
      if (st.newMessage) { ctl.sawMessage = true; if (ctl.grace != null) { win.clearTimeout(ctl.grace); ctl.grace = null; } }
      if (!ctl.started && (st.newMessage || st.present.stop)) {
        ctl.started = true;
        emit({ kind: 'step', step: 'stream', ok: true, detail: { started: true } });
      }
      // generation began (stop button seen) and has ended, but no assistant message was ever found: the reply selector is probably stale
      if (ctl.sawStop && !ctl.sawMessage && !st.present.stop && ctl.grace == null) {
        ctl.grace = later(function () { if (!ctl.sawMessage) fail('stream', 'no_reply'); }, stream.noReplyGraceMs || 8000);
      }
      if (st.error) return fail('stream', st.error);
      emitChunk(false);
      if (ctl.stopRequested && ctl.started && !st.present.stop) return finish('stopped');
      ctl.detector.update(st);
    }

    function startWatching() {
      ctl.startedAt = Date.now();
      ctl.detector = new D.DoneDetector(stream.done, {
        onDone: function () { finish(ctl.stopRequested ? 'stopped' : 'complete'); },
        setTimeout: function (f, ms) { return win.setTimeout(f, ms); },
        clearTimeout: function (t) { return win.clearTimeout(t); }
      });
      ctl.observer = new win.MutationObserver(function () { evaluate(); });
      ctl.observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
      later(function () { if (!ctl.sawStop && !ctl.sawMessage) fail('stream', 'no_stream'); }, stream.startTimeoutMs || 60000);
      later(function () { fail('stream', 'done_timeout'); }, stream.maxDurationMs || 900000);
      evaluate();
    }

    (async function main() {
      try {
        var t0 = Date.now();
        if (steps.loggedOut && I.resolve(doc, steps.loggedOut.selectors).el && !I.resolve(doc, steps.prompt.selectors).el) {
          throw I.StepError('prompt', 'not_logged_in');
        }
        var p = await I.waitFor(win, doc, steps.prompt.selectors, { timeoutMs: steps.prompt.timeoutMs || 10000, step: 'prompt', signal: ac.signal });
        emit({ kind: 'step', step: 'prompt', ok: true, detail: { selectorIndex: p.index, ms: Date.now() - t0 } });
        var promptEl = p.el;
        var order = instr.flow || ['text', 'attach', 'send'];
        for (var i = 0; i < order.length; i++) {
          if (ac.signal.aborted) throw I.StepError('run', 'aborted');
          var op = order[i];
          if (op === 'text') {
            var how = I.setText(win, promptEl, job.prompt, steps.prompt.setText, steps.prompt.clearFirst);
            emit({ kind: 'step', step: 'text', ok: true, detail: { strategy: how } });
          } else if (op === 'attach') {
            // The screenshot first, then any page source files, all in one upload (same message).
            var list = (job.file ? [job.file] : []).concat(Array.isArray(job.files) ? job.files : []);
            if (!list.length) continue;
            var fileObjs = list.map(function (f) { return I.fileFromDataUrl(win, f); });
            var a = await I.attachFile(win, doc, steps.attach, promptEl, fileObjs.length === 1 ? fileObjs[0] : fileObjs, ac.signal);
            a.count = list.length; a.pageFiles = list.length - (job.file ? 1 : 0); a.shot = !!job.file;
            emit({ kind: 'step', step: 'attach', ok: true, detail: a });
          } else if (op === 'send') {
            ctl.baseline = I.countMessages(doc, instr);
            var s = await I.clickSend(win, doc, steps.send, promptEl, ac.signal);
            ctl.sent = true;
            emit({ kind: 'step', step: 'send', ok: true, detail: s });
          }
        }
        startWatching();
      } catch (e) {
        if (e && e.code === 'aborted') { cleanup(); result.resolve({ ok: false, code: 'aborted' }); return; }
        fail((e && e.step) || 'run', (e && e.code) || 'unknown');
      }
    })();

    return {
      promise: result.promise,
      pause: function () { ctl.paused = true; emit({ kind: 'status', state: 'paused' }); },
      resume: function () {
        if (!ctl.paused) return;
        ctl.paused = false;
        emit({ kind: 'status', state: 'resumed' });
        if (ctl.pendingFinal) {
          var f = ctl.pendingFinal; ctl.pendingFinal = null;
          emit({ kind: 'chunk', seq: ++ctl.seq, text: f.text, files: f.files }); emit(f);
        } else emitChunk(true);
      },
      stop: function () {
        if (ctl.finished) return false;
        ctl.stopRequested = true;
        var r = I.resolve(doc, steps.stop.selectors);
        if (r.el) { r.el.click(); emit({ kind: 'step', step: 'stop', ok: true, detail: { selectorIndex: r.index } }); evaluate(); return true; }
        if (!ctl.sent) { // nothing has gone to the chat yet: just cancel
          ac.abort(); ctl.finished = true; cleanup();
          emit({ kind: 'done', status: 'stopped', text: '', files: [], nothingSent: true });
          result.resolve({ ok: true, status: 'stopped', text: '' });
          return true;
        }
        emit({ kind: 'error', step: 'stop', code: 'selector_not_found', sent: true, fatal: false });
        return false;
      },
      abort: function () { ac.abort(); cleanup(); result.resolve({ ok: false, code: 'aborted' }); },
      openFile: function (id) {
        var el = elementMap.get(id);
        if (!el) return false;
        el.click();
        return true;
      },
      _ctl: ctl
    };
  }

  return { runJob: runJob };
});
