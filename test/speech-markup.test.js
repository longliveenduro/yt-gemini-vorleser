'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const markup = require('../src/lib/speech-markup.js');

const NEURAL = { voiceName: 'de-DE-Neural2-B', languageCode: 'de-DE' };
const STUDIO = { voiceName: 'de-DE-Studio-B', languageCode: 'de-DE' };
const CHIRP3 = { voiceName: 'de-DE-Chirp3-HD-Charon', languageCode: 'de-DE' };
const CHIRP_HD = { voiceName: 'de-DE-Chirp-HD-D', languageCode: 'de-DE' };

const say = (letters) => `<say-as interpret-as="characters">${letters}</say-as>`;
const lang = (tag, word) => `<lang xml:lang="${tag}">${word}</lang>`;

test('voiceCapabilities: Standard, WaveNet, Neural2 und News verstehen <say-as> und <lang>', () => {
  for (const name of ['de-DE-Standard-A', 'de-DE-Wavenet-F', 'de-DE-Neural2-B', 'en-US-News-K']) {
    assert.deepEqual(markup.voiceCapabilities(name), { ssml: true, lang: true }, name);
  }
});

test('voiceCapabilities: Studio und Chirp 3 HD verstehen <say-as>, aber kein <lang>', () => {
  for (const name of ['de-DE-Studio-B', 'de-DE-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Aoede']) {
    assert.deepEqual(markup.voiceCapabilities(name), { ssml: true, lang: false }, name);
  }
});

test('voiceCapabilities: Chirp HD (früher Journey), Polyglot, Gemini-Namen und Unbekanntes bekommen kein SSML', () => {
  for (const name of ['de-DE-Chirp-HD-D', 'de-DE-Journey-F', 'en-US-Polyglot-1', 'Kore', 'de-DE-Casual-K']) {
    assert.deepEqual(markup.voiceCapabilities(name), { ssml: false, lang: false }, name);
  }
});

test('voiceCapabilities: ohne Stimmenname (Standardstimme der Sprache) wird nur <say-as> verwendet', () => {
  assert.deepEqual(markup.voiceCapabilities(''), { ssml: true, lang: false });
  assert.deepEqual(markup.voiceCapabilities(undefined), { ssml: true, lang: false });
});

test('Text ohne Abkürzungen und Markierungen bleibt unverändert und wird nicht zu SSML', () => {
  const r = markup.render('Ein ganz normaler Satz. Und noch einer – mit Umlauten: äöüß.', NEURAL);
  assert.equal(r.ssml, null);
  assert.equal(r.text, 'Ein ganz normaler Satz. Und noch einer – mit Umlauten: äöüß.');
  assert.deepEqual(markup.render('', NEURAL), { ssml: null, text: '' });
  assert.deepEqual(markup.render(undefined, NEURAL), { ssml: null, text: '' });
});

test('KI wird als Buchstabenfolge gesprochen: <say-as> mit SSML, „K-I“ ohne', () => {
  const r = markup.render('Die KI lernt.', NEURAL);
  assert.equal(r.ssml, `<speak>Die ${say('KI')} lernt.</speak>`);
  assert.equal(r.text, 'Die K-I lernt.');
  assert.equal(markup.render('Die KI lernt.', CHIRP_HD).text, 'Die K-I lernt.');
  assert.equal(markup.render('Die KI lernt.', CHIRP_HD).ssml, null);
});

test('Abkürzungen mit 2 bis 4 Großbuchstaben werden buchstabiert, auch vor und nach Satzzeichen und Bindestrichen', () => {
  const r = markup.render('EU, USA, GPU und HTML: (CPU) – US-Präsident, EU-weit, PC-Spiele.', NEURAL);
  assert.equal(
    r.ssml,
    `<speak>${say('EU')}, ${say('USA')}, ${say('GPU')} und ${say('HTML')}: (${say('CPU')}) – ${say('US')}-Präsident, ` +
      `${say('EU')}-weit, ${say('PC')}-Spiele.</speak>`,
  );
  assert.equal(r.text, 'E-U, U-S-A, G-P-U und H-T-M-L: (C-P-U) – U-S-Präsident, E-U-weit, P-C-Spiele.');
});

