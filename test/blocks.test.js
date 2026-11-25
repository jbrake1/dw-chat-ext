// v0.1.4: the extension reads each reply code block with the text just above it (where the model writes "File: /path").
const test = require('node:test'), assert = require('node:assert');
const I = require('../extension/lib/interpreter.js');
const { dom, bundled } = require('./helpers.js');

test('readBlocks: code of every <pre> in the newest reply, with the "File:" text above it, no Copy-code header', () => {
  const w = dom('<div data-message-author-role="assistant"><div class="markdown"><p>old</p></div></div>' +
    '<div data-message-author-role="assistant"><div class="markdown"><p>Here you go.</p><p>File: <code>/index.html</code></p>' +
    '<pre><div>html</div><button>Copy code</button><code class="language-html">&lt;html&gt;&lt;body&gt;&lt;h1&gt;New&lt;/h1&gt;&lt;/body&gt;&lt;/html&gt;\n</code></pre>' +
    '<p>File: /css/site.css</p><pre><div>css</div><code class="language-css">h1{color:red}\n</code></pre><p>Done.</p></div></div>');
  const instr = bundled('chatgpt');
  const b = I.readBlocks(w, w.document, instr, 1);
  assert.equal(b.length, 2);
  assert.equal(b[0].lang, 'html'); assert.match(b[0].label, /File: \/index\.html$/); assert.equal(b[0].code, '<html><body><h1>New</h1></body></html>\n');
  assert.equal(b[1].lang, 'css'); assert.equal(b[1].label, 'File: /css/site.css'); assert.equal(b[1].code, 'h1{color:red}\n');
  assert.deepEqual(I.readBlocks(w, w.document, instr, 2), []);   // no new message yet
});
