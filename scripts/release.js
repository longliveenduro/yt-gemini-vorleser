#!/usr/bin/env node
/*
 * Hängt das gebaute ZIP (dist/yt-gemini-vorleser-<version>.zip) und eine Prüfsummen-Datei an ein GitHub-Release.
 * Wird vom Workflow .github/workflows/release.yml nach „npm test“ und „npm run build“ aufgerufen.
 *
 *  - Gibt es zum Tag noch kein Release, wird ein ENTWURF mit automatischen Release-Notes angelegt.
 *    Du prüfst ihn und klickst auf „Publish release“. Dieser Weg funktioniert auch mit „immutable releases“,
 *    bei denen sich nach dem Veröffentlichen keine Dateien mehr anhängen lassen.
 *  - Gibt es das Release schon (Entwurf oder veröffentlicht), werden die Dateien angehängt. Dateien, die schon
 *    dranhängen, bleiben unverändert – außer beim Entwurf oder mit RELEASE_REPLACE=true.
 *
 * Nur node:-Module und das eingebaute fetch (Node ≥ 20). Umgebung: GITHUB_TOKEN, GITHUB_REPOSITORY, RELEASE_TAG,
 * optional RELEASE_REPLACE=true und GITHUB_STEP_SUMMARY.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

const INTRO = [
  '**Installation (Ubuntu, Chrome/Chromium ab 116):** ZIP entpacken, `chrome://extensions` öffnen, Entwicklermodus einschalten,',
  '„Entpackte Erweiterung laden“ wählen und den entpackten Ordner auswählen. Danach in den Optionen den Google-TTS-API-Key eintragen.',
  'Prüfsumme: `sha256sum -c SHA256SUMS.txt`.',
  '',
].join(' ');

const IMMUTABLE_HINT = [
  'Dieses Release ist unveränderlich („immutable releases“): Nach dem Veröffentlichen lassen sich keine Dateien mehr anhängen oder ersetzen.',
  'So geht es künftig: Version erhöhen und committen, dann den Tag pushen (git tag vX.Y.Z && git push origin vX.Y.Z).',
  'Der Workflow legt daraufhin einen Entwurf mit dem ZIP an. Erst diesen Entwurf veröffentlichen.',
  'Für dieses Release hilft nur eine neue Version.',
].join('\n');

class ReleaseError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ReleaseError';
    this.hint = hint || '';
  }
}

/** Tag wie „v1.2.3“ (oder „1.2.3“) muss zur Version in manifest.json passen, sonst stimmt der ZIP-Name nicht. */
function validateTag(tag, version) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(String(tag || ''));
  if (!m) throw new ReleaseError(`Ungültiger Tag „${tag}“: erwartet wird z. B. v1.2.3.`);
  if (m[1] !== version) {
    throw new ReleaseError(
      `Der Tag ${tag} passt nicht zur Version ${version} in manifest.json.`,
      'Version in manifest.json und package.json erhöhen, committen und dann taggen. Der Tag muss mit der Version übereinstimmen.',
    );
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Das gebaute ZIP plus SHA256SUMS.txt (Format von `sha256sum`, prüfbar mit `sha256sum -c`). */
function loadAssets(root, version) {
  const zipName = `yt-gemini-vorleser-${version}.zip`;
  const zipPath = path.join(root, 'dist', zipName);
  if (!fs.existsSync(zipPath)) {
    throw new ReleaseError(`${path.join('dist', zipName)} fehlt.`, 'Zuerst „npm run build“ ausführen.');
  }
  const zip = fs.readFileSync(zipPath);
  const sums = Buffer.from(`${sha256(zip)}  ${zipName}\n`, 'utf8');
  return [
    { name: zipName, data: zip, contentType: 'application/zip' },
    { name: 'SHA256SUMS.txt', data: sums, contentType: 'text/plain; charset=utf-8' },
  ];
}

/** Kleiner Client für die GitHub-API; fetch wird übergeben (testbar ohne Netzwerk). */
function createClient({ fetchImpl, token }) {
  return async function call(method, url, { json, body, contentType } = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'yt-gemini-vorleser-release',
    };
    let payload;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    } else if (body !== undefined) {
      headers['Content-Type'] = contentType;
      payload = body;
    }
    const res = await fetchImpl(url, { method, headers, body: payload });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    return { status: res.status, ok: res.ok, data, text };
  };
}

/** Fehler aus einer API-Antwort; erkennt unveränderliche Releases und liefert dann die passende Anleitung. */
function failure(what, res) {
  if (/immutable/i.test(res.text)) return new ReleaseError(`${what}: Das Release ist unveränderlich.`, IMMUTABLE_HINT);
  const detail = (res.data && res.data.message) || res.text.slice(0, 200) || 'keine Antwort';
  return new ReleaseError(`${what} (HTTP ${res.status}): ${detail}`);
}

