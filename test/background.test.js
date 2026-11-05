'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeChrome, loadBackground, dispatchMessage } = require('./helpers/fake-chrome.js');

const WATCH = 'https://www.youtube.com/watch?v=abc123';
const withKey = { settings: { apiKey: 'KEY' } };
const flush = () => new Promise((r) => setTimeout(r, 5));
// Objekte aus dem vm-Kontext haben eigene Prototypen → für deepStrictEqual in „einfache“ Objekte umwandeln.
const plain = (value) => JSON.parse(JSON.stringify(value));

function boot(options) {
  const fake = createFakeChrome(options);
  loadBackground(fake);
  return fake;
}

test('Klick auf einer Videoseite startet bzw. stoppt den Ablauf im Content-Script', async () => {
  const fake = boot();
  await fake.listeners.onClicked[0]({ id: 7, url: WATCH });
  assert.deepEqual(plain(fake.calls.tabMessages), [{ tabId: 7, message: { type: 'YTGR_TOGGLE' } }]);
  assert.equal(fake.calls.executeScript.length, 0);
});

test('Klick auf einer anderen Seite zeigt nur ein „?“-Badge und sendet nichts', async () => {
  const fake = boot();
  await fake.listeners.onClicked[0]({ id: 7, url: 'https://www.youtube.com/feed/subscriptions' });
  await fake.listeners.onClicked[0]({ id: 8, url: 'https://example.com/' });
  assert.equal(fake.calls.tabMessages.length, 0);
  assert.equal(fake.calls.badgeText[0].text, '?');
});

test('war das Content-Script noch nicht geladen, wird es nachinjiziert und der Klick wiederholt', async () => {
  const fake = boot({ tabSendFailures: 1 });
  await fake.listeners.onClicked[0]({ id: 5, url: WATCH });
  assert.equal(fake.calls.executeScript.length, 1);
  assert.equal(fake.calls.executeScript[0].target.tabId, 5);
  assert.ok(fake.calls.executeScript[0].files.includes('src/content.js'));
  assert.equal(fake.calls.tabMessages.length, 2);
});

test('scheitert auch die Injektion, wird ein „!“-Badge gezeigt statt abzustürzen', async () => {
  const fake = boot({ tabSendFailures: 5 });
  await fake.listeners.onClicked[0]({ id: 5, url: WATCH });
  assert.ok(fake.calls.badgeText.some((b) => b.text === '!'));
});

test('YTGR_SPEAK ohne API-Key: Fehlerantwort, kein Offscreen-Dokument', async () => {
  const fake = boot();
  const res = await dispatchMessage(fake, { type: 'YTGR_SPEAK', text: 'Hallo' }, { tab: { id: 3 } });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NO_API_KEY');
  assert.equal(fake.calls.createDocument.length, 0);
});

test('YTGR_SPEAK mit Key: legt genau ein Offscreen-Dokument (AUDIO_PLAYBACK) an und leitet den Text weiter', async () => {
  const fake = boot(withKey);
  const first = await dispatchMessage(fake, { type: 'YTGR_SPEAK', text: ' Hallo Welt. ' }, { tab: { id: 3 } });
  const second = await dispatchMessage(fake, { type: 'YTGR_SPEAK', text: 'Noch einmal.' }, { tab: { id: 3 } });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fake.calls.createDocument.length, 1);
  assert.deepEqual(plain(fake.calls.createDocument[0].reasons), ['AUDIO_PLAYBACK']);
  const plays = fake.calls.runtimeMessages.filter((m) => m.type === 'YTGR_PLAY');
  assert.equal(plays.length, 2);
  assert.equal(plays[0].target, 'offscreen');
  assert.equal(plays[0].text, 'Hallo Welt.');
  assert.equal(plays[0].tabId, 3);
  assert.equal(plays[0].settings.apiKey, 'KEY');
});

