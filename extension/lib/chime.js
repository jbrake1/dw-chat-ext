/* DW Chat Integration: the "finished" chime. A soft 2-3 note WebAudio tune (no audio file), a different gentle tone on
 * error, and a remembered mute switch (localStorage key dw_ext_mute, shared with the editor's own copy of this code). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.DWX = root.DWX || {}; root.DWX.chime = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (win) {
  'use strict';
  var KEY = 'dw_ext_mute', ctx = null;
  // [frequency Hz, start offset s, length s, peak volume]. C5-E5-G5 rising = done; E5-G5 = done with no files; G4-Eb4 falling = error.
  var TUNES = {
    ok: [[523.25, 0, 0.7, 0.10], [659.25, 0.17, 0.7, 0.10], [783.99, 0.34, 1.0, 0.10]],
    done: [[659.25, 0, 0.6, 0.08], [783.99, 0.18, 0.8, 0.08]],
    error: [[392.0, 0, 0.7, 0.09], [311.13, 0.24, 1.0, 0.09]]
  };
  function store() { try { return win && win.localStorage; } catch (e) { return null; } }
  function muted() { var s = store(); try { return !!s && s.getItem(KEY) === '1'; } catch (e) { return false; } }
  function setMuted(on) { var s = store(); try { if (!s) return; if (on) s.setItem(KEY, '1'); else s.removeItem(KEY); } catch (e) {} }
  function context() {
    if (ctx) return ctx;
    var C = win && (win.AudioContext || win.webkitAudioContext);
    if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }
  // Call from a click or key press (a send), so the browser lets later sounds play.
  function unlock() {
    var c = context();
    try { if (c && c.state === 'suspended' && c.resume) { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } } catch (e) {}
    return !!c;
  }
  function play(kind) {
    if (muted()) return false;
    var tune = TUNES[kind]; if (!tune) return false;
    var c = context(); if (!c) return false;
    try {
      if (c.state === 'suspended' && c.resume) { var p = c.resume(); if (p && p.catch) p.catch(function () {}); }
      var t0 = c.currentTime + 0.03;
      tune.forEach(function (n) {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(n[0], t0 + n[1]);
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.linearRampToValueAtTime(n[3], t0 + n[1] + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
        o.connect(g); g.connect(c.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + n[2] + 0.05);
      });
      return true;
    } catch (e) { return false; }
  }
  return { KEY: KEY, TUNES: TUNES, muted: muted, setMuted: setMuted, unlock: unlock, play: play };
});