/** Sucht das Release zum Tag, auch unter den Entwürfen (die findet der Endpunkt „nach Tag“ nicht). */
async function findRelease(call, repo, tag) {
  for (let page = 1; page <= 10; page += 1) {
    const res = await call('GET', `${API}/repos/${repo}/releases?per_page=100&page=${page}`);
    if (!res.ok) throw failure('Die Releases konnten nicht gelesen werden', res);
    const list = Array.isArray(res.data) ? res.data : [];
    const hit = list.find((r) => r.tag_name === tag);
    if (hit) return hit;
    if (list.length < 100) break;
  }
  return null;
}

async function attachAssets({ call, repo, tag, sha, assets, replace = false, log = () => {} }) {
  let release = await findRelease(call, repo, tag);
  let created = false;
  if (release) {
    log(`Release zu ${tag} gefunden (${release.draft ? 'Entwurf' : 'veröffentlicht'}).`);
  } else {
    const res = await call('POST', `${API}/repos/${repo}/releases`, {
      json: { tag_name: tag, target_commitish: sha, name: tag, body: INTRO, draft: true, generate_release_notes: true },
    });
    if (!res.ok) throw failure('Der Release-Entwurf konnte nicht angelegt werden', res);
    release = res.data;
    created = true;
    log(`Entwurf für ${tag} angelegt.`);
  }

  // Entwürfe sind unveröffentlicht und frei änderbar; veröffentlichte Dateien werden nur auf Wunsch ersetzt.
  const mayReplace = Boolean(release.draft) || replace;
  const existing = new Map((release.assets || []).map((a) => [a.name, a]));
  const uploaded = [];
  const skipped = [];

  for (const asset of assets) {
    const have = existing.get(asset.name);
    if (have && !mayReplace) {
      skipped.push(asset.name);
      log(`${asset.name} hängt schon am Release – übersprungen.`);
      continue;
    }
    if (have) {
      const del = await call('DELETE', `${API}/repos/${repo}/releases/assets/${have.id}`);
      if (!del.ok) throw failure(`${asset.name} konnte nicht ersetzt werden`, del);
    }
    const up = await call('POST', `${UPLOADS}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, {
      body: asset.data,
      contentType: asset.contentType,
    });
    if (up.status === 422 && /already_exists/.test(up.text)) {
      skipped.push(asset.name); // ein paralleler Lauf war schneller
      log(`${asset.name} wurde parallel schon angehängt – übersprungen.`);
      continue;
    }
    if (!up.ok) throw failure(`${asset.name} konnte nicht hochgeladen werden`, up);
    uploaded.push(asset.name);
    log(`${asset.name} hochgeladen.`);
  }
  return { release, created, uploaded, skipped };
}

function tagCommit(tag, root) {
  try {
    return execFileSync('git', ['rev-parse', `refs/tags/${tag}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return null;
  }
}

function headCommit(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

async function main(env = process.env, deps = {}) {
  const root = deps.root || ROOT;
  const log = deps.log || ((line) => console.log(line));
  const tag = env.RELEASE_TAG;
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!tag || !repo || !token) {
    throw new ReleaseError('RELEASE_TAG, GITHUB_REPOSITORY und GITHUB_TOKEN müssen gesetzt sein.');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  validateTag(tag, manifest.version);
  const assets = loadAssets(root, manifest.version);

  const sha = deps.sha || headCommit(root);
  const tagSha = deps.tagSha !== undefined ? deps.tagSha : tagCommit(tag, root);
  if (tagSha && tagSha !== sha) {
    log(`::warning::Der Tag ${tag} zeigt auf ${tagSha.slice(0, 7)}, gebaut wurde aber ${sha.slice(0, 7)}. Das ZIP entspricht nicht dem getaggten Stand.`);
  }

  const call = createClient({ fetchImpl: deps.fetchImpl || fetch, token });
  const result = await attachAssets({ call, repo, tag, sha, assets, replace: env.RELEASE_REPLACE === 'true', log });

  const { release } = result;
  const state = result.created ? 'Entwurf angelegt – bitte prüfen und „Publish release“ klicken' : release.draft ? 'Entwurf aktualisiert' : 'Release ergänzt';
  log(`${state}: ${release.html_url}`);

  if (env.GITHUB_STEP_SUMMARY) {
    const lines = [`### Release ${tag}`, '', `- ${state}`, `- ${release.html_url}`];
    for (const name of result.uploaded) lines.push(`- hochgeladen: \`${name}\``);
    for (const name of result.skipped) lines.push(`- übersprungen: \`${name}\``);
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  return result;
}

module.exports = { main, attachAssets, createClient, findRelease, loadAssets, validateTag, ReleaseError, INTRO };

if (require.main === module) {
  main().catch((e) => {
    if (e instanceof ReleaseError) {
      console.error(`::error::${e.message}`);
      if (e.hint) console.error(e.hint);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}
