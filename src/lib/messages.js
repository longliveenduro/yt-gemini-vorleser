/*
 * Texte für Hinweise und Fehler (Deutsch) sowie die Diagnose, warum „Ask“ fehlt.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).messages = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const CATALOG = {
    NOT_WATCH_PAGE: {
      tone: 'error',
      title: 'Kein YouTube-Video geöffnet',
      text: 'Öffne ein Video (youtube.com/watch?v=…) und klicke dann erneut auf das Symbol der Erweiterung.',
    },
    NO_API_KEY: {
      tone: 'error',
      title: 'Google-TTS-API-Key fehlt',
      text: 'Trage in den Optionen einen API-Key für die Google Cloud Text-to-Speech API ein.',
      options: true,
    },
    PAGE_NOT_READY: {
      tone: 'error',
      title: 'Seite noch nicht bereit',
      text: 'Die Aktionsleiste unter dem Video wurde nicht gefunden. Warte, bis die Seite vollständig geladen ist, und versuche es erneut.',
    },
    GEOFENCE: {
      tone: 'warn',
      vpn: true,
      options: true,
      title: 'Gemini-Funktion („Ask“) nicht sichtbar – vermutlich Geofencing',
      text:
        'YouTube bietet die Gemini-Funktion nur in ausgewählten Ländern an{country}. ' +
        'Verbinde dich mit einem VPN-Server in den USA, lade die Seite neu und klicke danach erneut auf das Symbol. ' +
        'Weitere mögliche Ursachen: Das Video unterstützt „Ask“ nicht, das Browserfenster ist zu schmal ' +
        '(dann steckt „Ask“ im ⋯-Menü) oder die Beschriftung des Buttons fehlt in den Optionen.',
    },
    NOT_SIGNED_IN: {
      tone: 'warn',
      title: 'Nicht bei YouTube angemeldet',
      text: 'Die Gemini-Funktion steht nur angemeldeten Konten zur Verfügung. Melde dich an und versuche es erneut.',
    },
    NOT_AVAILABLE: {
      tone: 'warn',
      options: true,
      title: '„Ask“ ist hier nicht verfügbar',
      text:
        'Dein YouTube-Standort ist bereits die USA, ein VPN hilft also nicht. YouTube zeigt „Ask“ nur bei ausgewählten Videos und Konten. ' +
        'Probiere ein anderes Video, verbreitere das Fenster (sonst steckt „Ask“ im ⋯-Menü) oder ergänze die Beschriftung in den Optionen.',
    },
    PANEL_NOT_FOUND: {
      tone: 'error',
      options: true,
      title: 'Gemini-Panel nicht gefunden',
      text:
        '„Ask“ wurde angeklickt, aber das Panel wurde nicht erkannt. YouTube hat die Oberfläche vermutlich geändert: ' +
        'Hinterlege in den Optionen einen CSS-Selektor für das Panel (README, Abschnitt „Fehlersuche“).',
    },
    NO_PROMPT_TARGET: {
      tone: 'error',
      options: true,
      title: 'Weder Zusammenfassen-Schaltfläche noch Eingabefeld gefunden',
      text:
        'Ergänze in den Optionen die Stichwörter der „Video zusammenfassen“-Schaltfläche in deiner YouTube-Sprache ' +
        'oder hinterlege einen eigenen Prompt (README, Abschnitt „Fehlersuche“).',
    },
    NO_ANSWER: {
      tone: 'error',
      title: 'Keine Antwort von Gemini',
      text: 'Gemini hat innerhalb von {sec} Sekunden keine Zusammenfassung geliefert. Versuche es erneut oder erhöhe das Zeitlimit in den Optionen.',
    },
    EMPTY_ANSWER: {
      tone: 'error',
      title: 'Zusammenfassung leer',
      text: 'Aus der Antwort von Gemini ließ sich kein vorlesbarer Text gewinnen.',
    },
    TTS_ERROR: {
      tone: 'error',
      options: true,
      title: 'Vorlesen fehlgeschlagen',
      text: '{details}',
    },
    CONTEXT_INVALIDATED: {
      tone: 'warn',
      title: 'Erweiterung wurde aktualisiert',
      text: 'Lade die Seite neu (F5) und klicke dann erneut auf das Symbol.',
    },
    UNEXPECTED: {
      tone: 'error',
      title: 'Unerwarteter Fehler',
      text: '{details}',
    },
  };

  /** Liefert Titel/Text/Optionen zu einem Fehlercode; Platzhalter {name} werden ersetzt. */
  function format(code, params) {
    const entry = CATALOG[code] || CATALOG.UNEXPECTED;
    const p = params || {};
    const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (p[k] === undefined || p[k] === null ? '' : String(p[k])));
    return {
      code: CATALOG[code] ? code : 'UNEXPECTED',
      tone: entry.tone,
      title: fill(entry.title),
      text: fill(entry.text),
      vpn: Boolean(entry.vpn),
      options: Boolean(entry.options),
    };
  }

  /**
   * Warum fehlt der „Ask“-Button?
   *  - nicht angemeldet      → NOT_SIGNED_IN
   *  - Standort bereits US   → NOT_AVAILABLE (Video/Konto, kein Geofencing)
   *  - sonst                 → GEOFENCE (VPN-Hinweis auf die USA)
   */
  function diagnoseMissingAsk({ signedIn, country }) {
    if (signedIn === false) return { code: 'NOT_SIGNED_IN', params: {} };
    if (country === 'US') return { code: 'NOT_AVAILABLE', params: {} };
    return { code: 'GEOFENCE', params: { country: country ? ` (erkannter YouTube-Standort: ${country})` : '' } };
  }

  return { CATALOG, format, diagnoseMissingAsk };
});
