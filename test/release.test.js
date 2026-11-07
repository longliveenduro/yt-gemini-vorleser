'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { main, attachAssets, createClient, loadAssets, validateTag, ReleaseError } = require('../scripts/release.js');
const { createFakeGitHub } = require('./helpers/fake-github.js');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'octo/yt-gemini-vorleser';
const TOKEN = 'ghs_GEHEIMER_TOKEN';
const ZIP_BYTES = Buffer.from('PK-fake-zip-content');
const ZIP_NAME = 'yt-gemini-vorleser-1.2.0.zip';
const ASSETS = [
  { name: ZIP_NAME, data: ZIP_BYTES, contentType: 'application/zip' },
  { name: 'SHA256SUMS.txt', data: Buffer.from('abc  x.zip\n'), contentType: 'text/plain; charset=utf-8' },
];

function setup(fakeOptions) {
  const fake = createFakeGitHub(fakeOptions);
  const logs = [];
  const call = createClient({ fetchImpl: fake.fetchImpl, token: TOKEN });
  const run = (extra = {}) => attachAssets({ call, repo: REPO, tag: 'v1.2.0', sha: 'a'.repeat(40), assets: ASSETS, log: (l) => logs.push(l), ...extra });
  return { fake, logs, run };
}

/** Ein Mini-Projekt mit manifest.json und gebautem ZIP in dist/. */
function makeProject(version = '1.2.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgr-release-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version }));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', `yt-gemini-vorleser-${version}.zip`), ZIP_BYTES);
  return dir;
}

test('validateTag: v1.2.3 und 1.2.3 passen zur Version, alles andere nicht', () => {
  assert.doesNotThrow(() => validateTag('v1.2.0', '1.2.0'));
  assert.doesNotThrow(() => validateTag('1.2.0', '1.2.0'));
  assert.throws(() => validateTag('v1.2', '1.2.0'), /Ungültiger Tag/);
  assert.throws(() => validateTag('release-1', '1.2.0'), /Ungültiger Tag/);
  assert.throws(() => validateTag('', '1.2.0'), /Ungültiger Tag/);
  assert.throws(() => validateTag('v1.2.1', '1.2.0'), (e) => e instanceof ReleaseError && /passt nicht zur Version 1\.2\.0/.test(e.message) && /manifest\.json/.test(e.hint));
});

test('loadAssets: ZIP und SHA256SUMS.txt im Format von sha256sum', () => {
  const dir = makeProject();
  const assets = loadAssets(dir, '1.2.0');
  assert.deepEqual(assets.map((a) => a.name), [ZIP_NAME, 'SHA256SUMS.txt']);
  assert.equal(assets[0].contentType, 'application/zip');
  assert.ok(assets[0].data.equals(ZIP_BYTES));
  const hash = crypto.createHash('sha256').update(ZIP_BYTES).digest('hex');
  assert.equal(assets[1].data.toString('utf8'), `${hash}  ${ZIP_NAME}\n`);
  assert.match(assets[1].data.toString('utf8'), /^[0-9a-f]{64} {2}yt-gemini-vorleser-1\.2\.0\.zip\n$/);
});

test('loadAssets: fehlt das ZIP, kommt ein Hinweis auf „npm run build“', () => {
  const dir = makeProject();
  fs.rmSync(path.join(dir, 'dist'), { recursive: true });
  assert.throws(() => loadAssets(dir, '1.2.0'), (e) => e instanceof ReleaseError && /fehlt/.test(e.message) && /npm run build/.test(e.hint));
});

test('kein Release zum Tag → Entwurf mit Release-Notes anlegen und beide Dateien hochladen', async () => {
  const { fake, run } = setup();
  const result = await run();
  assert.equal(result.created, true);
  assert.deepEqual(result.uploaded, [ZIP_NAME, 'SHA256SUMS.txt']);

  const create = fake.state.calls.find((c) => c.method === 'POST' && c.host === 'api.github.com');
  const body = JSON.parse(create.body);
  assert.equal(body.tag_name, 'v1.2.0');
  assert.equal(body.draft, true, 'als ENTWURF anlegen (nötig für unveränderliche Releases)');
  assert.equal(body.generate_release_notes, true);
  assert.equal(body.target_commitish, 'a'.repeat(40));
  assert.match(body.body, /Entpackte Erweiterung laden/);

  assert.equal(fake.state.uploads.length, 2);
  assert.ok(fake.state.uploads[0].data.equals(ZIP_BYTES));
  assert.equal(fake.state.uploads[0].contentType, 'application/zip');
  assert.equal(fake.state.uploads[1].contentType, 'text/plain; charset=utf-8');
  assert.equal(result.release.draft, true);
});

