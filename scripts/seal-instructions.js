#!/usr/bin/env node
/* Usage: node scripts/seal-instructions.js in.json out.json [ed25519-private-key.pem]
 * Computes integrity.hash = sha256(canonical JSON without "integrity") and, if a key is given, integrity.sig
 * (Ed25519 over the hash string, base64url). Run this before publishing a site instructions file. */
const fs = require('fs'), crypto = require('crypto');
const { canonical } = require('../extension/lib/util.js');
const [, , inp, outp, keyPath] = process.argv;
if (!inp || !outp) { console.error('usage: seal-instructions.js in.json out.json [private.pem]'); process.exit(2); }
const o = JSON.parse(fs.readFileSync(inp, 'utf8'));
const body = Object.assign({}, o); delete body.integrity;
const hash = crypto.createHash('sha256').update(canonical(body)).digest('hex');
o.integrity = { alg: keyPath ? 'sha256+ed25519' : 'sha256', hash, sig: '', keyId: (o.integrity && o.integrity.keyId) || '' };
if (keyPath) o.integrity.sig = crypto.sign(null, Buffer.from(hash), crypto.createPrivateKey(fs.readFileSync(keyPath))).toString('base64url');
fs.writeFileSync(outp, JSON.stringify(o, null, 2) + '\n');
console.log('sealed', outp, 'hash', hash);
