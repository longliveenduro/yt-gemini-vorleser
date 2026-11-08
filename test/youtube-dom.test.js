'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dom = require('../src/lib/youtube-dom.js');
const { DEFAULT_SETTINGS, parseList } = require('../src/lib/settings.js');
const { createWatchPage } = require('./helpers/fake-youtube.js');

const askLabels = parseList(DEFAULT_SETTINGS.askLabels);
const summarizeKeywords = parseList(DEFAULT_SETTINGS.summarizeKeywords);
const opts = { askLabels, summarizeKeywords };

test('isWatchUrl erkennt nur Videoseiten auf www.youtube.com', () => {
  assert.equal(dom.isWatchUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(dom.isWatchUrl('https://www.youtube.com/watch?v=abc&t=10s'), true);
  assert.equal(dom.isWatchUrl('https://www.youtube.com/'), false);
  assert.equal(dom.isWatchUrl('https://www.youtube.com/watch'), false);
  assert.equal(dom.isWatchUrl('https://www.youtube.com/shorts/abc'), false);
  assert.equal(dom.isWatchUrl('https://evil.example/watch?v=abc'), false);
  assert.equal(dom.isWatchUrl('https://www.youtube.com.evil.example/watch?v=abc'), false);
  assert.equal(dom.isWatchUrl(''), false);
  assert.equal(dom.isWatchUrl(undefined), false);
});

test('normalizeLabel vereinheitlicht Schreibweisen', () => {
  assert.equal(dom.normalizeLabel('  Ask  '), 'ask');
  assert.equal(dom.normalizeLabel('Video\u00a0zusammenfassen.'), 'video zusammenfassen');
  assert.equal(dom.normalizeLabel(null), '');
});

test('isActionBarReady: Aktionsleiste vorhanden bzw. noch nicht gerendert', () => {
  const { document } = createWatchPage();
  assert.equal(dom.isActionBarReady(document), true);
  document.querySelector('#top-level-buttons-computed').textContent = '';
  assert.equal(dom.isActionBarReady(document), false);
});

test('findAskButton findet den Button über aria-label (EN) und Text (DE)', () => {
  const en = createWatchPage({ askLabel: 'Ask' });
  assert.equal(dom.findAskButton(en.document, opts).id, 'ask');
  const de = createWatchPage({ askLabel: 'Fragen' });
  assert.equal(dom.findAskButton(de.document, opts).id, 'ask');
  const lower = createWatchPage({ askLabel: 'ASK' });
  assert.equal(dom.findAskButton(lower.document, opts).id, 'ask');
});

test('findAskButton: unbekannte Beschriftung wird erst über die Liste bzw. den Selektor gefunden', () => {
  const { document } = createWatchPage({ askLabel: 'Zeig mal' });
  assert.equal(dom.findAskButton(document, opts), null);
  assert.equal(dom.findAskButton(document, { askLabels: [...askLabels, 'Zeig mal'] }).id, 'ask');
  assert.equal(dom.findAskButton(document, { askLabels, askButtonSelector: '#ask' }).id, 'ask');
});

test('findAskButton: ungültiger Selektor führt nicht zum Absturz', () => {
  const { document } = createWatchPage();
  assert.equal(dom.findAskButton(document, { askLabels, askButtonSelector: '###' }).id, 'ask');
});

test('findAskButton: ohne Ask-Button (Geofencing) → null; „Teilen“ und „Download“ werden nie getroffen', () => {
  const { document } = createWatchPage({ askLabel: null });
  assert.equal(dom.findAskButton(document, opts), null);
});

test('findAskButton ignoriert versteckte Buttons', () => {
  const { document } = createWatchPage();
  document.getElementById('ask').style.display = 'none';
  assert.equal(dom.findAskButton(document, opts), null);
});

test('findAskButton sucht nur unter dem Video, nicht in der Kopfzeile', () => {
  const { document } = createWatchPage({ askLabel: null });
  const stray = document.createElement('button');
  stray.setAttribute('aria-label', 'Ask');
  document.querySelector('ytd-masthead').appendChild(stray);
  assert.equal(dom.findAskButton(document, opts), null);
});

test('locateAskUi: geschlossenes Panel → null, Transkript-Panel mit Suchfeld wird ignoriert', () => {
  const { document } = createWatchPage();
  assert.equal(dom.locateAskUi(document, opts), null);
});

test('locateAskUi: offenes Panel liefert Panel, Chip und Eingabefeld', () => {
  const page = createWatchPage({ panelOpen: true });
  const ui = dom.locateAskUi(page.document, opts);
  assert.equal(ui.panel.id, 'ask-panel');
  assert.equal(ui.chip.textContent, 'Summarize the video');
  assert.equal(ui.input.tagName, 'TEXTAREA');
});

test('locateAskUi: panelSelector hat Vorrang', () => {
  const page = createWatchPage({ panelOpen: true, panelTargetId: 'irgendwas' });
  const ui = dom.locateAskUi(page.document, { ...opts, panelSelector: '#ask-panel' });
  assert.equal(ui.panel.id, 'ask-panel');
});

test('findSummarizeChip erkennt Beschriftungen in mehreren Sprachen und überspringt andere Vorschläge', () => {
  const labels = ['Summarize the video', 'Summarise the video', 'Video zusammenfassen', 'Résumer la vidéo', 'Resumir el video', 'Riassumi il video', '동영상 요약'];
  for (const chipLabel of labels) {
    const page = createWatchPage({ panelOpen: true, chipLabel });
    const chip = dom.findSummarizeChip(page.panel, summarizeKeywords);
    assert.ok(chip, `Chip „${chipLabel}“ nicht gefunden`);
    assert.equal(chip.textContent, chipLabel);
  }
  const none = createWatchPage({ panelOpen: true, chipLabel: null });
  assert.equal(dom.findSummarizeChip(none.panel, summarizeKeywords), null);
});

test('findPromptInput ignoriert Kommentarfeld und Suchfelder', () => {
  const page = createWatchPage({ panelOpen: true });
  assert.equal(dom.findPromptInput(page.panel).tagName, 'TEXTAREA');
  assert.equal(dom.findPromptInput(page.document.querySelector('ytd-comments')), null);
  const noInput = createWatchPage({ panelOpen: true, withInput: false });
  assert.equal(dom.findPromptInput(noInput.panel), null);
});

test('setPromptText schreibt in textarea und löst input-Ereignis aus', () => {
  const page = createWatchPage({ panelOpen: true });
  const input = dom.findPromptInput(page.panel);
  let fired = 0;
  input.addEventListener('input', () => { fired += 1; });
  dom.setPromptText(input, 'Hallo Gemini');
  assert.equal(input.value, 'Hallo Gemini');
  assert.equal(fired, 1);
});

test('setPromptText schreibt auch in contenteditable-Felder', () => {
  const { document } = createWatchPage();
  const div = document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  document.body.appendChild(div);
  let fired = 0;
  div.addEventListener('input', () => { fired += 1; });
  dom.setPromptText(div, 'Hallo');
  assert.equal(div.textContent, 'Hallo');
  assert.equal(fired, 1);
});

test('submitPrompt nutzt den Senden-Button, sonst Enter – und kein „Send feedback“', () => {
  const withButton = createWatchPage({ panelOpen: true });
  const input = dom.findPromptInput(withButton.panel);
  dom.setPromptText(input, 'Frage 1');
  assert.equal(dom.submitPrompt(withButton.panel, input), 'button');
  assert.deepEqual(withButton.state.sent, ['Frage 1']);

  const noButton = createWatchPage({ panelOpen: true, withSendButton: false });
  const input2 = dom.findPromptInput(noButton.panel);
  dom.setPromptText(input2, 'Frage 2');
  assert.equal(dom.submitPrompt(noButton.panel, input2), 'enter');
  assert.deepEqual(noButton.state.sent, ['Frage 2']);

  const feedback = createWatchPage({ panelOpen: true, withSendButton: false });
  const fb = feedback.document.createElement('button');
  fb.setAttribute('aria-label', 'Send feedback');
  feedback.panel.appendChild(fb);
  assert.equal(dom.findSendButton(feedback.panel), null);
});

test('collectText: Zeilen je Block, Inline-Text zusammengezogen, Buttons/Skripte/Verstecktes ausgelassen', () => {
  const { document } = createWatchPage();
  const box = document.createElement('div');
  box.innerHTML = `
    <p>Erster <b>fette</b> Absatz</p>
    <ul><li><a href="#">0:00</a> Punkt</li></ul>
    <button>Kopieren</button>
    <div role="button">Auch Button</div>
    <div style="display:none">unsichtbar</div>
    <div aria-hidden="true">versteckt</div>
    <script>var x = 1;</script>
    <textarea>Eingabe</textarea>
    Text<br>nach Umbruch`;
  document.body.appendChild(box);
  assert.deepEqual(dom.collectText(box), ['Erster fette Absatz', '0:00 Punkt', 'Text', 'nach Umbruch']);
});

test('isSignedIn: angemeldet / abgemeldet / unklar', () => {
  assert.equal(dom.isSignedIn(createWatchPage({ signedIn: true }).document), true);
  assert.equal(dom.isSignedIn(createWatchPage({ signedIn: false }).document), false);
  const unknown = createWatchPage();
  unknown.document.querySelector('#avatar-btn').remove();
  assert.equal(dom.isSignedIn(unknown.document), null);
});

test('detectCountry liest das Länderkürzel aus den YouTube-Konfigurationsdaten', () => {
  assert.equal(dom.detectCountry(createWatchPage({ country: 'DE' }).document), 'DE');
  assert.equal(dom.detectCountry(createWatchPage({ country: 'US' }).document), 'US');
  const none = createWatchPage();
  none.document.querySelectorAll('script').forEach((s) => s.remove());
  assert.equal(dom.detectCountry(none.document), null);
});

test('pauseMainVideo pausiert nur ein laufendes Video', () => {
  const { document } = createWatchPage();
  const video = document.querySelector('video');
  let paused = 0;
  video.pause = () => { paused += 1; };
  Object.defineProperty(video, 'paused', { value: true, configurable: true });
  assert.equal(dom.pauseMainVideo(document), false);
  Object.defineProperty(video, 'paused', { value: false, configurable: true });
  assert.equal(dom.pauseMainVideo(document), true);
  assert.equal(paused, 1);
});

test('debugSnapshot liefert Beschriftungen und Panel-Infos für die Fehlersuche', () => {
  const page = createWatchPage({ panelOpen: true });
  const snap = dom.debugSnapshot(page.document);
  assert.equal(snap.signedIn, true);
  assert.equal(snap.country, 'DE');
  assert.ok(snap.actionButtons.includes('share'));
  assert.ok(snap.actionButtons.includes('ask'));
  const ask = snap.panels.find((p) => p.targetId === 'engagement-panel-ask');
  assert.equal(ask.visible, true);
  assert.equal(ask.hasInput, true);
  assert.ok(ask.buttons.includes('summarize the video'));
});

test('queryAllDeep findet Elemente in offenen Shadow-Roots', () => {
  const { document } = createWatchPage();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button class="tief">Tief</button>';
  const found = dom.queryAllDeep(document, 'button.tief');
  assert.equal(found.length, 1);
  assert.equal(found[0].textContent, 'Tief');
});

test('findShareButton erkennt „Teilen“ in mehreren Sprachen', () => {
  const { document } = createWatchPage();
  assert.equal(dom.findShareButton(document).getAttribute('aria-label'), 'Share');
  document.querySelector('[aria-label="Share"]').setAttribute('aria-label', 'Teilen');
  assert.equal(dom.findShareButton(document).getAttribute('aria-label'), 'Teilen');
  document.querySelector('[aria-label="Teilen"]').remove();
  assert.equal(dom.findShareButton(document), null);
});

test('findButtonSlot: der Eintrag der Aktionsleiste hinter „Ask“ – mit und ohne Wrapper-Elemente', () => {
  const plain = createWatchPage();
  assert.equal(dom.findButtonSlot(plain.document, opts), plain.document.getElementById('ask'));

  const wrapped = createWatchPage({ wrapButtons: true });
  const slot = dom.findButtonSlot(wrapped.document, opts);
  assert.equal(slot.tagName.toLowerCase(), 'button-view-model');
  assert.equal(slot.parentElement.id, 'top-level-buttons-computed');
});

test('findButtonSlot: ohne „Ask“ wird „Teilen“ genommen, ohne beides null', () => {
  const noAsk = createWatchPage({ askLabel: null });
  assert.equal(dom.findButtonSlot(noAsk.document, opts), noAsk.document.querySelector('[aria-label="Share"]'));
  noAsk.document.querySelector('[aria-label="Share"]').remove();
  assert.equal(dom.findButtonSlot(noAsk.document, opts), null);
});

test('inputIsEmpty und clearPromptText arbeiten mit textarea und contenteditable', () => {
  const page = createWatchPage({ panelOpen: true });
  const textarea = dom.findPromptInput(page.panel);
  assert.equal(dom.inputIsEmpty(textarea), true);
  dom.setPromptText(textarea, 'Text');
  assert.equal(dom.inputIsEmpty(textarea), false);
  let fired = 0;
  textarea.addEventListener('input', () => { fired += 1; });
  dom.clearPromptText(textarea);
  assert.equal(textarea.value, '');
  assert.equal(dom.inputIsEmpty(textarea), true);
  assert.equal(fired, 1);

  const div = page.document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  page.document.body.appendChild(div);
  dom.setPromptText(div, 'Hallo');
  assert.equal(dom.inputIsEmpty(div), false);
  dom.clearPromptText(div);
  assert.equal(dom.inputIsEmpty(div), true);
  assert.equal(div.textContent, '');
});

test('parseClock liest Uhrzeitformen und lehnt alles andere ab', () => {
  assert.equal(dom.parseClock('1:02:03'), 3723);
  assert.equal(dom.parseClock(' 12:34 '), 754);
  assert.equal(dom.parseClock('0:45'), 45);
  assert.equal(dom.parseClock('10:00:00'), 36000);
  for (const bad of ['LIVE', '', undefined, null, '5', '1:2:3', '10:5', '1:02:03:04', 'abc 1:02']) assert.equal(dom.parseClock(bad), null, String(bad));
});

test('parseIsoDuration liest ISO-8601-Dauern wie in den Metadaten der Seite', () => {
  assert.equal(dom.parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(dom.parseIsoDuration('PT21M34S'), 1294);
  assert.equal(dom.parseIsoDuration('PT45S'), 45);
  assert.equal(dom.parseIsoDuration('PT1H'), 3600);
  assert.equal(dom.parseIsoDuration('PT12.6S'), 13);
  assert.equal(dom.parseIsoDuration('P1DT2H'), 93600);
  for (const bad of ['PT0S', 'P0D', 'PT', '', 'garbage', undefined, null]) assert.equal(dom.parseIsoDuration(bad), null, String(bad));
});

test('getVideoDurationSec: nimmt die Länge des Hauptvideos (gerundet)', () => {
  const { document } = createWatchPage({ durationSec: 1234.6 });
  assert.equal(dom.getVideoDurationSec(document), 1235);
});

test('getVideoDurationSec: ohne geladenes Video (NaN) hilft die Zeitanzeige des Players', () => {
  const { document } = createWatchPage();
  assert.equal(dom.getVideoDurationSec(document), null);
  document.body.insertAdjacentHTML('beforeend', '<div class="ytp-time-display"><span class="ytp-time-current">0:05</span> / <span class="ytp-time-duration">1:02:03</span></div>');
  assert.equal(dom.getVideoDurationSec(document), 3723);
});

test('getVideoDurationSec: Livestreams (unendliche Länge, „LIVE“) ergeben null', () => {
  const { document } = createWatchPage({ durationSec: Infinity });
  document.body.insertAdjacentHTML('beforeend', '<span class="ytp-time-duration">LIVE</span>');
  assert.equal(dom.getVideoDurationSec(document), null);
  const { document: empty } = createWatchPage({ durationSec: 0 });
  assert.equal(dom.getVideoDurationSec(empty), null);
});

test('getVideoDurationSec: läuft Werbung, zählt nur die Länge aus den Metadaten der Seite', () => {
  const { document } = createWatchPage({ durationSec: 15 }); // das Videoelement spielt gerade die Werbung
  document.body.insertAdjacentHTML('beforeend', '<div id="movie_player" class="html5-video-player ad-showing"></div><span class="ytp-time-duration">0:15</span>');
  assert.equal(dom.getVideoDurationSec(document), null, 'Werbung ohne Metadaten: unbekannt, nicht 15 Sekunden');
  document.head.insertAdjacentHTML('beforeend', '<meta itemprop="duration" content="PT42M10S" />');
  assert.equal(dom.getVideoDurationSec(document), 2530);
  // nach der Werbung zählt wieder das Video selbst
  document.getElementById('movie_player').classList.remove('ad-showing');
  assert.equal(dom.getVideoDurationSec(document), 15);
});

test('getVideoDurationSec: Metadaten sind die letzte Rückfallebene', () => {
  const { document } = createWatchPage();
  document.head.insertAdjacentHTML('beforeend', '<meta itemprop="duration" content="PT5M" />');
  assert.equal(dom.getVideoDurationSec(document), 300);
});
