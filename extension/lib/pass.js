/* DW Chat Integration: editor "pass" check.
 * The DW site (same origin as the page, credentials included) issues a short-lived pass only to a signed-in editor
 * of THAT site. The extension refuses to touch the chat tab without a pass that is for the sender's host, not
 * expired, and (when a public key is configured) correctly signed.
 *   pass = {ok:true, pass, site, sub, role:'editor', iat, exp, now, sig?}   (epoch seconds; `now` = server clock)
 * Signature (Ed25519, base64url) covers canonical JSON of {exp, iat, pass, role, site, sub}.
 */
(function (root, factory) {
  var deps = (typeof module === 'object' && module.exports) ? { U: require('./util.js') } : { U: root.DWX };
  var api = factory(deps.U);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function (U) {
  'use strict';
  var MAX_TTL_S = 900;

  function signedPart(p) { return U.canonical({ exp: p.exp, iat: p.iat, pass: p.pass, role: p.role, site: p.site, sub: p.sub }); }

  // receivedAt = local ms when the pass response arrived. Validity is measured against the server's own clock
  // difference (exp - now), so a wrong local clock cannot extend or shorten it.
  async function verifyPass(p, ctx) {
    // ctx: {host, receivedAt, nowMs, subtle, publicKeyJwk}
    if (!p || p.ok !== true || typeof p.pass !== 'string' || p.pass.length < 8) return { ok: false, code: 'no_pass' };
    if (p.role !== 'editor') return { ok: false, code: 'not_editor' };
    if (typeof p.site !== 'string' || p.site.toLowerCase().replace(/^www\./, '') !== String(ctx.host).toLowerCase().replace(/^www\./, '')) return { ok: false, code: 'wrong_site' };
    if (typeof p.sub !== 'string' || !p.sub) return { ok: false, code: 'no_subject' };
    if (!Number.isFinite(p.exp) || !Number.isFinite(p.now) || !Number.isFinite(p.iat)) return { ok: false, code: 'bad_times' };
    var ttl = p.exp - p.now;
    if (ttl <= 0) return { ok: false, code: 'expired' };
    if (p.exp - p.iat > MAX_TTL_S || ttl > MAX_TTL_S) return { ok: false, code: 'ttl_too_long' };
    var ageMs = ctx.nowMs - ctx.receivedAt;
    if (ageMs < -2000 || ageMs > ttl * 1000) return { ok: false, code: 'expired' };
    if (ctx.publicKeyJwk) {
      if (!p.sig) return { ok: false, code: 'unsigned' };
      var good = await U.verifyEd25519(ctx.publicKeyJwk, signedPart(p), p.sig, ctx.subtle);
      if (!good) return { ok: false, code: 'bad_signature' };
    }
    return { ok: true, sub: p.sub, site: p.site, validUntilMs: ctx.receivedAt + ttl * 1000 };
  }

  return { verifyPass: verifyPass, signedPart: signedPart, MAX_TTL_S: MAX_TTL_S };
});
