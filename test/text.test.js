'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const text = require('../src/lib/text.js');

test('cleanSummaryText entfernt Zeitstempel am Zeilenanfang und in Klammern', () => {
  const out = text.cleanSummaryText(['0:00 Einführung', '(1:25) Zutaten', '[12:03] Fazit', '1:02:45 – Ausblick'].join('\n'));
  assert.equal(out, ['Einführung.', 'Zutaten.', 'Fazit.', 'Ausblick.'].join('\n'));
});

test('cleanSummaryText entfernt Zeitbereiche und nachgestellte Zeitstempel', () => {
  assert.equal(text.cleanSummaryText('0:00 - 2:15 Intro'), 'Intro.');
  assert.equal(text.cleanSummaryText('Die Methode wird erklärt (3:45)'), 'Die Methode wird erklärt.');
});

test('cleanSummaryText lässt Uhrzeiten mitten im Satz stehen', () => {
  assert.equal(text.cleanSummaryText('Der Stream beginnt um 10:30 Uhr.'), 'Der Stream beginnt um 10:30 Uhr.');
});

test('cleanSummaryText entfernt Markdown, Listenzeichen, Links und Emojis', () => {
  const raw = ['## Überblick', '**Wichtig:** das *Ergebnis* zählt', '- Punkt eins', '1. Punkt zwei', '• Punkt drei', '[Quelle](https://example.com/x)', 'Siehe https://example.com/a 🎉'].join('\n');
  assert.equal(
    text.cleanSummaryText(raw),
    ['Überblick.', 'Wichtig: das Ergebnis zählt.', 'Punkt eins.', 'Punkt zwei.', 'Punkt drei.', 'Quelle.', 'Siehe.'].join('\n'),
  );
});

test('cleanSummaryText verwirft Hinweise und Oberflächentexte', () => {
  const raw = ['Das ist der Inhalt.', 'Gemini kann Fehler machen. Überprüfe die Antworten.', 'AI-generated content', 'Copy', 'Good response', '👍'].join('\n');
  assert.equal(text.cleanSummaryText(raw), 'Das ist der Inhalt.');
});

test('cleanSummaryText entfernt doppelte lange Zeilen (versteckte Kopien)', () => {
  const line = 'Dieser Satz kommt in der Seite zweimal vor, einmal sichtbar und einmal für Screenreader.';
  assert.equal(text.cleanSummaryText(`${line}\n${line}`), line);
});

test('cleanSummaryText ergänzt fehlende Satzzeichen nur wenn nötig', () => {
  assert.equal(text.cleanSummaryText('Mit Punkt.\nOhne Punkt\nFrage?'), 'Mit Punkt.\nOhne Punkt.\nFrage?');
});

test('cleanSummaryText gibt für leere Eingaben eine leere Zeichenkette zurück', () => {
  assert.equal(text.cleanSummaryText(''), '');
  assert.equal(text.cleanSummaryText(null), '');
  assert.equal(text.cleanSummaryText('   \n 🎉 \n'), '');
});

test('truncateAtSentence kürzt am Satzende, wenn möglich', () => {
  const t = 'Erster Satz ist lang genug. Zweiter Satz folgt hier. Dritter Satz wird abgeschnitten werden.';
  assert.equal(text.truncateAtSentence(t, 60), 'Erster Satz ist lang genug. Zweiter Satz folgt hier.');
  assert.equal(text.truncateAtSentence(t, 1000), t);
});

test('truncateAtSentence fällt auf Wortgrenzen zurück', () => {
  const out = text.truncateAtSentence('eins zwei drei vier fünf sechs sieben', 20);
  assert.ok(out.length <= 20);
  assert.ok(!out.endsWith(' '));
  assert.ok('eins zwei drei vier fünf sechs sieben'.startsWith(out));
});

test('splitIntoChunks hält die Byte-Grenze ein (auch mit Umlauten) und verliert keinen Text', () => {
  const sentence = 'Dies ist ein längerer Satz mit Umlauten wie ä, ö, ü und ß.';
  const input = Array.from({ length: 60 }, () => sentence).join(' ');
  const chunks = text.splitIntoChunks(input, 300);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(text.utf8Length(c) <= 300, `Stück zu groß: ${text.utf8Length(c)}`);
  assert.equal(chunks.join(' '), input);
});

