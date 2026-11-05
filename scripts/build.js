#!/usr/bin/env node
/*
 * Packt die Erweiterung als ZIP (dist/yt-gemini-vorleser-<version>.zip) – nur die Dateien, die Chrome braucht.
 * Das ZIP kann entpackt und über chrome://extensions → „Entpackte Erweiterung laden“ installiert werden.
 * Der ZIP-Writer ist bewusst abhängigkeitsfrei (nur node:zlib) und erzeugt reproduzierbare Archive.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = ['manifest.json', 'src', 'icons'];
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01, feste Zeit → reproduzierbar

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Alle Dateien der Erweiterung als relative POSIX-Pfade, sortiert. */
function collectFiles(root = ROOT) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.posix.join(rel.split(path.sep).join('/'), name));
    } else {
      files.push(rel.split(path.sep).join('/'));
    }
  };
  for (const entry of INCLUDE) walk(entry);
  return files.sort();
}

/** Erzeugt ein ZIP (Deflate, UTF-8-Dateinamen) aus [{ name, data }]. */
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // benötigte Version
    local.writeUInt16LE(0x0800, 6); // Flag: Dateinamen in UTF-8
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(0, 10); // Zeit
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // erstellt unter Unix, Spezifikation 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // Dateirechte rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const out = path.join(ROOT, 'dist', `yt-gemini-vorleser-${manifest.version}.zip`);
  const files = collectFiles();
  const zip = createZip(files.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) })));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip);
  console.log(`Gebaut: ${path.relative(ROOT, out)} (${files.length} Dateien, ${zip.length} Bytes)`);
}

module.exports = { collectFiles, createZip, crc32 };

if (require.main === module) main();