test('es gibt schon einen Entwurf → kein neuer Entwurf, Dateien kommen an den vorhandenen', async () => {
  const { fake, run } = setup({ releases: [{ id: 7, tag_name: 'v1.2.0', draft: true, html_url: 'https://x/7' }] });
  const result = await run();
  assert.equal(result.created, false);
  assert.equal(fake.state.calls.filter((c) => c.method === 'POST' && c.host === 'api.github.com').length, 0);
  assert.deepEqual(fake.state.uploads.map((u) => u.releaseId), [7, 7]);
});

test('Entwurf mit veralteter Datei (Tag neu gesetzt): die Datei wird ersetzt, nicht übersprungen', async () => {
  const { fake, run } = setup({ releases: [{ id: 7, tag_name: 'v1.2.0', draft: true, assets: [{ id: 41, name: ZIP_NAME }] }] });
  const result = await run();
  assert.deepEqual(fake.state.deleted, [41]);
  assert.deepEqual(result.uploaded, [ZIP_NAME, 'SHA256SUMS.txt']);
  const onGitHub = fake.state.releases.find((r) => r.id === 7).assets;
  assert.deepEqual(onGitHub.map((a) => a.name), [ZIP_NAME, 'SHA256SUMS.txt']);
  assert.ok(!onGitHub.some((a) => a.id === 41), 'die alte Datei ist weg');
});

test('veröffentlichtes Release ohne Dateien (Veröffentlichen in der Oberfläche) → Dateien werden nachträglich angehängt', async () => {
  const { fake, run } = setup({ releases: [{ id: 9, tag_name: 'v1.2.0', draft: false }] });
  const result = await run();
  assert.equal(result.created, false);
  assert.deepEqual(result.uploaded, [ZIP_NAME, 'SHA256SUMS.txt']);
  assert.equal(fake.state.calls.filter((c) => c.method === 'POST' && c.host === 'api.github.com').length, 0, 'kein zweites Release');
});

test('veröffentlichtes Release mit beiden Dateien → nichts passiert (idempotent)', async () => {
  const { fake, logs, run } = setup({
    releases: [{ id: 9, tag_name: 'v1.2.0', assets: [{ id: 1, name: ZIP_NAME }, { id: 2, name: 'SHA256SUMS.txt' }] }],
  });
  const result = await run();
  assert.deepEqual(result.uploaded, []);
  assert.deepEqual(result.skipped, [ZIP_NAME, 'SHA256SUMS.txt']);
  assert.equal(fake.state.uploads.length + fake.state.deleted.length, 0);
  assert.ok(logs.some((l) => /übersprungen/.test(l)));
});

test('veröffentlichtes Release: mit replace werden vorhandene Dateien ersetzt', async () => {
  const { fake, run } = setup({ releases: [{ id: 9, tag_name: 'v1.2.0', assets: [{ id: 1, name: ZIP_NAME }] }] });
  const result = await run({ replace: true });
  assert.deepEqual(fake.state.deleted, [1]);
  assert.deepEqual(result.uploaded, [ZIP_NAME, 'SHA256SUMS.txt']);
});

test('UNVERÄNDERLICHES Release: verständlicher Fehler mit dem richtigen Weg (Tag pushen → Entwurf → veröffentlichen)', async () => {
  const { run } = setup({ releases: [{ id: 9, tag_name: 'v1.2.0', immutable: true }] });
  await assert.rejects(run(), (e) => {
    assert.ok(e instanceof ReleaseError);
    assert.match(e.message, /unveränderlich/);
    assert.match(e.hint, /immutable releases/);
    assert.match(e.hint, /git tag vX\.Y\.Z/);
    assert.match(e.hint, /Entwurf/);
    return true;
  });
});

