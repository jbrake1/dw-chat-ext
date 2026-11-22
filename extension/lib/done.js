/* DW Chat Integration: done-detection state machine.
 * Pure logic, injectable clock, so it is unit-tested without a browser.
 * It is driven by DOM mutations (call update() on each observed change). The only timer it uses is ONE one-shot
 * timer, re-armed by update(), to wait out the "text stable for N ms" condition. It never polls.
 *
 * Rule (from the site instructions JSON):  { "all": [ {type:"newMessage"}, {type:"absent", step:"stop"},
 *   {type:"textStable", ms:1500}, {type:"present", step:"x"}, {type:"minElapsedMs", ms:N} ] }
 * State passed to update():  { present: {stepName: bool}, newMessage: bool, signature: string, nonEmpty: bool }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function DoneDetector(rule, opts) {
    opts = opts || {};
    this.rule = rule || { all: [] };
    this.now = opts.now || function () { return Date.now(); };
    this.setTimeout = opts.setTimeout || function (f, ms) { return setTimeout(f, ms); };
    this.clearTimeout = opts.clearTimeout || function (t) { return clearTimeout(t); };
    this.onDone = opts.onDone || function () {};
    this.startedAt = this.now();
    this.lastSignature = null;
    this.stableSince = this.startedAt;
    this.state = null;
    this.timer = null;
    this.fired = false;
    this.cancelled = false;
  }

  // Returns {ok:boolean, waitMs:number}. waitMs>0 means "all non-time conditions hold, time conditions need waitMs more".
  DoneDetector.prototype.evaluate = function (state, now) {
    var conds = (this.rule && this.rule.all) || [];
    var wait = 0;
    if (!conds.length) return { ok: false, waitMs: 0 };
    for (var i = 0; i < conds.length; i++) {
      var c = conds[i];
      switch (c.type) {
        case 'newMessage': if (!state.newMessage) return { ok: false, waitMs: 0 }; break;
        case 'present': if (!(state.present && state.present[c.step])) return { ok: false, waitMs: 0 }; break;
        case 'absent': if (state.present && state.present[c.step]) return { ok: false, waitMs: 0 }; break;
        case 'textStable': {
          if (!c.allowEmpty && !state.nonEmpty) return { ok: false, waitMs: 0 };
          wait = Math.max(wait, c.ms - (now - this.stableSince)); break;
        }
        case 'minElapsedMs': wait = Math.max(wait, c.ms - (now - this.startedAt)); break;
        default: return { ok: false, waitMs: 0 }; // unknown condition type never completes (schema should prevent it)
      }
    }
    return { ok: wait <= 0, waitMs: Math.max(0, wait) };
  };

  DoneDetector.prototype.update = function (state) {
    if (this.fired || this.cancelled) return false;
    var now = this.now();
    this.state = state;
    if (state.signature !== this.lastSignature) { this.lastSignature = state.signature; this.stableSince = now; }
    return this._check(now);
  };

  DoneDetector.prototype._check = function (now) {
    if (this.timer != null) { this.clearTimeout(this.timer); this.timer = null; }
    var r = this.evaluate(this.state, now);
    if (r.ok) { this.fired = true; this.onDone(); return true; }
    if (r.waitMs > 0) {
      var self = this;
      this.timer = this.setTimeout(function () { self.timer = null; if (!self.fired && !self.cancelled) self._check(self.now()); }, r.waitMs);
    }
    return false;
  };

  DoneDetector.prototype.cancel = function () {
    this.cancelled = true;
    if (this.timer != null) { this.clearTimeout(this.timer); this.timer = null; }
  };

  return { DoneDetector: DoneDetector };
});
