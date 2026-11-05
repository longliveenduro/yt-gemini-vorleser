'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeaker } = require('../src/lib/speaker.js');
const { normalizeSettings } = require('../src/lib/settings.js');

const settings = normalizeSettings({ apiKey: 'K' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// drei Sätze à ~660 Bytes → bei 1200 Bytes je Stück ergibt das drei Stücke
const THREE_CHUNKS = Array.from({ length: 3 }, (_, i) => `Satz${i} ${'wort '.repeat(130)}`.trim() + '.').join(' ');

function setup({ autoEnd = true, playRejects = false, fetchFails = null } = {}) {
  const requests = [];
  const audios = [];
  const events = [];
  const fetchImpl = async (url, init) => {
    const n = requests.length;
    requests.push(JSON.parse(init.body).input.text);
    if (fetchFails && fetchFails(n)) return { ok: false, status: 403, json: async () => ({ error: { message: 'This API method requires billing to be enabled.' } }) };
    return { ok: true, status: 200, json: async () => ({ audioContent: Buffer.from(`audio-${n}`).toString('base64') }) };
  };
  const createAudio = (src) => {
    const audio = {
      src,
      paused: false,
      onended: null,
      onerror: null,
      play() {
        if (playRejects) return Promise.reject(new Error('NotAllowedError'));
        if (autoEnd) setTimeout(() => this.onended && this.onended(), 1);
        return Promise.resolve();
      },
      pause() { this.paused = true; },
      end() { this.onended && this.onended(); },
    };
    audios.push(audio);
    return audio;
  };
  const speaker = createSpeaker({ fetchImpl, createAudio, onStatus: (s) => events.push(s.phase) });
  return { speaker, requests, audios, events };
}

test('spielt alle Stücke der Reihe nach ab und meldet speaking → done', async () => {
  const { speaker, requests, audios, events } = setup();
  await speaker.speak(THREE_CHUNKS, settings);
  assert.equal(requests.length, 3);
  assert.equal(audios.length, 3);
  assert.deepEqual(events, ['speaking', 'done']);
  assert.match(audios[0].src, /^data:audio\/ogg;base64,/);
  assert.equal(Buffer.from(audios[1].src.split(',')[1], 'base64').toString(), 'audio-1');
  assert.equal(speaker.isSpeaking(), false);
});

test('MP3 wird mit passendem MIME-Typ abgespielt', async () => {
  const { speaker, audios } = setup();
  await speaker.speak('Kurz.', normalizeSettings({ apiKey: 'K', audioEncoding: 'MP3' }));
  assert.match(audios[0].src, /^data:audio\/mpeg;base64,/);
});

test('lädt das nächste Stück schon, während das erste läuft', async () => {
  const { speaker, requests, audios } = setup({ autoEnd: false });
  const done = speaker.speak(THREE_CHUNKS, settings);
  await wait(20);
  assert.equal(audios.length, 1, 'erstes Stück läuft');
  assert.equal(requests.length, 2, 'zweites Stück wurde vorab angefordert');
  audios[0].end();
  await wait(20);
  assert.equal(audios.length, 2);
  audios[1].end();
  await wait(20);
  audios[2].end();
  await done;
});

test('stop() hält die Wiedergabe an, meldet stopped und lädt nichts mehr nach', async () => {
  const { speaker, requests, audios, events } = setup({ autoEnd: false });
  const done = speaker.speak(THREE_CHUNKS, settings);
  await wait(20);
  speaker.stop();
  await done;
  assert.equal(audios[0].paused, true);
  assert.deepEqual(events, ['speaking', 'stopped']);
  await wait(20);
  assert.equal(audios.length, 1);
  assert.ok(requests.length <= 2);
  assert.equal(speaker.isSpeaking(), false);
});

test('stop() ohne laufende Wiedergabe meldet nichts', () => {
  const { speaker, events } = setup();
  speaker.stop();
  assert.deepEqual(events, []);
});

test('ein neuer speak()-Aufruf ersetzt die laufende Wiedergabe ohne „stopped“', async () => {
  const { speaker, audios, events } = setup({ autoEnd: false });
  const first = speaker.speak(THREE_CHUNKS, settings);
  await wait(20);
  const second = speaker.speak('Neuer Text.', settings);
  await first;
  await wait(20);
  assert.equal(audios[0].paused, true);
  audios[audios.length - 1].end();
  await second;
  assert.deepEqual(events, ['speaking', 'speaking', 'done']);
});

test('API-Fehler werden mit Code und deutscher Meldung gemeldet', async () => {
  const events = [];
  const speaker = createSpeaker({
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'This API method requires billing to be enabled.' } }) }),
    createAudio: () => { throw new Error('darf nicht aufgerufen werden'); },
    onStatus: (s) => events.push(s),
  });
  await speaker.speak('Hallo Welt.', settings);
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, 'error');
  assert.equal(events[0].code, 'BILLING');
  assert.match(events[0].message, /Abrechnung/);
});

test('ein Fehler beim zweiten Stück beendet die Wiedergabe mit Fehlerstatus', async () => {
  const { speaker, events, audios } = setup({ fetchFails: (n) => n === 1 });
  await speaker.speak(THREE_CHUNKS, settings);
  assert.equal(audios.length, 1);
  assert.deepEqual(events, ['speaking', 'error']);
});

test('blockierte Wiedergabe (Autoplay) wird als AUDIO_ERROR gemeldet', async () => {
  const events = [];
  const speaker = createSpeaker({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ audioContent: 'QQ==' }) }),
    createAudio: () => ({ play: () => Promise.reject(new Error('NotAllowedError')), pause() {} }),
    onStatus: (s) => events.push(s),
  });
  await speaker.speak('Hallo.', settings);
  const err = events.find((e) => e.phase === 'error');
  assert.equal(err.code, 'AUDIO_ERROR');
  assert.match(err.message, /blockiert/);
});

test('leerer Text ergibt einen Fehlerstatus statt eines Requests', async () => {
  const { speaker, requests, events } = setup();
  await speaker.speak('  \n ', settings);
  assert.equal(requests.length, 0);
  assert.deepEqual(events, ['error']);
});
