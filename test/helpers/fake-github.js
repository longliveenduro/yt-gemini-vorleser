'use strict';

/*
 * Eine kleine Simulation der GitHub-Release-API (nur, was scripts/release.js braucht):
 * Releases lesen (mit Seiten, inkl. Entwürfen), Entwurf anlegen, Dateien hochladen/löschen – samt der Fehler,
 * die GitHub liefert (doppelter Dateiname, unveränderliches Release).
 */

function createFakeGitHub({ releases = [], onRequest } = {}) {
  const state = {
    releases: releases.map((r) => ({ draft: false, assets: [], ...r })),
    nextReleaseId: 100,
    nextAssetId: 5000,
    calls: [],
    uploads: [],
    deleted: [],
  };

  const respond = (status, data) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  });

  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    const u = new URL(url);
    const headers = init.headers || {};
    state.calls.push({ method, host: u.hostname, path: u.pathname, search: u.search, headers, body: init.body });

    if (onRequest) {
      const forced = onRequest(method, u, init);
      if (forced) return respond(forced.status, forced.data);
    }
    if (!/^Bearer \S+$/.test(headers.Authorization || '')) return respond(401, { message: 'Bad credentials' });

    let m;
    if (u.hostname === 'api.github.com') {
      if (method === 'GET' && (m = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname))) {
        const per = Number(u.searchParams.get('per_page') || 30);
        const page = Number(u.searchParams.get('page') || 1);
        return respond(200, state.releases.slice((page - 1) * per, page * per));
      }
      if (method === 'POST' && (m = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname))) {
        const body = JSON.parse(init.body);
        const id = state.nextReleaseId++;
        const release = {
          id,
          tag_name: body.tag_name,
          name: body.name,
          body: body.body,
          draft: Boolean(body.draft),
          assets: [],
          html_url: `https://github.com/${m[1]}/releases/tag/untagged-${id}`,
          request: body,
        };
        state.releases.unshift(release);
        return respond(201, release);
      }
      if (method === 'DELETE' && (m = /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/.exec(u.pathname))) {
        const assetId = Number(m[1]);
        const release = state.releases.find((r) => r.assets.some((a) => a.id === assetId));
        if (!release) return respond(404, { message: 'Not Found' });
        if (release.immutable) return respond(422, { message: 'Cannot delete assets of an immutable release.' });
        release.assets = release.assets.filter((a) => a.id !== assetId);
        state.deleted.push(assetId);
        return respond(204);
      }
    }
    if (u.hostname === 'uploads.github.com' && method === 'POST' && (m = /^\/repos\/[^/]+\/[^/]+\/releases\/(\d+)\/assets$/.exec(u.pathname))) {
      const release = state.releases.find((r) => r.id === Number(m[1]));
      if (!release) return respond(404, { message: 'Not Found' });
      if (release.immutable) return respond(422, { message: 'Cannot upload assets to an immutable release.' });
      const name = u.searchParams.get('name');
      if (release.assets.some((a) => a.name === name)) {
        return respond(422, { message: 'Validation Failed', errors: [{ resource: 'ReleaseAsset', code: 'already_exists', field: 'name' }] });
      }
      const asset = { id: state.nextAssetId++, name, size: init.body.length, content_type: headers['Content-Type'] };
      release.assets.push(asset);
      state.uploads.push({ releaseId: release.id, name, data: Buffer.from(init.body), contentType: headers['Content-Type'] });
      return respond(201, asset);
    }
    return respond(404, { message: 'Not Found' });
  }

  return { fetchImpl, state };
}

module.exports = { createFakeGitHub };