test('Umlaute zählen mit (ÖVP), der Rest des Wortes bleibt unberührt', () => {
  assert.equal(markup.render('Die ÖVP regiert.', NEURAL).ssml, `<speak>Die ${say('ÖVP')} regiert.</speak>`);
});

test('als Wort gesprochene Abkürzungen (NASA, NATO, RAM …) werden nicht buchstabiert', () => {
  for (const word of ['NASA', 'NATO', 'RAM', 'JSON', 'OK', 'UEFA', 'DAX']) {
    const r = markup.render(`Das ${word} sagt es.`, NEURAL);
    assert.equal(r.ssml, null, word);
    assert.equal(r.text, `Das ${word} sagt es.`, word);
  }
  // NASA bleibt, KI im selben Satz wird trotzdem buchstabiert
  assert.equal(markup.render('NASA und KI.', NEURAL).ssml, `<speak>NASA und ${say('KI')}.</speak>`);
});

test('keine Abkürzungen: römische Zahlen, gemischte Schreibung, lange Wörter, Zahlen im Wort, Einzelbuchstaben', () => {
  const text = 'Karl III. und Papst XIV., iPhone, iOS, macOS, mRNA, GmbH, PowerPoint, COVID, UNESCO, MP3, CO2, GPT4, 5G, A, I.';
  const r = markup.render(text, NEURAL);
  assert.equal(r.ssml, null);
  assert.equal(r.text, text);
});

test('mit Bindestrichen geschriebene Abkürzungen (K-I, U-S-A) werden wie KI und USA behandelt', () => {
  const r = markup.render('Die K-I-Modelle der U-S-A.', NEURAL);
  assert.equal(r.ssml, `<speak>Die ${say('KI')}-Modelle der ${say('USA')}.</speak>`);
  assert.equal(r.text, 'Die K-I-Modelle der U-S-A.');
  assert.equal(markup.render('Anti-KI und G-P-U.', NEURAL).ssml, `<speak>Anti-${say('KI')} und ${say('GPU')}.</speak>`);
});

test('ausdrücklich buchstabierte Abkürzungen bleiben auch bei 5 und mehr Buchstaben buchstabiert', () => {
  assert.equal(markup.render('Das H-T-T-P-S-Protokoll.', NEURAL).ssml, `<speak>Das ${say('HTTPS')}-Protokoll.</speak>`);
  // Auch ein Wort aus der Wortliste, wenn Gemini es ausdrücklich buchstabiert hat
  assert.equal(markup.render('Der R-A-M.', NEURAL).ssml, `<speak>Der ${say('RAM')}.</speak>`);
});

test('Wörter mit Bindestrich und Einzelbuchstaben (E-Mail, S-Bahn, U-Boot) sind keine Abkürzungen', () => {
  const text = 'Eine E-Mail per S-Bahn zum U-Boot, vom A-Z-Katalog.';
  const r = markup.render(text, NEURAL);
  // nur „A-Z“ ist eine Buchstabenfolge; E-Mail, S-Bahn und U-Boot bleiben wie sie sind
  assert.equal(r.ssml, `<speak>Eine E-Mail per S-Bahn zum U-Boot, vom ${say('AZ')}-Katalog.</speak>`);
  assert.equal(markup.render('Eine E-Mail per S-Bahn zum U-Boot.', NEURAL).ssml, null);
});

test('Sprachmarken: bei Standard, WaveNet und Neural2 wird das Wort in <lang> gesprochen', () => {
  const r = markup.render('Das {en|Harness} und {it|Di Gianantonio} und {fr|Rendez-vous}.', NEURAL);
  assert.equal(
    r.ssml,
    `<speak>Das ${lang('en-US', 'Harness')} und ${lang('it-IT', 'Di Gianantonio')} und ${lang('fr-FR', 'Rendez-vous')}.</speak>`,
  );
  assert.equal(r.text, 'Das Harness und Di Gianantonio und Rendez-vous.');
  for (const name of ['de-DE-Standard-A', 'de-DE-Wavenet-F']) {
    assert.match(markup.render('Das {en|Harness}.', { voiceName: name, languageCode: 'de-DE' }).ssml, /<lang xml:lang="en-US">Harness<\/lang>/, name);
  }
});