test('Ersetzen in einem unveränderlichen Release scheitert mit derselben Anleitung', async () => {
  const { run } = setup({ releases: [{ id: 9, tag_name: 'v1.2.0', immutable: true, assets: [{ id: 1, name: ZIP_NAME }] }] });
  await assert.rejects(run({ replace: true }), (e) => /unveränderlich/.test(e.message));
});

test('paralleler Lauf war schneller (422 already_exists) → kein Fehler', async () => {
  let hits = 0;
  const { run } = setup({
    releases: [{ id: 9, tag_name: 'v1.2.0' }],
    onRequest: (method, u) => {
      if (u.hostname === 'uploads.github.com' && u.searchParams.get('name') === ZIP_NAME && hits++ === 0) {
        return { status: 422, data: { message: 'Validation Failed', errors: [{ code: 'already_exists' }] } };
      }
      return undefined;
    },
  });
  const result = await run();
  assert.deepEqual(result.skipped, [ZIP_NAME]);
  assert.deepEqual(result.uploaded, ['SHA256SUMS.txt']);
});

test('das Release wird auch auf der zweiten Seite der Liste gefunden', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, tag_name: `v0.0.${i}` }));
  const { fake, run } = setup({ releases: [...filler, { id: 9, tag_name: 'v1.2.0' }] });
  const result = await run();
  assert.equal(result.release.id, 9);
  assert.equal(fake.state.calls.filter((c) => c.method === 'GET').length, 2);
});

test('Fehler der API werden mit Status und Meldung gemeldet – ohne den Token preiszugeben', async () => {
  const { run } = setup({ onRequest: (method) => (method === 'GET' ? { status: 500, data: { message: 'Server kaputt' } } : undefined) });
  await assert.rejects(run(), (e) => {
    assert.match(e.message, /HTTP 500/);
    assert.match(e.message, /Server kaputt/);
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });

  const denied = setup({ onRequest: (method) => (method === 'POST' ? { status: 403, data: { message: 'Resource not accessible by integration' } } : undefined) });
  await assert.rejects(denied.run(), /Entwurf konnte nicht angelegt werden \(HTTP 403\): Resource not accessible/);
});

