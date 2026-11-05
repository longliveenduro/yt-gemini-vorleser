'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { collectFiles, createZip, crc32 } = require('../scripts/build.js');

const ROOT = path.resolve(__dirname, '..');

/** Liest ein ZIP über das zentrale Verzeichnis (unabhängig vom Writer geprüft). */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'Ende-des-Verzeichnisses fehlt');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const csize = buf.readUInt32LE(offset + 20);
    const usize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(data.length, usize, `${name}: Größe`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    entries.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('collectFiles enthält Manifest, Quellcode und Icons – aber keine Tests oder Abhängigkeiten', () => {
  const files = collectFiles();
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.includes('src/background.js'));
  assert.ok(files.includes('src/options/options.html'));
  assert.ok(files.includes('icons/icon128.png'));
  assert.ok(!files.some((f) => /^(test|node_modules|dist|\.github|scripts)\//.test(f)));
  assert.deepEqual(files, [...files].sort());
});

test('createZip erzeugt ein gültiges Archiv, dessen Inhalt Byte für Byte den Quelldateien entspricht', () => {
  const files = collectFiles();
  const zip = createZip(files.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) })));
  const entries = readZip(zip);
  assert.deepEqual([...entries.keys()], files);
  for (const name of files) assert.ok(entries.get(name).equals(fs.readFileSync(path.join(ROOT, name))), `${name} weicht ab`);
});

test('createZip ist reproduzierbar und kommt mit Umlauten im Dateinamen und leeren Dateien zurecht', () => {
  const input = [{ name: 'ä/ü.txt', data: Buffer.from('Grüße') }, { name: 'leer.txt', data: Buffer.alloc(0) }];
  assert.ok(createZip(input).equals(createZip(input)));
  const entries = readZip(createZip(input));
  assert.equal(entries.get('ä/ü.txt').toString('utf8'), 'Grüße');
  assert.equal(entries.get('leer.txt').length, 0);
});

test('crc32 stimmt mit dem bekannten Prüfwert überein', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
