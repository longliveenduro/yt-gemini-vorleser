'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageButton, HOST_ATTR } = require('../src/lib/page-button.js');
const { DEFAULT_SETTINGS, parseList } = require('../src/lib/settings.js');
const { createWatchPage } = require('./helpers/fake-youtube.js');

const askLabels = parseList(DEFAULT_SETTINGS.askLabels);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hostsOf = (document) => [...document.querySelectorAll(`[${HOST_ATTR}]`)];

function setup(pageOptions = {}, deps = {}) {
  const page = createWatchPage(pageOptions);
  const state = { clicks: 0 };
  const button = createPageButton({ document: page.document, onClick: () => { state.clicks += 1; }, debounceMs: 10, ...deps });
  button.configure({ enabled: true, askLabels, askButtonSelector: '' });
  return { page, button, state, document: page.document, host: () => hostsOf(page.document)[0] };
}

test('wird direkt hinter dem „Ask“-Button eingefügt', () => {
  const { button, document, host } = setup();
  assert.equal(button.ensure(), 'inserted');
  assert.equal(hostsOf(document).length, 1);
  assert.equal(host().previousElementSibling, document.getElementById('ask'));
  assert.equal(host().parentElement.id, 'top-level-buttons-computed');
});

test('YouTube hüllt jeden Button in ein Wrapper-Element: der Button hängt dann hinter dem Wrapper, in der Leiste', () => {
  const { button, document, host } = setup({ wrapButtons: true });
  assert.equal(button.ensure(), 'inserted');
  const wrapper = document.getElementById('ask').parentElement;
  assert.equal(wrapper.tagName.toLowerCase(), 'button-view-model');
  assert.equal(host().previousElementSibling, wrapper);
  assert.equal(host().parentElement.id, 'top-level-buttons-computed');
});

test('fehlt „Ask“ (Geofencing), hängt der Button hinter „Teilen“', () => {
  const { button, document, host } = setup({ askLabel: null });
  assert.equal(button.ensure(), 'inserted');
  const share = document.querySelector('[aria-label="Share"]');
  assert.equal(host().previousElementSibling, share);
});

test('ohne „Ask“ und ohne „Teilen“ gibt es keinen Ankerpunkt – und keinen Absturz', () => {
  const { button, document } = setup({ askLabel: null });
  document.querySelector('[aria-label="Share"]').remove();
  assert.equal(button.ensure(), 'no-anchor');
  assert.equal(hostsOf(document).length, 0);
});

test('erneutes ensure() fügt nichts doppelt ein', () => {
  const { button, document } = setup();
  button.ensure();
  assert.equal(button.ensure(), 'present');
  assert.equal(hostsOf(document).length, 1);
});

test('auf anderen Seiten als /watch (SPA-Navigation) wird der Button entfernt', () => {
  const { button, document, page } = setup();
  button.ensure();
  page.window.history.pushState({}, '', '/feed/subscriptions');
  assert.equal(button.ensure(), 'removed');
  assert.equal(hostsOf(document).length, 0);
});

test('configure({ enabled }) blendet den Button aus und wieder ein', () => {
  const { button, document } = setup();
  button.start();
  assert.equal(hostsOf(document).length, 1);
  button.configure({ enabled: false });
  assert.equal(hostsOf(document).length, 0);
  button.configure({ enabled: true });
  assert.equal(hostsOf(document).length, 1);
  button.destroy();
});

test('Klick ruft onClick auf und erreicht keine YouTube-Handler weiter oben', () => {
  const { button, document, state, host } = setup();
  button.ensure();
  let leaked = 0;
  document.addEventListener('click', () => { leaked += 1; });
  host().shadowRoot.querySelector('button').click();
  assert.equal(state.clicks, 1);
  assert.equal(leaked, 0);
});

