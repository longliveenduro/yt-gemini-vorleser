/*
 * Reine Textfunktionen (kein DOM, keine Chrome-APIs).
 * UMD: YTGR.text im Browser, require() in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).text = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TS = '\\d{1,2}(?::\\d{2}){1,2}';
  const RANGE = `${TS}(?:\\s*[-–—]\\s*${TS})?`;
  const LEADING_TIMESTAMP = new RegExp(`^[\\s\\-–—•*]*[\\(\\[]?${RANGE}[\\)\\]]?\\s*[-–—:.]?\\s+`);
  const TRAILING_TIMESTAMP = new RegExp(`\\s*[\\(\\[]${RANGE}[\\)\\]]\\s*$`);
  const LIST_MARKER = /^\s*(?:[-–—•·▪●◦*]|\d{1,2}[.)])\s+/;

  // Oberflächentexte und Hinweise von Gemini/YouTube, die nicht vorgelesen werden sollen.
  const JUNK_LINES = [
    /(kann|können)\s+(manchmal\s+)?fehler\s+machen/i,
    /may\s+(display|show|make|contain)\s+(inaccurate|mistakes|errors)/i,
    /(überprüf|prüf)\w*\s+(die\s+)?(antwort|informationen|angaben)/i,
    /double[- ]check/i,
    /^(ki|ai)[- ]?(generiert|generated)/i,
    /^(copy|kopieren|share|teilen|good response|bad response|gute antwort|schlechte antwort)$/i,
  ];

  function utf8Length(s) {
    return new TextEncoder().encode(s).length;
  }

  /** Eine Zeile für die Sprachausgabe säubern; leere Zeichenkette, wenn nichts Vorlesbares übrig bleibt. */
  function cleanLine(line) {
    let s = String(line)
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // Markdown-Links zuerst, sonst frisst die URL-Regel die Klammer
      .replace(/https?:\/\/\S+/g, '')
      .replace(LIST_MARKER, '')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=$|[\s).,;:!?])/g, '$1$2')
      .replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=$|[\s).,;:!?])/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1');

    s = s.replace(LEADING_TIMESTAMP, '').replace(TRAILING_TIMESTAMP, '');
    s = s.replace(/[\p{Extended_Pictographic}\uFE0F\u200d]/gu, '');
    s = s.replace(/\s+/g, ' ').trim();

    if (!/[\p{L}\p{N}]/u.test(s)) return '';
    if (JUNK_LINES.some((re) => re.test(s))) return '';
    return /[.!?…:;]$/.test(s) ? s : `${s}.`;
  }

  /** Mehrzeiligen Gemini-Text in sauberen Vorlesetext umwandeln (eine Zeile je Absatz/Listenpunkt). */
  function cleanSummaryText(raw) {
    const seen = new Set();
    const out = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
      const cleaned = cleanLine(line);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (cleaned.length > 30 && seen.has(key)) continue; // doppelte Texte (z. B. versteckte aria-live-Kopien)
      seen.add(key);
      out.push(cleaned);
    }
    return out.join('\n');
  }

  /** Kürzt auf höchstens maxChars Zeichen, bevorzugt am Satzende. */
  function truncateAtSentence(text, maxChars) {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('.\n'));
    if (lastEnd > maxChars * 0.6) return slice.slice(0, lastEnd + 1).trim();
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
  }

  function splitLong(sentence, maxBytes) {
    if (utf8Length(sentence) <= maxBytes) return [sentence];
    const parts = [];
    let cur = '';
    for (const word of sentence.split(/\s+/)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (utf8Length(candidate) <= maxBytes) {
        cur = candidate;
        continue;
      }
      if (cur) parts.push(cur);
      if (utf8Length(word) <= maxBytes) {
        cur = word;
      } else {
        let piece = '';
        for (const ch of word) {
          if (utf8Length(piece + ch) > maxBytes) {
            parts.push(piece);
            piece = '';
          }
          piece += ch;
        }
        cur = piece;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  }

  /**
   * Teilt Text an Satzgrenzen in Stücke von höchstens maxBytes UTF-8-Bytes.
   * Die Google-TTS-REST-API erlaubt maximal 5000 Bytes pro Anfrage; kleinere Stücke starten schneller.
   */
  function splitIntoChunks(text, maxBytes = 1200) {
    const sentences = String(text || '')
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const chunks = [];
    let cur = '';
    for (const sentence of sentences) {
      for (const piece of splitLong(sentence, maxBytes)) {
        const candidate = cur ? `${cur} ${piece}` : piece;
        if (utf8Length(candidate) <= maxBytes) {
          cur = candidate;
        } else {
          if (cur) chunks.push(cur);
          cur = piece;
        }
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  /** Zeilen aus `current`, die nicht (oder seltener) in `baseline` vorkommen – Reihenfolge bleibt erhalten. */
  function diffLines(baseline, current) {
    const counts = new Map();
    for (const l of baseline) counts.set(l, (counts.get(l) || 0) + 1);
    const fresh = [];
    for (const l of current) {
      const c = counts.get(l) || 0;
      if (c > 0) counts.set(l, c - 1);
      else fresh.push(l);
    }
    return fresh;
  }

  return { utf8Length, cleanLine, cleanSummaryText, truncateAtSentence, splitIntoChunks, diffLines };
});
