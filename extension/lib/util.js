(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  // "1.2.10" vs "1.2.9" -> 1 ; missing parts count as 0
  function compareVersions(a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }
  // Stable JSON (sorted keys) so hashes and signatures do not depend on key order or whitespace.
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function b64uToBytes(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s); var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function sha256Hex(str, subtle) {
    return hex(await subtle.digest('SHA-256', new TextEncoder().encode(str)));
  }
  // Ed25519 signature check (WebCrypto, Chrome 137+ and Node 20+). Returns true/false, never throws.
  async function verifyEd25519(publicJwk, message, sigB64u, subtle) {
    try {
      var key = await subtle.importKey('jwk', publicJwk, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, key, b64uToBytes(sigB64u), new TextEncoder().encode(message));
    } catch (e) { return false; }
  }
  return { compareVersions: compareVersions, canonical: canonical, sha256Hex: sha256Hex, verifyEd25519: verifyEd25519, b64uToBytes: b64uToBytes };
});