test('setState wechselt Beschriftung, Tooltip und Darstellung', () => {
  const { button, host } = setup();
  button.ensure();
  const el = host().shadowRoot.querySelector('button');
  assert.equal(host().shadowRoot.querySelector('.label').textContent, 'Vorlesen');
  assert.match(el.getAttribute('aria-label'), /Zusammenfassung vorlesen/);
  button.setState('active');
  assert.equal(host().shadowRoot.querySelector('.label').textContent, 'Stopp');
  assert.equal(el.dataset.state, 'active');
  assert.match(el.title, /stoppen/);
  button.setState('idle');
  assert.equal(host().shadowRoot.querySelector('.label').textContent, 'Vorlesen');
  button.setState('quatsch');
  assert.equal(el.dataset.state, 'idle');
});

test('der Zustand bleibt erhalten, auch wenn der Button neu aufgebaut wird', () => {
  const { button, document, page } = setup();
  button.ensure();
  button.setState('active');
  page.window.history.pushState({}, '', '/feed/x');
  button.ensure(); // entfernt
  page.window.history.pushState({}, '', '/watch?v=abc123');
  button.ensure(); // neu aufgebaut
  assert.equal(hostsOf(document)[0].shadowRoot.querySelector('.label').textContent, 'Stopp');
});

test('Aufbau: Shadow DOM mit Stilen, echten SVG-Symbolen und YouTube-Farbvariablen', () => {
  const { button, host } = setup();
  button.ensure();
  const root = host().shadowRoot;
  assert.ok(root.querySelector('style').textContent.includes('--yt-spec-badge-chip-background'));
  const svgs = [...root.querySelectorAll('svg')];
  assert.equal(svgs.length, 2);
  assert.ok(svgs.every((s) => s.namespaceURI === 'http://www.w3.org/2000/svg'));
  assert.equal(root.querySelector('button').type, 'button');
});

test('stellt den Button wieder her, wenn YouTube die Aktionsleiste neu aufbaut', async () => {
  const { button, document, host } = setup();
  button.start();
  assert.ok(host());
  const row = document.getElementById('top-level-buttons-computed');
  const html = row.innerHTML.replace(/<span[^>]*data-ytgr-page-button[^>]*><\/span>/, '');
  row.innerHTML = html; // Neuaufbau durch YouTube: der Button ist weg
  assert.equal(hostsOf(document).length, 0);
  await wait(80);
  assert.equal(hostsOf(document).length, 1);
  assert.equal(host().previousElementSibling, document.getElementById('ask'));
  button.destroy();
});

test('ändert sich das Layout (Ask erscheint später), rückt der Button hinter „Ask“', async () => {
  const { button, document, host, page } = setup({ askLabel: null });
  button.start();
  assert.equal(host().previousElementSibling, document.querySelector('[aria-label="Share"]'));
  page.document.querySelector('[aria-label="Share"]').insertAdjacentHTML('afterend', '<button id="late" aria-label="Ask"><span>Ask</span></button>');
  host().remove(); // YouTube baut die Leiste um – der Beobachter prüft neu
  await wait(80);
  assert.equal(host().previousElementSibling, document.getElementById('late'));
  button.destroy();
});

test('verwaiste Instanz: isAlive() = false räumt auf und meldet „dead“', () => {
  let alive = true;
  const { button, document } = setup({}, { isAlive: () => alive });
  button.ensure();
  assert.equal(hostsOf(document).length, 1);
  alive = false;
  assert.equal(button.ensure(), 'dead');
  assert.equal(hostsOf(document).length, 0);
});

test('zwei Instanzen auf derselben Seite: der Rest der älteren wird entfernt, es bleibt genau ein Button', () => {
  const page = createWatchPage();
  const make = () => {
    const b = createPageButton({ document: page.document, onClick() {}, debounceMs: 10 });
    b.configure({ enabled: true, askLabels, askButtonSelector: '' });
    return b;
  };
  const first = make();
  first.ensure();
  const second = make();
  second.ensure();
  assert.equal(hostsOf(page.document).length, 1);
  assert.equal(hostsOf(page.document)[0], second.getHost());
});

test('destroy() entfernt den Button und beendet die Beobachtung', async () => {
  const { button, document } = setup();
  button.start();
  button.destroy();
  assert.equal(hostsOf(document).length, 0);
  document.body.appendChild(document.createElement('div')); // Mutation nach destroy
  await wait(60);
  assert.equal(hostsOf(document).length, 0);
});
