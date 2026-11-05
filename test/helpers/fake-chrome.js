'use strict';

/*
 * Ein minimales Fake von `chrome` und ein Lader, der src/background.js wie einen klassischen Service Worker
 * (importScripts, self) in einem vm-Kontext ausführt.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function createFakeChrome(options = {}) {
  const calls = {
    badgeText: [],
    badgeColor: [],
    runtimeMessages: [],
    tabMessages: [],
    executeScript: [],
    createDocument: [],
    openOptionsPage: 0,
  };
  const listeners = { onMessage: [], onClicked: [], onInstalled: [] };
  const offscreenContexts = [];
  let tabSendFailures = options.tabSendFailures || 0;

  const chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (p) => `chrome-extension://test-extension/${p}`,
      getManifest: () => manifest,
      getContexts: async () => offscreenContexts.slice(),
      sendMessage: async (message) => {
        calls.runtimeMessages.push(message);
        if (options.runtimeSendError) throw new Error(options.runtimeSendError);
        return { ok: true };
      },
      openOptionsPage: () => { calls.openOptionsPage += 1; },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
    },
    action: {
      setBadgeText: async (details) => { calls.badgeText.push(details); },
      setBadgeBackgroundColor: async (details) => { calls.badgeColor.push(details); },
      onClicked: { addListener: (fn) => listeners.onClicked.push(fn) },
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        calls.tabMessages.push({ tabId, message });
        if (tabSendFailures > 0) {
          tabSendFailures -= 1;
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { ok: true };
      },
    },
    scripting: { executeScript: async (details) => { calls.executeScript.push(details); } },
    offscreen: {
      createDocument: async (details) => {
        calls.createDocument.push(details);
        offscreenContexts.push({ documentUrl: chrome.runtime.getURL(details.url) });
      },
    },
    storage: {
      local: {
        get: async () => ({ settings: options.settings }),
        set: async () => {},
      },
    },
  };
  return { chrome, calls, listeners, offscreenContexts };
}

/** Führt background.js in einem vm-Kontext aus und gibt den Kontext zurück. */
function loadBackground(fake) {
  const sandbox = { chrome: fake.chrome, console, setTimeout, clearTimeout, URL, TextEncoder };
  sandbox.self = sandbox;
  sandbox.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });
  return sandbox;
}

/** Schickt eine Nachricht an alle onMessage-Listener und liefert die (asynchrone) Antwort. */
function dispatchMessage(fake, message, sender = {}) {
  return new Promise((resolve) => {
    let keepOpen = false;
    let responded = false;
    const respond = (value) => {
      responded = true;
      resolve(value);
    };
    for (const listener of fake.listeners.onMessage) {
      if (listener(message, sender, respond) === true) keepOpen = true;
    }
    if (!keepOpen && !responded) resolve(undefined);
  });
}

module.exports = { createFakeChrome, loadBackground, dispatchMessage, ROOT, SRC, manifest };
