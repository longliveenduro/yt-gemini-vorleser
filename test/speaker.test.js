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
  const bodies = [];
  const audios = [];
  const events = [];
  const fetchImpl = async (url, init) => {
    const n = requests.length;
    const body = JSON.parse(init.body);
    bodies.push(body);
    requests.push(body.input.text);
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
  return { speaker, requests, bodies, audios, events };
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

const NEURAL = normalizeSettings({ apiKey: 'K', voiceName: 'de-DE-Neural2-B' });

test('Abkürzungen und Sprachmarken gehen bei Neural2-Stimmen als SSML an die API', async () => {
  const { speaker, bodies, events } = setup();
  await speaker.speak('Die KI nutzt das {en|Harness}.', NEURAL);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].input, {
    ssml: '<speak>Die <say-as interpret-as="characters">KI</say-as> nutzt das <lang xml:lang="en-US">Harness</lang>.</speak>',
  });
  assert.deepEqual(events, ['speaking', 'done']);
});

test('Text ohne Abkürzungen und Markierungen bleibt Klartext (kein SSML)', async () => {
  const { speaker, bodies } = setup();
  await speaker.speak('Ein ganz normaler Satz.', NEURAL);
  assert.deepEqual(bodies[0].input, { text: 'Ein ganz normaler Satz.' });
});

test('eine Stimme ohne SSML (Chirp HD) bekommt Klartext: „K-I“ und kein Marker', async () => {
  const { speaker, bodies } = setup();
  await speaker.speak('Die KI nutzt das {en|Harness}.', normalizeSettings({ apiKey: 'K', voiceName: 'de-DE-Chirp-HD-D' }));
  assert.deepEqual(bodies[0].input, { text: 'Die K-I nutzt das Harness.' });
});

test('eine Markierung mit Punkt wird nie zwischen zwei Anfragen zerschnitten', async () => {
  const { speaker, bodies } = setup();
  // Das erste Stück ist fast voll: „… {it|Dr.“ würde noch hineinpassen, der Rest der Markierung nicht mehr.
  const first = `Satz ${'wort '.repeat(232)}ende.`;
  const sentence = 'Dann spricht {it|Dr. Di Gianantonio} über KI.';
  const bytes = (x) => Buffer.byteLength(x, 'utf8');
  assert.ok(bytes(first) + 1 + bytes('Dann spricht {it|Dr.') <= 1200, 'Voraussetzung: der Anfang der Markierung passt noch');
  assert.ok(bytes(first) + 1 + bytes(sentence) > 1200, 'Voraussetzung: der ganze Satz passt nicht mehr');
  await speaker.speak(`${first} ${sentence}`, NEURAL);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input.text, first);
  assert.equal(
    bodies[1].input.ssml,
    `<speak>Dann spricht <lang xml:lang="it-IT">Dr. Di Gianantonio</lang> über <say-as interpret-as="characters">KI</say-as>.</speak>`,
  );
});

test('eine Markierung in einem überlangen Satz bleibt beim Teilen an Wortgrenzen ganz', async () => {
  const { speaker, bodies } = setup();
  // ein einziger Satz; „{en|Pull“ passt noch ins erste Stück, die ganze Markierung nicht mehr
  const filler = 'wort '.repeat(237).trim();
  const text = `${filler} {en|Pull Request} ${'wort '.repeat(5)}ende.`;
  const bytes = (x) => Buffer.byteLength(x, 'utf8');
  assert.ok(bytes(`${filler} {en|Pull`) <= 1200, 'Voraussetzung: der Anfang der Markierung passt noch');
  assert.ok(bytes(`${filler} {en|Pull Request}`) > 1200, 'Voraussetzung: die ganze Markierung passt nicht mehr');
  await speaker.speak(text, NEURAL);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input.text, filler);
  assert.match(bodies[1].input.ssml, /^<speak><lang xml:lang="en-US">Pull Request<\/lang> wort/);
});

test('lehnt Google das SSML ab (400), wird dasselbe Stück als Klartext wiederholt und der Rest der Wiedergabe bleibt Klartext', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.input.ssml) return { ok: false, status: 400, json: async () => ({ error: { message: 'SSML is not supported by this voice.' } }) };
    return { ok: true, status: 200, json: async () => ({ audioContent: Buffer.from('audio').toString('base64') }) };
  };
  const events = [];
  const speaker = createSpeaker({
    fetchImpl,
    createAudio: (src) => ({ src, play() { setTimeout(() => this.onended && this.onended(), 1); return Promise.resolve(); }, pause() {} }),
    onStatus: (s) => events.push(s.phase),
  });
  const long = `Die KI ${'wort '.repeat(135)}ende. KI KI ${'wort '.repeat(135)}Ende.`; // zwei Stücke, beide mit Abkürzung
  await speaker.speak(long, NEURAL);
  assert.deepEqual(events, ['speaking', 'done']);
  const kinds = bodies.map((b) => (b.input.ssml ? 'ssml' : 'text'));
  // 1. Stück: SSML abgelehnt, dann Klartext; 2. Stück gleich als Klartext (nicht noch einmal SSML versuchen)
  assert.deepEqual(kinds, ['ssml', 'text', 'text']);
  assert.match(bodies[1].input.text, /^Die K-I wort/);
  assert.match(bodies[2].input.text, /^K-I K-I wort/);
});

test('andere 400-Fehler (ohne SSML in der Anfrage) werden nicht wiederholt', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: false, status: 400, json: async () => ({ error: { message: 'Voice does not exist' } }) };
  };
  const events = [];
  const speaker = createSpeaker({ fetchImpl, createAudio: () => { throw new Error('darf nicht abspielen'); }, onStatus: (s) => events.push(s) });
  await speaker.speak('Ein Satz ohne Besonderheiten.', NEURAL);
  assert.equal(bodies.length, 1);
  assert.equal(events.at(-1).phase, 'error');
  assert.equal(events.at(-1).code, 'BAD_REQUEST');
});

test('scheitert auch der Klartext-Versuch nach einer SSML-Ablehnung, wird der Fehler gemeldet', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: false, status: 400, json: async () => ({ error: { message: 'Voice does not exist' } }) };
  };
  const events = [];
  const speaker = createSpeaker({ fetchImpl, createAudio: () => { throw new Error('darf nicht abspielen'); }, onStatus: (s) => events.push(s) });
  await speaker.speak('Die KI.', NEURAL);
  assert.deepEqual(bodies.map((b) => Object.keys(b.input)[0]), ['ssml', 'text']);
  assert.equal(events.at(-1).phase, 'error');
  assert.equal(events.at(-1).code, 'BAD_REQUEST');
});

test('andere Fehler bei einer SSML-Anfrage (Abrechnung, Kontingent, Server) werden gemeldet, nicht als Klartext wiederholt', async () => {
  for (const [status, message, code] of [
    [403, 'This API method requires billing to be enabled.', 'BILLING'],
    [429, 'Quota exceeded', 'QUOTA'],
    [503, 'unavailable', 'SERVER'],
  ]) {
    const bodies = [];
    const fetchImpl = async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: false, status: status, json: async () => ({ error: { message } }) };
    };
    const events = [];
    const speaker = createSpeaker({ fetchImpl, createAudio: () => { throw new Error('darf nicht abspielen'); }, onStatus: (s) => events.push(s) });
    await speaker.speak('Die KI.', NEURAL);
    assert.equal(bodies.length, 1, `${status}: nur eine Anfrage`);
    assert.ok(bodies[0].input.ssml, `${status}: die Anfrage war SSML`);
    assert.equal(events.at(-1).code, code);
  }
});
