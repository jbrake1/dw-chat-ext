/* DW Chat Integration: anonymous error reports.
 * Payload is exactly {site, step, extVersion, instructionsVersion, errorCode, ts}. Every field is validated against a
 * strict pattern, so prompts, replies, screenshots, URLs or account data cannot be put in it by accident.
 * Sent without cookies. Deduplicated (same site+step+code+instructionsVersion at most once per hour). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  var FIELDS = ['site', 'step', 'extVersion', 'instructionsVersion', 'errorCode', 'ts'];
  var PAT = { site: /^[a-z0-9_-]{1,32}$/, step: /^[a-z_]{1,32}$/, extVersion: /^[0-9A-Za-z._-]{1,32}$/, instructionsVersion: /^[0-9A-Za-z._-]{1,32}$/, errorCode: /^[a-z0-9_]{1,40}$/ };

  function build(r, nowMs) {
    var out = {};
    ['site', 'step', 'extVersion', 'instructionsVersion', 'errorCode'].forEach(function (k) {
      var v = r && typeof r[k] === 'string' ? r[k] : '';
      out[k] = PAT[k].test(v) ? v : (k === 'errorCode' ? 'unknown' : (k === 'step' ? 'unknown' : 'unknown'));
    });
    out.ts = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
    return { site: out.site, step: out.step, extVersion: out.extVersion, instructionsVersion: out.instructionsVersion, errorCode: out.errorCode, ts: out.ts };
  }

  function Reporter(opts) {
    this.fetch = opts.fetch; this.url = opts.url; this.enabled = opts.enabled || function () { return true; };
    this.store = opts.store; this.now = opts.now || Date.now; this.sent = [];
  }
  Reporter.prototype.report = async function (r) {
    if (!(await this.enabled())) return { sent: false, why: 'disabled' };
    var p = build(r, this.now());
    var key = [p.site, p.step, p.errorCode, p.instructionsVersion].join('|');
    var seen = (await this.store.get('reportSeen')) || {};
    if (seen[key] && this.now() - seen[key] < 3600 * 1000) return { sent: false, why: 'deduped' };
    seen[key] = this.now();
    Object.keys(seen).forEach(function (k) { if (this.now() - seen[k] > 86400 * 1000) delete seen[k]; }, this);
    await this.store.set('reportSeen', seen);
    try {
      await this.fetch(this.url, { method: 'POST', credentials: 'omit', keepalive: true, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      this.sent.push(p);
      return { sent: true, payload: p };
    } catch (e) { return { sent: false, why: 'network' }; }
  };

  return { buildReport: build, Reporter: Reporter, REPORT_FIELDS: FIELDS };
});
