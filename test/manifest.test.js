'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

const sourceFiles = walk('src');
const jsFiles = sourceFiles.filter((f) => f.endsWith('.js'));
const htmlFiles = sourceFiles.filter((f) => f.endsWith('.html'));

test('Manifest V3, Version stimmt mit package.json überein', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.name && manifest.description);
  assert.ok(manifest.description.length <= 132, 'Chrome Web Store: Beschreibung höchstens 132 Zeichen');
});

test('alle im Manifest referenzierten Dateien existieren', () => {
  const refs = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const ref of refs) assert.ok(exists(ref), `fehlt: ${ref}`);
});

test('Icons haben die angegebene Größe', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.equal(buf.readUInt32BE(16), Number(size), `${file}: Breite`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${file}: Höhe`);
  }
});

test('Berechtigungen bleiben minimal', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['offscreen', 'scripting', 'storage']);
  assert.deepEqual([...manifest.host_permissions].sort(), ['https://texttospeech.googleapis.com/*', 'https://www.youtube.com/*']);
  assert.deepEqual(manifest.content_scripts.map((c) => c.matches), [['https://www.youtube.com/*']]);
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
});

test('Mindestversion von Chrome unterstützt runtime.getContexts und Offscreen-Dokumente', () => {
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
});

test('alle JavaScript-Dateien sind gültige klassische Skripte (keine ES-Module)', () => {
  assert.ok(jsFiles.length >= 10);
  for (const file of jsFiles) {
    const code = read(file);
    assert.doesNotMatch(code, /^\s*(import|export)\s/m, `${file}: ES-Modul-Syntax`);
    assert.doesNotThrow(() => new vm.Script(code, { filename: file }), `${file}: Syntaxfehler`);
  }
});

test('Content-Skripte stehen in der richtigen Reihenfolge (Abhängigkeiten zuerst)', () => {
  const list = manifest.content_scripts[0].js;
  const idx = (name) => list.indexOf(`src/lib/${name}.js`);
  for (const dep of ['text', 'settings', 'messages', 'youtube-dom']) assert.ok(idx(dep) < idx('runner'), `${dep} vor runner`);
  assert.ok(idx('overlay') < list.indexOf('src/content.js'));
  assert.ok(idx('runner') < list.indexOf('src/content.js'));
});

test('HTML-Seiten haben keine Inline-Skripte (MV3-CSP) und laden vorhandene Skripte in sinnvoller Reihenfolge', () => {
  assert.deepEqual(htmlFiles.sort(), ['src/offscreen/offscreen.html', 'src/options/options.html']);
  for (const file of htmlFiles) {
    const html = read(file);
    const tags = [...html.matchAll(/<script\b([^>]*)>/g)];
    assert.ok(tags.length > 0);
    for (const [, attrs] of tags) assert.match(attrs, /\bsrc="[^"]+"/, `${file}: Inline-Skript`);
    assert.doesNotMatch(html, /\son\w+=/i, `${file}: Inline-Event-Handler`);
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(exists(path.posix.join(path.posix.dirname(file), src)), `${file}: ${src} fehlt`);
    }
  }
  const order = (file) => [...read(file).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => path.posix.basename(m[1]));
  assert.deepEqual(order('src/offscreen/offscreen.html'), ['text.js', 'google-tts.js', 'speaker.js', 'offscreen.js']);
  assert.deepEqual(order('src/options/options.html'), ['settings.js', 'google-tts.js', 'options.js']);
});

test('der Service Worker lädt existierende Skripte und kennt den richtigen Offscreen-Pfad', () => {
  const code = read(manifest.background.service_worker);
  const imports = [...code.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(imports.length >= 2);
  for (const file of imports) assert.ok(exists(path.posix.join('src', file)), `importScripts: ${file} fehlt`);
  const offscreen = /OFFSCREEN_PATH\s*=\s*'([^']+)'/.exec(code)[1];
  assert.ok(exists(offscreen), `Offscreen-Seite fehlt: ${offscreen}`);
});

test('Sicherheit: kein eval, new Function oder innerHTML-Zuweisung im Erweiterungscode', () => {
  for (const file of jsFiles) {
    const code = read(file);
    assert.doesNotMatch(code, /\beval\s*\(/, `${file}: eval`);
    assert.doesNotMatch(code, /new\s+Function\s*\(/, `${file}: new Function`);
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\s*=/, `${file}: innerHTML`);
    assert.doesNotMatch(code, /insertAdjacentHTML/, `${file}: insertAdjacentHTML`);
  }
});

test('Sicherheit: der API-Key wird nirgends geloggt und nur an die Google-TTS-API gesendet', () => {
  for (const file of jsFiles) {
    for (const line of read(file).split('\n')) {
      if (/console\.\w+\(/.test(line)) assert.doesNotMatch(line, /apiKey/i, `${file}: ${line.trim()}`);
    }
  }
  const hosts = new Set();
  for (const file of jsFiles) for (const m of read(file).matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
  // YouTube (isWatchUrl/Hostprüfung) und die TTS-API – kein weiterer Zielserver
  assert.deepEqual([...hosts].filter((h) => !/^(www\.youtube\.com|texttospeech\.googleapis\.com|example\.com)$/.test(h)), []);
});
