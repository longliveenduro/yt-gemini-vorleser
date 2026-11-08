'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { collectFiles, createZip, crc32, resolveVersion, stampVersion } = require('../scripts/build.js');

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

test('resolveVersion: --version vor BUILD_VERSION vor manifest.json', () => {
  assert.equal(resolveVersion([], {}, '1.1.0'), '1.1.0');
  assert.equal(resolveVersion([], { BUILD_VERSION: '1.1.1' }, '1.1.0'), '1.1.1');
  assert.equal(resolveVersion(['--version', '2.0.0'], { BUILD_VERSION: '1.1.1' }, '1.1.0'), '2.0.0');
  assert.equal(resolveVersion([], { BUILD_VERSION: '' }, '1.1.0'), '1.1.0', 'leere Variable zählt nicht');
  assert.equal(resolveVersion([], undefined, '1.1.0'), '1.1.0');
});

test('resolveVersion: nur Versionen der Form X.Y.Z, und --version braucht einen Wert', () => {
  for (const bad of ['v1.1.1', '1.1', '1.1.1-rc1', '1.1.1.1', 'abc', '1.1.1; rm -rf /', '$(id)']) {
    assert.throws(() => resolveVersion([], { BUILD_VERSION: bad }, '1.1.0'), /Ungültige Version/, bad);
  }
  assert.throws(() => resolveVersion(['--version'], {}, '1.1.0'), /--version braucht einen Wert/);
  assert.throws(() => resolveVersion([], {}, 'kaputt'), /Ungültige Version/);
});

test('stampVersion ändert nur die Version und lässt alle anderen Bytes unverändert', () => {
  const original = fs.readFileSync(path.join(ROOT, 'manifest.json'));
  const manifest = JSON.parse(original.toString('utf8'));
  const stamped = stampVersion(original, '9.8.7');
  const parsed = JSON.parse(stamped.toString('utf8'));
  assert.equal(parsed.version, '9.8.7');
  assert.deepEqual({ ...parsed, version: manifest.version }, manifest, 'außer der Version ist alles gleich');
  assert.equal(stamped.toString('utf8'), original.toString('utf8').replace(`"version": "${manifest.version}"`, '"version": "9.8.7"'));
  // Felder, die „version“ im Namen tragen, bleiben unberührt
  assert.equal(parsed.minimum_chrome_version, manifest.minimum_chrome_version);
  // dieselbe Version noch einmal: unverändert
  assert.ok(stampVersion(original, manifest.version).equals(original));
});

test('stampVersion bricht ab, wenn die Datei kein "version" enthält', () => {
  assert.throws(() => stampVersion(Buffer.from('{"name": "x"}'), '1.0.0'), /konnte nicht gesetzt werden/);
});

/** Führt scripts/build.js aus und räumt das erzeugte ZIP wieder weg. */
function runBuild(args, env) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return res;
}

test('Kommandozeile: BUILD_VERSION bestimmt Dateiname und Version im ZIP – manifest.json im Repository bleibt unberührt', () => {
  const before = fs.readFileSync(path.join(ROOT, 'manifest.json'));
  const out = path.join(ROOT, 'dist', 'yt-gemini-vorleser-9.8.7.zip');
  fs.rmSync(out, { force: true });
  try {
    const res = runBuild([], { BUILD_VERSION: '9.8.7' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /yt-gemini-vorleser-9\.8\.7\.zip/);
    assert.match(res.stdout, /Version 9\.8\.7 statt \d+\.\d+\.\d+ aus manifest\.json/);
    const entries = readZip(fs.readFileSync(out));
    assert.equal(JSON.parse(entries.get('manifest.json').toString('utf8')).version, '9.8.7');
    // alle anderen Dateien sind unverändert im ZIP
    for (const name of collectFiles().filter((n) => n !== 'manifest.json')) {
      assert.ok(entries.get(name).equals(fs.readFileSync(path.join(ROOT, name))), `${name} weicht ab`);
    }
    assert.ok(fs.readFileSync(path.join(ROOT, 'manifest.json')).equals(before));
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('Kommandozeile: --version funktioniert wie BUILD_VERSION, ohne Angabe gilt die Version aus manifest.json', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  const stamped = path.join(ROOT, 'dist', 'yt-gemini-vorleser-9.8.6.zip');
  const plain = path.join(ROOT, 'dist', `yt-gemini-vorleser-${version}.zip`);
  const hadPlain = fs.existsSync(plain);
  try {
    assert.equal(runBuild(['--version', '9.8.6'], {}).status, 0);
    assert.equal(JSON.parse(readZip(fs.readFileSync(stamped)).get('manifest.json').toString('utf8')).version, '9.8.6');

    const res = runBuild([], {});
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /statt/);
    const manifestInZip = readZip(fs.readFileSync(plain)).get('manifest.json');
    assert.ok(manifestInZip.equals(fs.readFileSync(path.join(ROOT, 'manifest.json'))), 'ohne Angabe bleibt die manifest.json unverändert');
  } finally {
    fs.rmSync(stamped, { force: true });
    if (!hadPlain) fs.rmSync(plain, { force: true });
  }
});

test('Kommandozeile: eine ungültige Version erscheint als GitHub-Annotation „::error::“ mit Exit-Code 1 – ohne ZIP', () => {
  const zip = path.join(ROOT, 'dist', 'yt-gemini-vorleser-v1.1.zip');
  fs.rmSync(zip, { force: true }); // Altlast aus einem früheren Lauf soll das Ergebnis nicht verfälschen
  try {
    const res = runBuild([], { BUILD_VERSION: 'v1.1' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^::error::Ungültige Version „v1\.1“/);
    assert.equal(fs.existsSync(zip), false);
  } finally {
    fs.rmSync(zip, { force: true });
  }
});
