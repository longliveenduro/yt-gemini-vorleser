'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createOverlay } = require('../src/lib/overlay.js');
const messages = require('../src/lib/messages.js');

function setup() {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/watch?v=x' });
  const doc = window.document;
  const calls = { stop: 0, options: 0 };
  const overlay = createOverlay(doc, { onStop: () => { calls.stop += 1; }, onOptions: () => { calls.options += 1; } });
  const shadow = () => doc.getElementById('ytgr-overlay-host').shadowRoot;
  const button = (label) => [...shadow().querySelectorAll('button')].find((b) => b.textContent === label);
  return { doc, calls, overlay, shadow, button };
}

test('status zeigt Text mit Stopp-Schaltfläche, die den Abbruch auslöst', () => {
  const { overlay, shadow, button, calls } = setup();
  overlay.status('Gemini fasst das Video zusammen …');
  assert.match(shadow().querySelector('.body').textContent, /Gemini fasst das Video zusammen/);
  assert.equal(shadow().querySelector('.card').dataset.busy, 'true');
  button('Stopp').click();
  assert.equal(calls.stop, 1);
});

test('der VPN-/Geofencing-Hinweis wird mit Titel, Text und Optionen-Schaltfläche angezeigt', () => {
  const { overlay, shadow, button, calls } = setup();
  overlay.error(messages.format('GEOFENCE', { country: ' (erkannter YouTube-Standort: DE)' }));
  const card = shadow().querySelector('.card');
  assert.equal(card.dataset.tone, 'warn');
  assert.equal(card.dataset.vpn, 'true');
  assert.match(shadow().querySelector('.title').textContent, /nicht sichtbar/);
  assert.match(shadow().querySelector('.body').textContent, /VPN-Server in den USA/);
  button('Optionen öffnen').click();
  assert.equal(calls.options, 1);
});

test('Fehler ohne Optionen-Aktion zeigen nur „Schließen“; Schließen entfernt die Karte', () => {
  const { overlay, doc, button } = setup();
  overlay.error(messages.format('NOT_WATCH_PAGE'));
  assert.equal(button('Optionen öffnen'), undefined);
  button('Schließen').click();
  assert.equal(doc.getElementById('ytgr-overlay-host'), null);
});

test('mehrfaches Anzeigen verwendet dieselbe Karte; hide() entfernt sie, danach geht es wieder', () => {
  const { overlay, doc } = setup();
  overlay.status('eins');
  overlay.status('zwei');
  assert.equal(doc.querySelectorAll('#ytgr-overlay-host').length, 1);
  overlay.hide();
  assert.equal(overlay.isShown(), false);
  overlay.status('drei');
  assert.equal(overlay.isShown(), true);
});

test('info blendet sich nach der angegebenen Zeit selbst aus', async () => {
  const { overlay, doc } = setup();
  overlay.info('Fertig', { autoHideMs: 10 });
  assert.ok(doc.getElementById('ytgr-overlay-host'));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(doc.getElementById('ytgr-overlay-host'), null);
});

test('Texte werden als Text eingesetzt, nicht als HTML', () => {
  const { overlay, shadow } = setup();
  overlay.error({ tone: 'error', title: '<img src=x onerror=alert(1)>', text: '<b>fett</b>', vpn: false, options: false });
  assert.equal(shadow().querySelector('img'), null);
  assert.equal(shadow().querySelector('.body').textContent, '<b>fett</b>');
});

test('messages.format ersetzt Platzhalter und fällt bei unbekannten Codes auf UNEXPECTED zurück', () => {
  assert.match(messages.format('NO_ANSWER', { sec: 90 }).text, /90 Sekunden/);
  assert.equal(messages.format('GIBT_ES_NICHT', { details: 'x' }).code, 'UNEXPECTED');
  assert.equal(messages.format('GEOFENCE', {}).vpn, true);
  assert.equal(messages.format('NOT_AVAILABLE').vpn, false);
});

test('diagnoseMissingAsk: Anmeldung vor Standort vor VPN-Rat', () => {
  assert.equal(messages.diagnoseMissingAsk({ signedIn: false, country: 'DE' }).code, 'NOT_SIGNED_IN');
  assert.equal(messages.diagnoseMissingAsk({ signedIn: true, country: 'US' }).code, 'NOT_AVAILABLE');
  assert.equal(messages.diagnoseMissingAsk({ signedIn: true, country: 'DE' }).code, 'GEOFENCE');
  assert.equal(messages.diagnoseMissingAsk({ signedIn: null, country: null }).code, 'GEOFENCE');
});
