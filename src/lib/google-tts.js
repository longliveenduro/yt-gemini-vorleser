/*
 * Minimaler Client für die Google Cloud Text-to-Speech REST-API (v1).
 * Authentifizierung per API-Key im Header X-Goog-Api-Key (nicht in der URL).
 * Das fetch wird übergeben, damit die Tests ohne Netzwerk laufen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).googleTts = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ENDPOINT = 'https://texttospeech.googleapis.com/v1';

  class TtsError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'TtsError';
      this.code = code;
    }
  }

  /** "de-DE-Neural2-B" → "de-DE"; ohne erkennbares Präfix der Rückfallwert. */
  function localeOf(voiceName, fallback) {
    const m = /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(voiceName || '');
    return m ? m[1] : fallback;
  }

  function primary(code) {
    return String(code || '').toLowerCase().split('-')[0];
  }

  /**
   * Die gewählte Sprache bestimmt, was gesprochen wird. Eine Stimme wird nur verwendet, wenn sie zur selben
   * Hauptsprache gehört (en-GB-Stimme bei en-US ist in Ordnung, eine deutsche Stimme bei Englisch nicht).
   */
  function buildSynthesizeRequest({ text, settings }) {
    const voiceLocale = localeOf(settings.voiceName, null);
    const useVoice = Boolean(settings.voiceName && voiceLocale && primary(voiceLocale) === primary(settings.languageCode));
    const voice = { languageCode: useVoice ? voiceLocale : settings.languageCode };
    if (useVoice) voice.name = settings.voiceName;
    return {
      input: { text },
      voice,
      audioConfig: { audioEncoding: settings.audioEncoding, speakingRate: settings.speakingRate },
    };
  }

  /** HTTP-Status und Fehlerkörper der Google-API → [Code, verständliche deutsche Meldung]. */
  function classifyError(status, body) {
    const err = body && body.error ? body.error : {};
    const message = String(err.message || '');
    const details = Array.isArray(err.details) ? err.details : [];
    const reason = (details.map((d) => d && d.reason).find(Boolean)) || '';

    if (status === 400 && (reason === 'API_KEY_INVALID' || /api key not valid/i.test(message))) {
      return ['API_KEY_INVALID', 'Der API-Key ist ungültig. Prüfe ihn in den Optionen.'];
    }
    if (status === 401 || status === 403) {
      if (reason === 'SERVICE_DISABLED' || /has not been used|is disabled|not enabled/i.test(message)) {
        return ['API_DISABLED', 'Die „Cloud Text-to-Speech API“ ist im Google-Cloud-Projekt des Keys nicht aktiviert.'];
      }
      if (/billing/i.test(message)) {
        return ['BILLING', 'Für das Google-Cloud-Projekt ist keine Abrechnung aktiviert (für die Text-to-Speech API erforderlich).'];
      }
      return ['PERMISSION', 'Zugriff verweigert. Prüfe die Einschränkungen des API-Keys: Er muss die Cloud Text-to-Speech API erlauben.'];
    }
    if (status === 429) return ['QUOTA', 'Kontingent oder Rate-Limit von Google TTS überschritten. Versuche es später erneut.'];
    if (status === 400) {
      return ['BAD_REQUEST', `Google TTS lehnt die Anfrage ab: ${message || 'ungültige Parameter'}. Prüfe Sprache und Stimme in den Optionen.`];
    }
    if (status >= 500) return ['SERVER', 'Der Google-TTS-Dienst ist vorübergehend nicht verfügbar.'];
    return [`HTTP_${status}`, `Google TTS antwortete mit HTTP ${status}${message ? `: ${message}` : ''}.`];
  }

  async function request(fetchImpl, url, init) {
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new TtsError('NETWORK', 'Keine Verbindung zu texttospeech.googleapis.com. Prüfe Netzwerk, VPN und Firewall.');
    }
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok) {
      const [code, message] = classifyError(res.status, body);
      throw new TtsError(code, message);
    }
    return body;
  }

  /** Text → Audio. Gibt die Audiodaten Base64-kodiert zurück. */
  async function synthesize({ text, settings, fetchImpl, signal }) {
    const body = await request(fetchImpl, `${ENDPOINT}/text:synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': settings.apiKey },
      body: JSON.stringify(buildSynthesizeRequest({ text, settings })),
      signal,
    });
    const audio = body && typeof body.audioContent === 'string' ? body.audioContent : '';
    if (!audio) throw new TtsError('EMPTY_AUDIO', 'Google TTS lieferte keine Audiodaten.');
    return audio;
  }

  const RANKS = ['Chirp3-HD', 'Chirp-HD', 'Studio', 'Neural2', 'Wavenet', 'Polyglot', 'Standard'];

  /** Kleiner Wert = höhere Qualität. */
  function voiceRank(name) {
    const i = RANKS.findIndex((r) => String(name).includes(`-${r}`));
    return i === -1 ? RANKS.length : i;
  }

  /** Verfügbare Stimmen für eine Sprache, beste Qualität zuerst. */
  async function listVoices({ apiKey, languageCode, fetchImpl }) {
    const body = await request(fetchImpl, `${ENDPOINT}/voices?languageCode=${encodeURIComponent(languageCode)}`, {
      headers: { 'X-Goog-Api-Key': apiKey },
    });
    const voices = Array.isArray(body && body.voices) ? body.voices : [];
    return voices
      .filter((v) => v && typeof v.name === 'string')
      .map((v) => ({ name: v.name, gender: v.ssmlGender || '', type: RANKS[voiceRank(v.name)] || 'Sonstige' }))
      .sort((a, b) => voiceRank(a.name) - voiceRank(b.name) || a.name.localeCompare(b.name));
  }

  return { ENDPOINT, TtsError, localeOf, buildSynthesizeRequest, classifyError, synthesize, listVoices, voiceRank };
});
