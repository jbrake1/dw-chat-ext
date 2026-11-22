/* DW Chat Integration: remote "site instructions" loader.
 * fetch -> size cap -> JSON parse -> JSON-schema validation -> sanity checks (site, min extension version,
 * revision not older than what we hold) -> integrity (sha256 of canonical JSON; optional Ed25519 signature)
 * -> cache. Anything that fails is rejected and the previous good copy (or the bundled one) stays in use.
 * Everything is injected (fetch, store, crypto) so it is unit-testable without Chrome. */
(function (root, factory) {
  var deps = (typeof module === 'object' && module.exports)
    ? { U: require('./util.js'), S: require('./schema.js') } : { U: root.DWX, S: root.DWX };
  var api = factory(deps.U, deps.S);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function (U, S) {
  'use strict';
  var MAX_BYTES = 64 * 1024;
  var SUPPORTED_SCHEMA = 1;

  // Returns {ok, code, instr?, integrityChecked?}. `text` is the raw response body.
  async function validateRemote(text, ctx) {
    // ctx: {schema, siteId, extVersion, floorRevision, subtle, publicKeyJwk}
    if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, code: 'too_large' };
    var instr;
    try { instr = JSON.parse(text); } catch (e) { return { ok: false, code: 'bad_json' }; }
    if (instr && instr.schemaVersion !== SUPPORTED_SCHEMA && typeof instr.schemaVersion === 'number') return { ok: false, code: 'schema_version' };
    var v = S.validateSchema(ctx.schema, instr);
    if (!v.ok) return { ok: false, code: 'schema_invalid', errors: v.errors.slice(0, 5) };
    if (instr.site !== ctx.siteId) return { ok: false, code: 'site_mismatch' };
    if (U.compareVersions(instr.minExtVersion, ctx.extVersion) > 0) return { ok: false, code: 'min_version' };
    if (ctx.floorRevision != null && instr.revision < ctx.floorRevision) return { ok: false, code: 'revision_downgrade' };
    // every regex must compile and be short (the schema caps length)
    var bad = false;
    (function scan(o) {
      if (Array.isArray(o)) return o.forEach(scan);
      if (o && typeof o === 'object') {
        if (typeof o.textMatches === 'string') { try { new RegExp(o.textMatches, 'i'); } catch (e) { bad = true; } }
        if (typeof o.css === 'string' && typeof document !== 'undefined') { try { document.createDocumentFragment().querySelector(o.css); } catch (e) { bad = true; } }
        Object.keys(o).forEach(function (k) { scan(o[k]); });
      }
    })(instr);
    if (bad) return { ok: false, code: 'bad_selector' };
    var integ = instr.integrity || {};
    var checked = false;
    if (integ.hash) {
      var h = await U.sha256Hex(U.canonical(withoutIntegrity(instr)), ctx.subtle);
      if (h !== integ.hash) return { ok: false, code: 'hash_mismatch' };
      checked = true;
    }
    if (ctx.publicKeyJwk) {
      // a signing key is configured: unsigned or badly signed files are refused
      if (!integ.hash || !integ.sig) return { ok: false, code: 'unsigned' };
      var good = await U.verifyEd25519(ctx.publicKeyJwk, integ.hash, integ.sig, ctx.subtle);
      if (!good) return { ok: false, code: 'bad_signature' };
    }
    return { ok: true, instr: instr, integrityChecked: checked };
  }
  function withoutIntegrity(instr) { var c = Object.assign({}, instr); delete c.integrity; return c; }

  // Highest usable revision wins; the bundled copy wins ties. Cached copies that need a newer extension are skipped.
  function choose(cached, bundled, extVersion) {
    var best = { instr: bundled, source: 'bundled' };
    if (cached && cached.instr && U.compareVersions(cached.instr.minExtVersion, extVersion) <= 0 && cached.instr.revision > bundled.revision) {
      best = { instr: cached.instr, source: 'remote', fetchedAt: cached.fetchedAt, integrityChecked: !!cached.integrityChecked };
    }
    return best;
  }

  // store: {get(key)->Promise<any>, set(key,val)->Promise}
  async function refresh(opts) {
    // opts: {fetch, url, store, bundled, schema, extVersion, now, subtle, publicKeyJwk, siteId}
    var key = 'instr:' + opts.siteId;
    var cached = await opts.store.get(key);
    var headers = { 'Accept': 'application/json' };
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
    var res;
    try {
      res = await opts.fetch(opts.url, { cache: 'no-store', credentials: 'omit', headers: headers });
    } catch (e) { return { status: 'failed', code: 'fetch_failed' }; }
    if (res.status === 304) { await opts.store.set(key, Object.assign({}, cached, { checkedAt: opts.now() })); return { status: 'unchanged' }; }
    if (!res.ok) return { status: 'failed', code: 'http_' + res.status };
    var text;
    try { text = await res.text(); } catch (e) { return { status: 'failed', code: 'fetch_failed' }; }
    var floor = Math.max(opts.bundled.revision, cached && cached.instr ? cached.instr.revision : 0);
    var v = await validateRemote(text, { schema: opts.schema, siteId: opts.siteId, extVersion: opts.extVersion, floorRevision: floor, subtle: opts.subtle, publicKeyJwk: opts.publicKeyJwk });
    if (!v.ok) return { status: 'rejected', code: v.code, errors: v.errors };
    if (cached && cached.instr && cached.instr.revision === v.instr.revision && JSON.stringify(cached.instr) === JSON.stringify(v.instr)) {
      await opts.store.set(key, Object.assign({}, cached, { checkedAt: opts.now() }));
      return { status: 'unchanged' };
    }
    var etag = res.headers && res.headers.get ? res.headers.get('ETag') : null;
    await opts.store.set(key, { instr: v.instr, fetchedAt: opts.now(), checkedAt: opts.now(), etag: etag, integrityChecked: v.integrityChecked });
    return { status: 'updated', revision: v.instr.revision, version: v.instr.version };
  }

  return { validateRemote: validateRemote, choose: choose, refresh: refresh, withoutIntegrity: withoutIntegrity, MAX_BYTES: MAX_BYTES };
});
