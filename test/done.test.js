const test = require('node:test'), assert = require('node:assert');
const { DoneDetector } = require('../extension/lib/done.js');

function fake() {
  const c = { t: 0, timers: [] };
  c.now = () => c.t;
  c.setTimeout = (f, ms) => { const id = c.timers.length + 1; c.timers.push({ id, at: c.t + ms, f, live: true }); return id; };
  c.clearTimeout = (id) => { const t = c.timers.find((x) => x.id === id); if (t) t.live = false; };
  c.advance = (ms) => { const end = c.t + ms; for (;;) { const nx = c.timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!nx) break; c.t = nx.at; nx.live = false; nx.f(); } c.t = end; };
  c.live = () => c.timers.filter((x) => x.live).length;
  return c;
}
const RULE = { all: [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 1500 }] };
const st = (o) => Object.assign({ present: { stop: false }, newMessage: true, signature: 'a', nonEmpty: true }, o);

test('does not finish while the stop button is present', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st({ present: { stop: true } })); c.advance(10000);
  assert.equal(done, 0); assert.equal(c.live(), 0, 'no timer armed while a non-time condition fails');
});

test('finishes only after stop is gone AND text stable for N ms', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st({ present: { stop: true }, signature: 'a' }));
  c.advance(800); d.update(st({ present: { stop: true }, signature: 'ab' }));   // text still changing at t=800
  c.advance(200); d.update(st({ present: { stop: false }, signature: 'ab' }));  // stop gone at t=1000
  c.advance(1299); assert.equal(done, 0);                                        // t=2299: stable only 1499ms
  c.advance(1); assert.equal(done, 1);                                           // t=2300
});

test('any text change restarts the stability window', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st({ signature: 'a' })); c.advance(1000);
  d.update(st({ signature: 'ab' })); c.advance(1000); assert.equal(done, 0);
  d.update(st({ signature: 'abc' })); c.advance(1499); assert.equal(done, 0);
  c.advance(1); assert.equal(done, 1);
});

test('a stop button reappearing cancels the pending timer (no polling, one timer at most)', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st()); assert.equal(c.live(), 1);
  c.advance(1000); d.update(st({ present: { stop: true } })); assert.equal(c.live(), 0);
  c.advance(5000); assert.equal(done, 0);
  d.update(st({ present: { stop: false } })); c.advance(1500); assert.equal(done, 1);
});

test('requires a new assistant message and non-empty content', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st({ newMessage: false })); c.advance(5000); assert.equal(done, 0);
  d.update(st({ nonEmpty: false })); c.advance(5000); assert.equal(done, 0);
  d.update(st()); c.advance(1500); assert.equal(done, 1);
});

test('fires exactly once and ignores later updates', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector(RULE, { ...c, onDone: () => done++ });
  d.update(st()); c.advance(1500); d.update(st({ signature: 'zzz' })); c.advance(9999);
  assert.equal(done, 1);
});

test('minElapsedMs and cancel()', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector({ all: [{ type: 'newMessage' }, { type: 'minElapsedMs', ms: 4000 }] }, { ...c, onDone: () => done++ });
  d.update(st()); c.advance(3999); assert.equal(done, 0); c.advance(1); assert.equal(done, 1);
  const c2 = fake(); let n = 0;
  const d2 = new DoneDetector(RULE, { ...c2, onDone: () => n++ });
  d2.update(st()); d2.cancel(); c2.advance(9999); assert.equal(n, 0);
});

test('unknown condition types never complete', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector({ all: [{ type: 'bogus' }] }, { ...c, onDone: () => done++ });
  d.update(st()); c.advance(99999); assert.equal(done, 0);
});

test('present condition', () => {
  const c = fake(); let done = 0;
  const d = new DoneDetector({ all: [{ type: 'present', step: 'stop' }] }, { ...c, onDone: () => done++ });
  d.update(st({ present: { stop: false } })); assert.equal(done, 0);
  d.update(st({ present: { stop: true } })); assert.equal(done, 1);
});