test('YTGR_SPEAK von der Optionsseite: eigene Einstellungen gelten, keine Tab-Zuordnung', async () => {
  const fake = boot();
  const res = await dispatchMessage(
    fake,
    { type: 'YTGR_SPEAK', source: 'options', text: 'Test', settings: { apiKey: 'FORMKEY', languageCode: 'en-US', voiceName: '' } },
    { tab: { id: 99 } },
  );
  assert.equal(res.ok, true);
  const play = fake.calls.runtimeMessages.find((m) => m.type === 'YTGR_PLAY');
  assert.equal(play.tabId, null);
  assert.equal(play.settings.apiKey, 'FORMKEY');
  assert.equal(play.settings.languageCode, 'en-US');
});

test('YTGR_SPEAK mit leerem Text wird abgelehnt', async () => {
  const fake = boot(withKey);
  const res = await dispatchMessage(fake, { type: 'YTGR_SPEAK', text: '   ' }, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, 'EMPTY');
});

test('YTGR_SPEAK meldet, wenn das Offscreen-Dokument nicht erreichbar ist', async () => {
  const fake = boot({ ...withKey, runtimeSendError: 'Receiving end does not exist' });
  const res = await dispatchMessage(fake, { type: 'YTGR_SPEAK', text: 'Hallo' }, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, 'OFFSCREEN');
});

test('YTGR_STOP wird an das Offscreen-Dokument weitergereicht und entfernt das Badge', async () => {
  const fake = boot(withKey);
  const res = await dispatchMessage(fake, { type: 'YTGR_STOP' });
  assert.equal(res.ok, true);
  assert.ok(fake.calls.runtimeMessages.some((m) => m.type === 'YTGR_STOP' && m.target === 'offscreen'));
  assert.equal(fake.calls.badgeText.at(-1).text, '');
});

test('Statusmeldungen steuern Badge und Overlay des richtigen Tabs', async () => {
  const fake = boot(withKey);
  await dispatchMessage(fake, { target: 'background', type: 'YTGR_TTS_STATUS', phase: 'speaking', tabId: 3 });
  assert.equal(fake.calls.badgeText.at(-1).text, 'TTS');
  assert.deepEqual(plain(fake.calls.tabMessages.at(-1)), { tabId: 3, message: { type: 'YTGR_STATUS', phase: 'speaking' } });

  await dispatchMessage(fake, { target: 'background', type: 'YTGR_TTS_STATUS', phase: 'done', tabId: 3 });
  assert.equal(fake.calls.badgeText.at(-1).text, '');

  await dispatchMessage(fake, { target: 'background', type: 'YTGR_TTS_STATUS', phase: 'error', code: 'QUOTA', message: 'Limit', tabId: 3 });
  assert.equal(fake.calls.badgeText.at(-1).text, '!');
  assert.equal(fake.calls.tabMessages.at(-1).message.message, 'Limit');
});

test('Statusmeldungen ohne Tab (Optionsseite) werden nicht an Tabs verteilt', async () => {
  const fake = boot(withKey);
  await dispatchMessage(fake, { target: 'background', type: 'YTGR_TTS_STATUS', phase: 'done', tabId: null });
  assert.equal(fake.calls.tabMessages.length, 0);
});

test('YTGR_OPEN_OPTIONS öffnet die Optionsseite; die Installation öffnet sie ebenfalls', async () => {
  const fake = boot();
  await dispatchMessage(fake, { type: 'YTGR_OPEN_OPTIONS' });
  assert.equal(fake.calls.openOptionsPage, 1);
  fake.listeners.onInstalled[0]({ reason: 'install' });
  assert.equal(fake.calls.openOptionsPage, 2);
  fake.listeners.onInstalled[0]({ reason: 'update' });
  assert.equal(fake.calls.openOptionsPage, 2);
  await flush();
});

test('unbekannte oder fremde Nachrichten werden ignoriert', async () => {
  const fake = boot(withKey);
  assert.equal(await dispatchMessage(fake, { type: 'ETWAS_ANDERES' }), undefined);
  assert.equal(await dispatchMessage(fake, null), undefined);
  assert.equal(await dispatchMessage(fake, 'text'), undefined);
});
