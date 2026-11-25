const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const bundled = () => JSON.parse(fs.readFileSync(path.join(root, 'extension/instructions/chatgpt.json'), 'utf8'));
const schema = () => JSON.parse(fs.readFileSync(path.join(root, 'extension/schema/site-instructions.schema.json'), 'utf8'));

// Minimal DataTransfer / ClipboardEvent / DragEvent for jsdom (it has none of them).
function polyfill(win) {
  win.DataTransfer = class { constructor() { this._d = {}; this.files = []; this.items = { add: (f) => this.files.push(f) }; } setData(t, v) { this._d[t] = v; } getData(t) { return this._d[t] || ''; } };
  const mk = (name) => class extends win.Event { constructor(type, init = {}) { super(type, init); this.clipboardData = init.clipboardData; this.dataTransfer = init.dataTransfer; } };
  win.ClipboardEvent = mk('ClipboardEvent'); win.DragEvent = mk('DragEvent');
  return win;
}
function dom(html, opts = {}) {
  const d = new JSDOM(html, Object.assign({ url: 'https://chatgpt.com/', pretendToBeVisual: true }, opts));
  return polyfill(d.window);
}
async function mockChat(query = '') {
  const html = fs.readFileSync(path.join(root, 'mock/chatgpt.html'), 'utf8');
  const d = new JSDOM(html, { url: 'https://chatgpt.com/' + query, runScripts: 'dangerously', pretendToBeVisual: true });
  const win = polyfill(d.window);
  return win;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { bundled, schema, dom, mockChat, sleep, root };

// v0.1.6: Gemini (mock/gemini.html is a best-effort mimic of gemini.google.com; live selectors are unverified).
const geminiInstr = () => JSON.parse(fs.readFileSync(path.join(root, 'extension/instructions/gemini.json'), 'utf8'));
async function mockGemini(query = '') {
  const html = fs.readFileSync(path.join(root, 'mock/gemini.html'), 'utf8');
  const d = new JSDOM(html, { url: 'https://gemini.google.com/app' + query, runScripts: 'dangerously', pretendToBeVisual: true });
  return polyfill(d.window);
}
module.exports.geminiInstr = geminiInstr;
module.exports.mockGemini = mockGemini;
module.exports.polyfill = polyfill;