test('Sprachmarken: mehrere Wörter, Region im Code und tolerante Schreibweise', () => {
  const r = markup.render('{en|Pull Request}, {EN-gb|Lorry}, { es : Hasta la vista }, {pt_PT|obrigado}.', NEURAL);
  assert.equal(
    r.ssml,
    `<speak>${lang('en-US', 'Pull Request')}, ${lang('en-GB', 'Lorry')}, ${lang('es-ES', 'Hasta la vista')}, ${lang('pt-PT', 'obrigado')}.</speak>`,
  );
  assert.equal(r.text, 'Pull Request, Lorry, Hasta la vista, obrigado.');
});

test('Sprachmarken: Studio und Chirp 3 HD können kein <lang> – das Wort bleibt ohne Markierung stehen', () => {
  for (const voice of [STUDIO, CHIRP3]) {
    const onlyMarker = markup.render('Das {en|Harness} und {it|Di Gianantonio}.', voice);
    assert.equal(onlyMarker.ssml, null, voice.voiceName);
    assert.equal(onlyMarker.text, 'Das Harness und Di Gianantonio.');
    // Abkürzungen gehen weiterhin, in derselben Anfrage
    const both = markup.render('Die KI nutzt das {en|Harness}.', voice);
    assert.equal(both.ssml, `<speak>Die ${say('KI')} nutzt das Harness.</speak>`, voice.voiceName);
  }
});

test('Sprachmarken: Stimmen ohne SSML bekommen Klartext ohne Markierung und mit „K-I“', () => {
  const r = markup.render('Die KI nutzt das {en|Harness}.', CHIRP_HD);
  assert.deepEqual(r, { ssml: null, text: 'Die K-I nutzt das Harness.' });
});

test('Sprachmarken: dieselbe Sprache wie die Stimme braucht kein <lang>, eine andere schon', () => {
  const english = { voiceName: 'en-GB-Neural2-A', languageCode: 'en-GB' };
  assert.equal(markup.render('A {en|lorry} and {EN|truck}.', english).ssml, null);
  assert.equal(markup.render('Das {de|Haus}.', NEURAL).ssml, null);
  assert.equal(markup.render('Ein {de|Haus} und ein {en|house}.', english).ssml, `<speak>Ein ${lang('de-DE', 'Haus')} und ein house.</speak>`);
});

test('Sprachmarken: nicht unterstützte oder unbekannte Sprachen (ja, zh, ko, ar, xx) werden normal gelesen', () => {
  const r = markup.render('{ja|寿司}, {zh|你好}, {ko|안녕}, {ar|مرحبا}, {xx|foo}.', NEURAL);
  assert.equal(r.ssml, null);
  assert.equal(r.text, '寿司, 你好, 안녕, مرحبا, foo.');
  assert.equal(markup.langTag('ja'), null);
  assert.equal(markup.langTag('en'), 'en-US');
  assert.equal(markup.langTag('EN-gb'), 'en-GB');
  assert.equal(markup.langTag('pt'), 'pt-BR');
  assert.equal(markup.langTag(''), null);
});

test('der Inhalt einer Sprachmarke wird nicht als Abkürzung behandelt', () => {
  const r = markup.render('Die {en|API} und die {en|CPU} gehören zur KI.', NEURAL);
  assert.equal(r.ssml, `<speak>Die ${lang('en-US', 'API')} und die ${lang('en-US', 'CPU')} gehören zur ${say('KI')}.</speak>`);
});

test('SSML-Sonderzeichen werden maskiert, der Klartext bleibt unverändert', () => {
  const r = markup.render('Tom & Jerry <b> sagen "KI" und it\'s {en|R&D}.', NEURAL);
  assert.equal(
    r.ssml,
    `<speak>Tom &amp; Jerry &lt;b&gt; sagen &quot;${say('KI')}&quot; und it&apos;s ${lang('en-US', 'R&amp;D')}.</speak>`,
  );
  assert.equal(r.text, 'Tom & Jerry <b> sagen "K-I" und it\'s R&D.');
});

