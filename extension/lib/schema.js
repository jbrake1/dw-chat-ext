/* Minimal JSON-Schema (draft-07 subset) validator, so the extension needs no bundled library.
 * Supports: type, enum, const, required, properties, additionalProperties(false|schema), items, minItems, maxItems,
 * minLength, maxLength, minimum, maximum, pattern, oneOf, anyOf, $ref ("#/definitions/x"). Unit tests cross-check
 * it against Ajv on the real schema. Returns {ok, errors:[path: message]}. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v; }
  function typeOk(v, t) { var a = typeOf(v); return a === t || (t === 'number' && a === 'integer'); }

  function validate(schema, data) {
    var errors = [];
    var rootSchema = schema;
    function deref(s) {
      while (s && s.$ref) {
        var parts = s.$ref.replace(/^#\//, '').split('/'); var cur = rootSchema;
        for (var i = 0; i < parts.length; i++) cur = cur && cur[parts[i]];
        s = cur;
      }
      return s;
    }
    function walk(s, v, path) {
      s = deref(s);
      if (!s || s === true) return true;
      var before = errors.length;
      function err(m) { errors.push((path || '$') + ': ' + m); }
      if (s.type) {
        var types = Array.isArray(s.type) ? s.type : [s.type];
        if (!types.some(function (t) { return typeOk(v, t); })) { err('expected ' + types.join('|') + ', got ' + typeOf(v)); return false; }
      }
      if (s.enum && !s.enum.some(function (e) { return JSON.stringify(e) === JSON.stringify(v); })) err('not in enum');
      if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) err('must equal ' + JSON.stringify(s.const));
      if (typeof v === 'string') {
        if (s.minLength != null && v.length < s.minLength) err('too short');
        if (s.maxLength != null && v.length > s.maxLength) err('too long');
        if (s.pattern && !new RegExp(s.pattern).test(v)) err('does not match pattern');
      }
      if (typeof v === 'number') {
        if (s.minimum != null && v < s.minimum) err('below minimum');
        if (s.maximum != null && v > s.maximum) err('above maximum');
      }
      if (Array.isArray(v)) {
        if (s.minItems != null && v.length < s.minItems) err('too few items');
        if (s.maxItems != null && v.length > s.maxItems) err('too many items');
        if (s.items) v.forEach(function (x, i) { walk(s.items, x, path + '[' + i + ']'); });
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        (s.required || []).forEach(function (k) { if (!(k in v)) err('missing "' + k + '"'); });
        var props = s.properties || {};
        Object.keys(v).forEach(function (k) {
          if (props[k]) walk(props[k], v[k], (path || '$') + '.' + k);
          else if (s.additionalProperties === false) err('unexpected property "' + k + '"');
          else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, v[k], (path || '$') + '.' + k);
        });
      }
      if (s.oneOf) {
        var n = s.oneOf.filter(function (sub) { var save = errors.length; var ok = walk(sub, v, path); errors.length = save; return ok; }).length;
        if (n !== 1) err('must match exactly one alternative (matched ' + n + ')');
      }
      if (s.anyOf) {
        var any = s.anyOf.some(function (sub) { var save = errors.length; var ok = walk(sub, v, path); errors.length = save; return ok; });
        if (!any) err('must match at least one alternative');
      }
      return errors.length === before;
    }
    walk(schema, data, '$');
    return { ok: errors.length === 0, errors: errors };
  }
  return { validateSchema: validate };
});