test('jede Anfrage trägt den Token als Bearer, API-Version und User-Agent; der Token steht in keiner URL', async () => {
  const { fake, run } = setup();
  await run();
  assert.ok(fake.state.calls.length >= 4);
  for (const c of fake.state.calls) {
    assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(c.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(c.headers['User-Agent']);
    assert.ok(!c.search.includes(TOKEN) && !c.path.includes(TOKEN));
  }
  const upload = fake.state.calls.find((c) => c.host === 'uploads.github.com');
  assert.match(upload.search, /^\?name=yt-gemini-vorleser-1\.2\.0\.zip$/);
});

test('main: kompletter Lauf mit Mini-Projekt – Entwurf, Zusammenfassung im Job-Protokoll', async () => {
  const dir = makeProject();
  const summary = path.join(dir, 'summary.md');
  const fake = createFakeGitHub();
  const logs = [];
  const result = await main(
    { RELEASE_TAG: 'v1.2.0', GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: summary },
    { root: dir, fetchImpl: fake.fetchImpl, sha: 'b'.repeat(40), tagSha: 'b'.repeat(40), log: (l) => logs.push(l) },
  );
  assert.equal(result.created, true);
  assert.equal(fake.state.uploads.length, 2);
  const text = fs.readFileSync(summary, 'utf8');
  assert.match(text, /### Release v1\.2\.0/);
  assert.match(text, /Entwurf angelegt/);
  assert.match(text, /yt-gemini-vorleser-1\.2\.0\.zip/);
  assert.match(text, /releases\/tag\/untagged-/);
  assert.ok(!logs.some((l) => l.startsWith('::warning::')));
});

test('main: zeigt der Tag auf einen anderen Stand als gebaut wird, gibt es eine Warnung', async () => {
  const dir = makeProject();
  const logs = [];
  await main(
    { RELEASE_TAG: 'v1.2.0', GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN },
    { root: dir, fetchImpl: createFakeGitHub().fetchImpl, sha: 'b'.repeat(40), tagSha: 'c'.repeat(40), log: (l) => logs.push(l) },
  );
  assert.ok(logs.some((l) => l.startsWith('::warning::') && /entspricht nicht dem getaggten Stand/.test(l)));
});

test('main: Version und Tag passen nicht → Fehler, bevor irgendetwas hochgeladen wird', async () => {
  const dir = makeProject('1.2.0');
  const fake = createFakeGitHub();
  await assert.rejects(
    main({ RELEASE_TAG: 'v1.3.0', GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN }, { root: dir, fetchImpl: fake.fetchImpl, sha: 'a'.repeat(40), tagSha: null }),
    /passt nicht zur Version/,
  );
  assert.equal(fake.state.calls.length, 0);
});

test('main: RELEASE_REPLACE=true ersetzt Dateien eines veröffentlichten Releases', async () => {
  const dir = makeProject();
  const fake = createFakeGitHub({ releases: [{ id: 9, tag_name: 'v1.2.0', html_url: 'https://x/9', assets: [{ id: 3, name: ZIP_NAME }] }] });
  const result = await main(
    { RELEASE_TAG: 'v1.2.0', GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN, RELEASE_REPLACE: 'true' },
    { root: dir, fetchImpl: fake.fetchImpl, sha: 'a'.repeat(40), tagSha: null, log() {} },
  );
  assert.deepEqual(fake.state.deleted, [3]);
  assert.ok(result.uploaded.includes(ZIP_NAME));
});

test('main: fehlende Umgebungsvariablen werden benannt', async () => {
  await assert.rejects(main({}, {}), /RELEASE_TAG, GITHUB_REPOSITORY und GITHUB_TOKEN/);
});

test('Kommandozeile: Fehler erscheinen als GitHub-Annotation „::error::“ mit Exit-Code 1', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release.js')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^::error::RELEASE_TAG, GITHUB_REPOSITORY und GITHUB_TOKEN/);
});

// ---- Workflow-Datei (statische Prüfungen) ----------------------------------------------------------

const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('Workflow: startet bei Versions-Tags, bei veröffentlichten Releases und manuell', () => {
  assert.match(workflow, /push:\s*\n\s*tags: \['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\]/);
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tag:\s*\n\s*description:[^\n]*\n\s*required: true/);
});

test('Workflow: minimale Rechte (nur contents: write) und ausschließlich offizielle Actions', () => {
  assert.match(workflow, /\npermissions:\n  contents: write\n/);
  assert.doesNotMatch(workflow, /write-all|pull-requests: write|id-token: write/);
  const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^actions\/[a-z-]+@v\d+$/, `nur offizielle, versionierte Actions: ${u}`);
});

test('Workflow: erst Tests und Build, dann Anhängen; mit Zeitlimit, Token und Tag', () => {
  const idx = (needle) => workflow.indexOf(needle);
  assert.ok(idx('npm ci') > 0);
  assert.ok(idx('npm ci') < idx('npm test'));
  assert.ok(idx('npm test') < idx('npm run build'));
  assert.ok(idx('npm run build') < idx('node scripts/release.js'));
  assert.match(workflow, /timeout-minutes: \d+/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.tag \|\| github\.ref_name \}\}/);
  assert.match(workflow, /RELEASE_REPLACE: \$\{\{ inputs\.replace \}\}/);
});

test('Workflow: ein Entwurf, an dem das ZIP schon hängt, löst beim Veröffentlichen keinen zweiten Lauf aus', () => {
  assert.match(workflow, /if: \$\{\{ github\.event_name != 'release' \|\| !contains\(join\(github\.event\.release\.assets\.\*\.name, ','\), 'yt-gemini-vorleser-'\) \}\}/);
});

test('Workflow: Läufe zum selben Tag laufen nacheinander', () => {
  assert.match(workflow, /concurrency:\s*\n\s*group: release-\$\{\{ inputs\.tag \|\| github\.ref_name \}\}\s*\n\s*cancel-in-progress: false/);
});

test('Workflow: der ZIP-Name im Workflow passt zu dem, den scripts/build.js erzeugt', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
  const release = fs.readFileSync(path.join(ROOT, 'scripts', 'release.js'), 'utf8');
  assert.match(build, /yt-gemini-vorleser-\$\{manifest\.version\}\.zip/);
  assert.match(release, /yt-gemini-vorleser-\$\{version\}\.zip/);
  assert.match(workflow, /'yt-gemini-vorleser-'/);
});