test('zerschnittene Markierungen (Anfang und Ende in verschiedenen Stücken): Reste werden entfernt, das Wort bleibt', () => {
  assert.deepEqual(markup.render('Das {en|Pull', NEURAL), { ssml: null, text: 'Das Pull' });
  assert.deepEqual(markup.render('Request} geht kaputt.', NEURAL), { ssml: null, text: 'Request geht kaputt.' });
  assert.equal(markup.render('Ein } und { Zeichen.', NEURAL).text, 'Ein  und  Zeichen.');
  // eine KI im Rest wird trotzdem erkannt
  assert.equal(markup.render('{en|Pull', NEURAL).ssml, null);
  assert.equal(markup.render('{en|Pull Request} und KI.', NEURAL).ssml, `<speak>${lang('en-US', 'Pull Request')} und ${say('KI')}.</speak>`);
});

test('Leerraum innerhalb der Klammern gehört zur Markierung, nicht zum Text', () => {
  assert.equal(markup.render('Das {en|Pull und }Rest.', NEURAL).text, 'Das Pull undRest.');
  assert.equal(markup.render('Das { en | Pull und } Rest.', NEURAL).text, 'Das Pull und Rest.');
});

test('ein zu langer Inhalt ist keine Markierung, die Klammern fallen trotzdem weg', () => {
  const long = 'x'.repeat(81);
  const r = markup.render(`Das {en|${long}} Ende.`, NEURAL);
  assert.equal(r.text, `Das ${long} Ende.`);
  assert.equal(r.ssml, null, 'kein <lang>, denn es ist keine gültige Markierung');
  // genau 80 Zeichen sind noch eine Markierung
  const edge = 'x'.repeat(80);
  assert.equal(markup.render(`Das {en|${edge}} Ende.`, NEURAL).ssml, `<speak>Das ${lang('en-US', edge)} Ende.</speak>`);
});

test('Leerraum um Abkürzungen und Markierungen bleibt genau erhalten', () => {
  assert.equal(markup.render('A  KI  B', NEURAL).ssml, `<speak>A  ${say('KI')}  B</speak>`);
  assert.equal(markup.render('KI', NEURAL).ssml, `<speak>${say('KI')}</speak>`);
  assert.equal(markup.render('{en|Harness}', NEURAL).ssml, `<speak>${lang('en-US', 'Harness')}</speak>`);
});

test('zu großes SSML (über 4800 Bytes) fällt auf den Klartext zurück', () => {
  const big = Array.from({ length: 200 }, () => 'KI').join(' ') + '.'; // 200 × (45 Bytes Tag + 2 Buchstaben) > 4800
  const r = markup.render(big, NEURAL);
  assert.equal(r.ssml, null);
  assert.equal(r.text, `${Array.from({ length: 200 }, () => 'K-I').join(' ')}.`);

  const fits = markup.render(Array.from({ length: 50 }, () => 'KI').join(' '), NEURAL);
  assert.ok(fits.ssml);
  assert.ok(new TextEncoder().encode(fits.ssml).length <= markup.MAX_SSML_BYTES);
});

test('ohne Stimmenangabe (Standardstimme) wird <say-as> verwendet, aber kein <lang>', () => {
  const r = markup.render('Die KI und das {en|Harness}.', { voiceName: '', languageCode: 'fr-FR' });
  assert.equal(r.ssml, `<speak>Die ${say('KI')} und das Harness.</speak>`);
});

test('die Wortliste enthält nur Großbuchstaben (sonst würde sie nie greifen)', () => {
  for (const word of markup.WORD_ACRONYMS) assert.match(word, /^[A-ZÄÖÜ]{2,5}$/, word);
  for (const [code, tag] of Object.entries(markup.LANG_TAGS)) assert.match(tag, new RegExp(`^${code === 'no' ? 'nb' : code}-[A-Z]{2}$`), code);
});