test('splitIntoChunks teilt überlange Sätze an Wortgrenzen, überlange Wörter hart', () => {
  const longSentence = Array.from({ length: 100 }, (_, i) => `wort${i}`).join(' ');
  for (const c of text.splitIntoChunks(longSentence, 120)) assert.ok(text.utf8Length(c) <= 120);

  const giant = 'ä'.repeat(500); // 1000 Bytes ohne Leerzeichen
  const parts = text.splitIntoChunks(giant, 100);
  for (const c of parts) assert.ok(text.utf8Length(c) <= 100);
  assert.equal(parts.join(''), giant);
});

test('splitIntoChunks: kleine Eingaben ergeben genau ein Stück, leere keins', () => {
  assert.deepEqual(text.splitIntoChunks('Hallo Welt.'), ['Hallo Welt.']);
  assert.deepEqual(text.splitIntoChunks(''), []);
  assert.deepEqual(text.splitIntoChunks('  \n '), []);
});

test('splitIntoChunks respektiert die 5000-Byte-Grenze der Google-API mit Standardwert', () => {
  const input = Array.from({ length: 400 }, (_, i) => `Satz Nummer ${i} mit etwas Text.`).join(' ');
  for (const c of text.splitIntoChunks(input)) assert.ok(text.utf8Length(c) < 5000);
});

test('diffLines liefert nur neue Zeilen und beachtet Mehrfachvorkommen', () => {
  const baseline = ['Titel', 'Hinweis', 'Hinweis'];
  const current = ['Titel', 'Frage', 'Hinweis', 'Antwort', 'Hinweis', 'Hinweis'];
  assert.deepEqual(text.diffLines(baseline, current), ['Frage', 'Antwort', 'Hinweis']);
});

test('splitIntoChunks trennt nicht innerhalb von Sprachmarken – auch nicht an Punkt oder Leerzeichen darin', () => {
  const input = 'Erster Satz. Dann spricht {it|Dr. Di Gianantonio} über das {en|Pull Request}. Ende.';
  assert.deepEqual(text.splitIntoChunks(input, 45), [
    'Erster Satz.',
    'Dann spricht {it|Dr. Di Gianantonio} über',
    'das {en|Pull Request}. Ende.',
  ]);
  // ohne Platzmangel bleibt alles in einem Stück
  assert.deepEqual(text.splitIntoChunks(input, 1200), [input]);
});

test('splitIntoChunks: in überlangen Sätzen bleiben Markierungen ganze Wörter', () => {
  const sentence = `${'wort '.repeat(20)}{en|Pull Request} `.repeat(3).trim() + '.';
  const chunks = text.splitIntoChunks(sentence, 130);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(text.utf8Length(chunk) <= 130);
    assert.equal((chunk.match(/\{/g) || []).length, (chunk.match(/\}/g) || []).length, `Klammern ausgeglichen in „${chunk}“`);
  }
  assert.equal(chunks.join(' '), sentence);
});

test('splitIntoChunks: eine einzelne offene oder schließende Klammer verhindert das Teilen nicht', () => {
  const input = 'Satz eins ist hier. Satz zwei } hat eine lose Klammer. Satz drei { ebenfalls.';
  const chunks = text.splitIntoChunks(input, 30);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(' '), input);
  assert.ok(chunks.every((c) => text.utf8Length(c) <= 30));
});

test('cleanSummaryText lässt Sprachmarken unverändert, auch mit Hervorhebung oder Backticks darum', () => {
  const out = text.cleanSummaryText('Das **{en|Harness}** steuert den `{en|Agent}` mit {it|Di Gianantonio}.\nUnd {en|Pull Request}');
  assert.equal(out, 'Das {en|Harness} steuert den {en|Agent} mit {it|Di Gianantonio}.\nUnd {en|Pull Request}.');
});
