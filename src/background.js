/*
 * Service Worker (Manifest V3).
 *  - Klick auf das Symbol → Content-Script der YouTube-Seite starten bzw. stoppen
 *  - Sprachausgabe läuft in einem Offscreen-Dokument (AUDIO_PLAYBACK), weil Service Worker kein Audio abspielen
 *    können und die Autoplay-Regeln der YouTube-Seite dort nicht greifen
 */
/* global importScripts */
importScripts('lib/settings.js', 'lib/youtube-dom.js');

const { settings: Settings, dom: Dom } = self.YTGR;

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let creatingOffscreen = null;

function setBadge(text, color, tabId) {
  const scope = tabId == null ? {} : { tabId };
  chrome.action.setBadgeText({ text, ...scope }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ color, ...scope }).catch(() => {});
}

function flashBadge(text, color, tabId, ms = 4000) {
  setBadge(text, color, tabId);
  setTimeout(() => setBadge('', undefined, tabId), ms);
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Spielt die per Google Text-to-Speech erzeugte Zusammenfassung ab.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function handleSpeak(msg, sender) {
  const settings = msg.settings ? Settings.normalizeSettings(msg.settings) : await Settings.loadSettings(chrome.storage.local);
  if (!settings.apiKey) return { ok: false, code: 'NO_API_KEY', message: 'Kein API-Key hinterlegt.' };
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!text) return { ok: false, code: 'EMPTY', message: 'Kein Text zum Vorlesen.' };

  const tabId = msg.source === 'options' ? null : sender && sender.tab ? sender.tab.id : null;
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'YTGR_PLAY', text, settings, tabId });
  } catch (e) {
    return { ok: false, code: 'OFFSCREEN', message: `Wiedergabe konnte nicht gestartet werden: ${(e && e.message) || e}` };
  }
  return { ok: true };
}

async function handleStop() {
  setBadge('', undefined);
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'YTGR_STOP' });
  } catch (_) {
    /* kein Offscreen-Dokument offen – nichts zu stoppen */
  }
}

/** Statusmeldungen des Offscreen-Dokuments → Badge und Overlay der YouTube-Seite. */
function handleTtsStatus(msg) {
  if (msg.phase === 'speaking') setBadge('TTS', '#1f7a4d');
  else if (msg.phase === 'error') flashBadge('!', '#b3261e');
  else setBadge('', undefined);

  if (msg.tabId != null) {
    chrome.tabs
      .sendMessage(msg.tabId, { type: 'YTGR_STATUS', phase: msg.phase, code: msg.code, message: msg.message })
      .catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'YTGR_SPEAK') {
    handleSpeak(msg, sender).then(sendResponse, (e) =>
      sendResponse({ ok: false, code: 'INTERNAL', message: String((e && e.message) || e) }),
    );
    return true; // asynchrone Antwort
  }
  if (msg.type === 'YTGR_STOP') {
    handleStop().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'YTGR_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'YTGR_TTS_STATUS' && msg.target === 'background') {
    handleTtsStatus(msg);
  }
  return false;
});

async function injectContentScripts(tabId) {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null || !Dom.isWatchUrl(tab.url || '')) {
    flashBadge('?', '#8a6d00', tab && tab.id);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'YTGR_TOGGLE' });
  } catch (_) {
    // Tab war schon offen, als die Erweiterung installiert/aktualisiert wurde → Skripte nachladen.
    try {
      await injectContentScripts(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: 'YTGR_TOGGLE' });
    } catch (e) {
      console.error('[YTGR] Content-Script konnte nicht gestartet werden:', e);
      flashBadge('!', '#b3261e', tab.id);
    }
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
