/*
 * Aufbereitung des Vorlesetextes für Google TTS (kein DOM, keine Chrome-APIs).
 *
 *  - Abkürzungen, die man buchstabiert (KI, EU, GPU …), werden Buchstabe für Buchstabe gesprochen. Das gilt für
 *    Großbuchstaben-Abkürzungen im Text und für die Schreibweise mit Bindestrichen, die der Prompt von Gemini verlangt
 *    (K-I, U-S-A).
 *  - Fremdsprachige Wörter und Namen, die Gemini als {en|Harness} oder {it|Di Gianantonio} gekennzeichnet hat,
 *    werden in ihrer Sprache gesprochen, obwohl der Rest deutsch ist.
 *
 * Je nach Stimme wird daraus SSML oder einfacher Text. Laut Google-Doku gilt:
 *   Standard, WaveNet, Neural2, News  <say-as> und <lang>
 *   Studio, Chirp 3 HD                <say-as>, aber kein <lang>
 *   Chirp HD (früher Journey), sonst  kein SSML
 * Ohne SSML wird die Abkürzung mit Bindestrichen geschrieben (K-I) und die Markierung entfernt.
 * UMD: YTGR.speechMarkup im Browser, require() in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).speechMarkup = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Die Google-API erlaubt höchstens 5000 Bytes je Anfrage (SSML-Tags zählen mit).
  const MAX_SSML_BYTES = 4800;

  // Sprachcode aus der Markierung → BCP-47-Code für <lang>. Nicht aufgeführte Sprachen fehlen mit Absicht:
  // Japanisch (Kanji werden als Chinesisch gelesen), Chinesisch, Koreanisch und semitische Sprachen (ergeben
  // Stille) unterstützt <lang> laut Google nicht. Für sie entfällt die Markierung, das Wort wird normal gelesen.
  const LANG_TAGS = Object.freeze({
    en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL', pl: 'pl-PL',
    ru: 'ru-RU', tr: 'tr-TR', sv: 'sv-SE', da: 'da-DK', nb: 'nb-NO', no: 'nb-NO', fi: 'fi-FI', cs: 'cs-CZ',
    el: 'el-GR', hu: 'hu-HU', ro: 'ro-RO', uk: 'uk-UA',
  });

  // Abkürzungen aus Großbuchstaben, die man als Wort spricht. Alles andere mit 2 bis 4 Großbuchstaben wird buchstabiert.
  const WORD_ACRONYMS = new Set([
    'NASA', 'NATO', 'OPEC', 'FIFA', 'UEFA', 'UNO', 'SARS', 'AIDS', 'DAX', 'MDAX', 'IKEA', 'LASER',
    'RAM', 'ROM', 'LAN', 'WLAN', 'WIFI', 'PIN', 'TAN', 'SIM', 'BIOS', 'ZIP', 'UNIX', 'OK', 'ASAP', 'GNU',
    'JSON', 'YAML', 'CRUD', 'SASS', 'RISC', 'WASM', 'CUDA', 'ONNX', 'BERT', 'RAG', 'CLIP', 'BLEU',
  ]);

  const ROMAN = /^[IVX]+$/; // „III“ in „Karl III.“ ist keine Abkürzung

  // Markierung {en|Harness}; „:“ statt „|“, Leerzeichen und Groß-/Kleinschreibung des Sprachcodes werden toleriert.
  const MARKER = /\{\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?)\s*[|:]\s*([^{}|\n]{1,80}?)\s*\}/g;
  // Reste einer zerschnittenen Markierung: „{en|“ ohne Wort davor/dahinter und einzelne Klammern.
  const STRAY_OPEN = /\{\s*[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?\s*[|:]\s*/g;

  // Buchstabiert geschrieben (K-I, U-S-A: jeder Teil ein einzelner Großbuchstabe) oder 2 bis 4 Großbuchstaben.
  const CAPITALS = 'A-ZÄÖÜ';
  const ABBREVIATION = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:(?:[${CAPITALS}]-){1,5}[${CAPITALS}]|[${CAPITALS}]{2,4})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  function primary(code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  }

  /** Was die Stimme an Markup versteht (siehe Kopfkommentar). Ohne Stimmennamen ist die Familie unbekannt. */
  function voiceCapabilities(voiceName) {
    const name = String(voiceName || '');
    if (/-(?:Standard|Wavenet|Neural2|News)-/i.test(name)) return { ssml: true, lang: true };
    if (/-(?:Studio|Chirp3-HD)-/i.test(name)) return { ssml: true, lang: false };
    if (!name) return { ssml: true, lang: false }; // Standardstimme der Sprache: <say-as> gilt in allen SSML-Familien
    return { ssml: false, lang: false };
  }

  /** BCP-47-Code für <lang> oder null, wenn die Sprache nicht unterstützt wird. */
  function langTag(code) {
    const [lang, region] = String(code || '').split(/[-_]/);
    const known = LANG_TAGS[String(lang).toLowerCase()];
    if (!known) return null;
    return region && /^[A-Za-z]{2}$/.test(region) ? `${lang.toLowerCase()}-${region.toUpperCase()}` : known;
  }

  function cleanStray(value) {
    return value.replace(STRAY_OPEN, '').replace(/[{}]/g, '');
  }

  function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /** Text → Segmente: { type: 'text' | 'abbr' | 'lang', value, lang? } */
  function parse(input) {
    const segments = [];

    function pushText(chunk) {
      let last = 0;
      for (const m of chunk.matchAll(ABBREVIATION)) {
        const letters = m[0].replace(/-/g, '');
        const written = m[0].includes('-'); // mit Bindestrichen geschrieben = ausdrücklich buchstabiert
        if (!written && (WORD_ACRONYMS.has(letters) || ROMAN.test(letters))) continue;
        if (m.index > last) segments.push({ type: 'text', value: cleanStray(chunk.slice(last, m.index)) });
        segments.push({ type: 'abbr', value: letters });
        last = m.index + m[0].length;
      }
      if (last < chunk.length) segments.push({ type: 'text', value: cleanStray(chunk.slice(last)) });
    }

    const text = String(input || '');
    let last = 0;
    for (const m of text.matchAll(MARKER)) {
      pushText(text.slice(last, m.index));
      segments.push({ type: 'lang', lang: m[1], value: m[2] }); // Leerraum am Rand schluckt das Muster selbst
      last = m.index + m[0].length;
    }
    pushText(text.slice(last));
    return segments;
  }

  function toPlain(segments) {
    return segments.map((s) => (s.type === 'abbr' ? [...s.value].join('-') : s.value)).join('');
  }

  /**
   * SSML aus den Segmenten. Bewusst ohne <s>-Tags: Satzgrenzen wie nach „z. B.“ oder „Karl III.“ ließen sich nicht
   * sicher erkennen, und ein falsch gesetzter Satzwechsel erzeugt hörbare Pausen. Die Stimme entscheidet selbst.
   */
  function toSsml(segments, caps, voiceLanguage) {
    const body = segments
      .map((s) => {
        if (s.type === 'text') return escapeXml(s.value);
        if (s.type === 'abbr') return `<say-as interpret-as="characters">${escapeXml(s.value)}</say-as>`;
        const tag = caps.lang ? langTag(s.lang) : null;
        return tag && primary(tag) !== voiceLanguage ? `<lang xml:lang="${tag}">${escapeXml(s.value)}</lang>` : escapeXml(s.value);
      })
      .join('');
    return `<speak>${body}</speak>`;
  }

  /**
   * Bereitet einen Textabschnitt für eine Stimme auf.
   * Ergebnis: { ssml, text } – ssml ist null, wenn die Stimme kein SSML versteht, nichts zu markieren ist oder das
   * SSML zu groß würde; text ist immer die Klartext-Fassung (Rückfall, wenn Google das SSML ablehnt).
   * opts: { voiceName, languageCode } (die tatsächlich verwendete Stimme und Sprache)
   */
  function render(input, opts) {
    const o = opts || {};
    const caps = voiceCapabilities(o.voiceName);
    const voiceLanguage = primary(o.languageCode);
    const segments = parse(input);
    const text = toPlain(segments);
    if (!caps.ssml) return { ssml: null, text };

    const needed = segments.some(
      (s) => s.type === 'abbr' || (s.type === 'lang' && caps.lang && langTag(s.lang) && primary(langTag(s.lang)) !== voiceLanguage),
    );
    if (!needed) return { ssml: null, text };

    const ssml = toSsml(segments, caps, voiceLanguage);
    if (new TextEncoder().encode(ssml).length > MAX_SSML_BYTES) return { ssml: null, text };
    return { ssml, text };
  }

  return { render, voiceCapabilities, langTag, WORD_ACRONYMS, LANG_TAGS, MAX_SSML_BYTES };
});
