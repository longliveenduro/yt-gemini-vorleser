# YouTube Gemini Vorleser

Chrome-Erweiterung für YouTube: Ein Klick auf das Symbol, und die in YouTube eingebaute Gemini-Funktion („Ask“) fasst das Video zusammen. Die Zusammenfassung wird mit **Google Text-to-Speech** vorgelesen. Ein zweiter Klick stoppt.

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

- Läuft unter **Ubuntu** (Google Chrome oder Chromium), ohne native Abhängigkeiten: Die Sprache kommt per HTTPS von Google, die Wiedergabe übernimmt der Browser.
- Zusätzlich zum Symbol in der Werkzeugleiste gibt es einen **Button „Vorlesen“ direkt in der Aktionsleiste unter dem Video** (neben „Ask“ bzw. „Teilen“).
- Die **Sprache der Zusammenfassung ist einstellbar** (Standard: Deutsch). Die Erweiterung fordert Gemini ausdrücklich dazu auf und liest in derselben Sprache vor.
- Alle Einstellungen liegen in den Optionen der Erweiterung (Sprache, API-Key, Stimme, Tempo, Prompt …).
- Ist „Ask“ nicht sichtbar, weil YouTube die Funktion in deiner Region nicht anbietet (Geofencing), weist die Erweiterung auf ein **VPN in die USA** hin.

> **Wichtig:** YouTube bietet für „Ask“ keine Programmierschnittstelle. Die Erweiterung bedient die Oberfläche wie du mit der Maus. Ändert YouTube das Layout, kann die Erkennung brechen. Deshalb sind Beschriftungen, Stichwörter und CSS-Selektoren in den Optionen einstellbar (Abschnitt [Fehlersuche](#fehlersuche)).

## Inhalt

- [So funktioniert es](#so-funktioniert-es)
- [Voraussetzungen](#voraussetzungen)
- [Installation unter Ubuntu](#installation-unter-ubuntu)
- [Google-API-Key einrichten](#google-api-key-einrichten)
- [Benutzung](#benutzung)
- [Einstellungen](#einstellungen)
- [„Ask“ nicht sichtbar: Geofencing und VPN](#ask-nicht-sichtbar-geofencing-und-vpn)
- [Fehlersuche](#fehlersuche)
- [Datenschutz, Kosten, Grenzen](#datenschutz-kosten-grenzen)
- [Entwicklung und Tests](#entwicklung-und-tests)

## So funktioniert es

1. **Klick auf das Symbol** der Erweiterung oder auf den **Button „Vorlesen“** unter dem Video, auf einer Seite `youtube.com/watch?v=…`.
2. Die Erweiterung öffnet unter dem Video „Ask“ (Gemini) und sendet einen **Prompt in der gewählten Sprache** („Fasse dieses Video in wenigen Sätzen auf Deutsch zusammen …“). Klappt das Eintippen auf der Seite nicht, klickt sie stattdessen auf den Vorschlag „Video zusammenfassen“ von YouTube (dessen Antwortsprache bestimmt YouTube) und meldet das in der Statuskarte. Dann wartet sie, bis die Antwort vollständig ist (der Text ändert sich drei Sekunden lang nicht mehr).
3. Der Antworttext wird für die Sprachausgabe bereinigt (Zeitstempel, Markdown, Links, Emojis und Hinweise wie „KI-generiert“ fliegen raus) und in Satzgruppen geteilt.
4. Jede Gruppe wird per **Google Cloud Text-to-Speech** in Sprache umgewandelt. Die erste Gruppe startet sofort, die nächste lädt schon, während die erste läuft.
5. Die Wiedergabe läuft in einem Offscreen-Dokument der Erweiterung. Das ist unabhängig von den Autoplay-Regeln der YouTube-Seite und funktioniert unter Ubuntu wie auf jedem anderen System.

Die Statuskarte unten links auf der Seite zeigt jeden Schritt, Fehler und den VPN-Hinweis.

## Voraussetzungen

| Was | Details |
| --- | --- |
| Browser | Google Chrome oder Chromium **ab Version 116** (Manifest V3, `offscreen`-API). Firefox wird nicht unterstützt. |
| YouTube | Du musst **angemeldet** sein, und „Ask“ muss unter dem Video **sichtbar** sein. Laut [YouTube-Hilfe](https://support.google.com/youtube/answer/14110396) gibt es die Funktion nur in ausgewählten Ländern und Sprachen, bei ausgewählten Videos und für angemeldete Konten ab 13 Jahren. Deutsch ist als Sprache unterstützt. Deutschland steht (Stand November 2026) nicht in der Länderliste, die USA, das Vereinigte Königreich und die Schweiz schon. |
| Google Cloud | Ein Projekt mit aktivierter **Cloud Text-to-Speech API**, aktivierter Abrechnung und einem **API-Key** ([Anleitung](#google-api-key-einrichten)). |

## Installation unter Ubuntu

Die Erweiterung wird als „entpackte Erweiterung“ geladen. Ein Store-Eintrag ist nicht nötig.

```bash
git clone https://github.com/<dein-konto>/yt-gemini-vorleser.git ~/yt-gemini-vorleser
```

Oder: das ZIP aus dem Actions-Artefakt (`yt-gemini-vorleser`) herunterladen und entpacken:

```bash
unzip yt-gemini-vorleser-1.1.0.zip -d ~/yt-gemini-vorleser
```

Dann im Browser:

1. `chrome://extensions` öffnen und oben rechts den **Entwicklermodus** einschalten.
2. **„Entpackte Erweiterung laden“** wählen und den Ordner mit der Datei `manifest.json` auswählen (bei `git clone` der Projektordner, beim ZIP der entpackte Ordner).
3. Das Puzzle-Symbol in der Werkzeugleiste anklicken und die Erweiterung **anheften**.
4. Beim ersten Start öffnet sich die Optionsseite. Trage dort den API-Key ein.

Hinweise für Ubuntu:

- **Chromium als Snap:** Lege den Ordner unter deinem Home-Verzeichnis ab (nicht in `/tmp` oder `/opt`, nicht in einem versteckten Ordner). Der Snap-Zugriff auf andere Pfade kann blockiert sein.
- **Kein Ton:** Prüfe Lautstärke und Ausgabegerät (`pavucontrol` oder die Ubuntu-Systemeinstellungen). Chrome nutzt PulseAudio bzw. PipeWire. Standard ist Ogg Opus, das Chrome und Chromium ohne zusätzliche Codec-Pakete abspielen. MP3 lässt sich in den Optionen als Alternative wählen.
- **Tastenkürzel:** Unter `chrome://extensions/shortcuts` kannst du dem Eintrag „Zusammenfassung vorlesen / stoppen“ ein Kürzel geben. Der Tastendruck wirkt wie ein Klick auf das Symbol. (Vorschlag: nicht `Alt+Shift`, das schaltet unter GNOME bei mehreren Tastaturlayouts die Eingabequelle um.)

## Google-API-Key einrichten

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen oder auswählen.
2. **Abrechnung** für das Projekt aktivieren. Die Text-to-Speech-API verlangt das auch für das Freikontingent.
3. Unter *APIs & Dienste → Bibliothek* die **Cloud Text-to-Speech API** aktivieren.
4. Unter *APIs & Dienste → Anmeldedaten* einen **API-Schlüssel** erstellen.
5. Den Schlüssel unter *API-Einschränkungen* auf **nur die Cloud Text-to-Speech API** beschränken. Referrer-Einschränkungen sind für Erweiterungen unpraktisch, weil die Anfragen von `chrome-extension://…` kommen.
6. Unter *Abrechnung → Budgets und Benachrichtigungen* ein kleines Budget mit Warnung einrichten.
7. Den Schlüssel in den Optionen eintragen und auf **„Stimme testen“** klicken.

Kosten: Google gewährt je nach Stimmentyp ein monatliches Freikontingent, danach wird pro Zeichen abgerechnet (aktuelle Zahlen: [Preisseite](https://cloud.google.com/text-to-speech/pricing)). Eine Zusammenfassung hat typischerweise 1.500 bis 4.000 Zeichen.

## Benutzung

1. Ein YouTube-Video öffnen (angemeldet, „Ask“ sichtbar).
2. Auf den Button **„Vorlesen“** unter dem Video klicken (oder auf das Symbol der Erweiterung).
3. Zuhören. Die Zusammenfassung steht außerdem im Ask-Panel von YouTube.
4. Erneut klicken (Button zeigt dann „Stopp“; oder in der Statuskarte auf „Stopp“), um abzubrechen. Das gilt auch, solange Gemini noch antwortet.

Der Button sitzt hinter „Ask“, bei fehlendem „Ask“ hinter „Teilen“, übernimmt die YouTube-Farben (hell/dunkel) und stellt sich selbst wieder her, wenn YouTube die Leiste neu aufbaut. Bei schmalen Fenstern zeigt er nur das Symbol. Abschaltbar unter *Optionen → Verhalten*; die Änderung gilt sofort, ohne Neuladen der Seite.

Ist das Ask-Panel schon offen, klickt die Erweiterung nicht noch einmal auf „Ask“ (das würde es schließen), sondern verwendet es weiter. Läuft das Video noch, wird es beim Start des Vorlesens pausiert (abschaltbar).

## Einstellungen

Rechtsklick auf das Symbol → **Optionen** (oder `chrome://extensions` → Details → Erweiterungsoptionen).

| Einstellung | Bedeutung | Standard |
| --- | --- | --- |
| **Zusammenfassung** | | |
| Sprache | Sprache, in der Gemini antworten soll **und** in der vorgelesen wird (Deutsch, English, Français, Español, Italiano, Nederlands, Polski, Português, Русский, Türkçe, 日本語, 한국어, 中文). Beim Wechsel wird eine nicht passende Stimme zurückgesetzt | Deutsch (`de-DE`) |
| Anfordern über | **Prompt** in der gewählten Sprache (empfohlen) oder der **Vorschlag „Video zusammenfassen“** von YouTube (Antwortsprache bestimmt YouTube). Klappt die gewählte Variante nicht, wird automatisch die andere versucht | Prompt |
| Eigener Prompt | Ersetzt den Standard-Prompt. Platzhalter: `{sprache}` (z. B. „Deutsch“) und `{language}` (z. B. „German“), etwa „Fasse das Video auf {sprache} in höchstens sechs Sätzen zusammen, ohne Aufzählungen.“ | leer |
| Maximale Länge | Längere Antworten werden am Satzende gekürzt | 6000 Zeichen |
| **Google Text-to-Speech** | | |
| API-Key | Schlüssel der Google Cloud Text-to-Speech API | leer |
| Stimme | Name einer Google-Stimme. „Stimmen laden“ listet alle Stimmen der gewählten Sprache, beste Qualität zuerst. Leer = Standardstimme der Sprache. Eine Stimme einer anderen Sprache wird ignoriert | `de-DE-Neural2-B` |
| Geschwindigkeit | 0,5× bis 2× | 1,0× |
| Audioformat | Ogg Opus oder MP3 | Ogg Opus |
| **Verhalten** | | |
| Video pausieren | Video anhalten, sobald vorgelesen wird | an |
| Button auf der Seite | „Vorlesen“-Button in der Aktionsleiste unter dem Video | an |
| **Erweitert** | | |
| Beschriftungen „Ask“ | Kommagetrennte Liste der Button-Beschriftungen (EN, DE und einige weitere vorbelegt) | siehe Optionen |
| Stichwörter „Zusammenfassen“ | Teilstrings der Vorschlags-Schaltfläche | siehe Optionen |
| CSS-Selektor „Ask“-Button | Hat Vorrang vor den Beschriftungen (gilt auch für die Position des Seiten-Buttons) | leer |
| CSS-Selektor Gemini-Panel | Für den Fall, dass das Panel nicht erkannt wird | leer |
| Zeitlimit | Wie lange auf Gemini gewartet wird (15 bis 300 s) | 90 s |
| Diagnose | Schreibt immer eine Momentaufnahme der Seite in die Konsole | aus |

Die Einstellungen liegen in `chrome.storage.local` (also nur in diesem Browserprofil, nicht in der Google-Kontosynchronisierung).

## „Ask“ nicht sichtbar: Geofencing und VPN

Findet die Erweiterung unter dem Video keinen „Ask“-Button (auch nicht nach einigen Sekunden Wartezeit), prüft sie, warum, und zeigt in der Statuskarte:

| Befund | Hinweis |
| --- | --- |
| Nicht bei YouTube angemeldet | „Melde dich an.“ |
| YouTube-Standort laut Seitendaten bereits **US** | Kein VPN-Rat. „Ask“ wird nur bei ausgewählten Videos und Konten angezeigt: anderes Video probieren. |
| Sonst (z. B. Standort `DE` oder nicht erkennbar) | **Warnung „vermutlich Geofencing“ mit der Empfehlung, über ein VPN mit einem Server in den USA zu gehen**, die Seite neu zu laden und erneut zu klicken. Der erkannte Standort wird angezeigt. Zusätzlich werden die anderen möglichen Ursachen genannt (Video ohne „Ask“, zu schmales Fenster, fehlende Beschriftung in den Optionen). |

So gehst du vor:

1. VPN-Verbindung zu einem Server in den USA aufbauen (unter Ubuntu z. B. mit dem Client deines Anbieters oder über NetworkManager mit OpenVPN/WireGuard).
2. YouTube-Seite neu laden (`F5`). Die Oberflächensprache kann Deutsch bleiben, denn Deutsch gehört laut YouTube-Hilfe zu den unterstützten Sprachen.
3. Prüfen, ob unter dem Video „Ask“ erscheint, und erneut auf das Symbol klicken.

Hinweis: Ob das Umgehen von Regionssperren mit den Nutzungsbedingungen von YouTube und deinem VPN-Anbieter vereinbar ist, musst du selbst prüfen. Die Verfügbarkeit ändert sich außerdem laufend (siehe die [YouTube-Hilfe](https://support.google.com/youtube/answer/14110396)).

## Fehlersuche

Die Erweiterung schreibt bei Erkennungsproblemen eine **Momentaufnahme** in die Konsole des YouTube-Tabs (`F12` → *Konsole*, Filter `YTGR`). Sie enthält den erkannten Standort, die Beschriftungen aller Buttons unter dem Video und alle Panels mit ihren Schaltflächen.

| Symptom | Lösung |
| --- | --- |
| „Ask“ ist sichtbar, wird aber nicht gefunden (Hinweis „vermutlich Geofencing“) | Rechtsklick auf den Button → *Untersuchen*. Den Wert von `aria-label` (oder den Text) in den Optionen unter *Beschriftungen „Ask“* ergänzen. Oder einen CSS-Selektor des Buttons eintragen. Bei schmalem Fenster steckt „Ask“ im ⋯-Menü: Fenster verbreitern. |
| „Gemini-Panel nicht gefunden“ | Panel untersuchen und einen Selektor eintragen, z. B. `ytd-engagement-panel-section-list-renderer[target-id*="ask"]`. In der Momentaufnahme stehen die vorhandenen Panels mit `target-id`. |
| „Weder Zusammenfassen-Schaltfläche noch Eingabefeld gefunden“ | Das Stichwort der Schaltfläche (in deiner YouTube-Sprache) unter *Stichwörter* ergänzen oder einen eigenen Prompt hinterlegen. |
| Die Zusammenfassung kommt in der falschen Sprache (z. B. Englisch) | Unter *Optionen → Zusammenfassung* die Sprache prüfen und **Anfordern über = Prompt** wählen. Der Vorschlag „Video zusammenfassen“ sendet YouTubes eigenen Prompt, dessen Sprache ich nicht beeinflussen kann. Steht in der Statuskarte „Eingabe nicht möglich – verwende den Vorschlag von YouTube“, ließ sich der Prompt auf der Seite nicht eintippen oder absenden: Dann hilft ein Blick in die Konsole-Momentaufnahme (Eingabefeld und Senden-Button des Panels) oder ein Issue. |
| Der Button „Vorlesen“ erscheint nicht oder an falscher Stelle | Er hängt hinter „Ask“, sonst hinter „Teilen“. Prüfe unter *Optionen → Verhalten*, ob er aktiviert ist. Ist die Beschriftung von „Ask“ in deiner YouTube-Sprache nicht hinterlegt und gibt es kein „Teilen“ in der Liste, findet er keinen Platz: Beschriftung bzw. CSS-Selektor des Ask-Buttons in den erweiterten Optionen ergänzen. |
| Beim ersten Benutzen blockiert ein Hinweis- oder Einwilligungsdialog von YouTube | Dialog einmal manuell bestätigen, dann erneut auf das Symbol klicken. |
| „API-Key ist ungültig“, „API nicht aktiviert“, „Abrechnung fehlt“ | Siehe [API-Key einrichten](#google-api-key-einrichten). Die Meldungen von Google werden in der Statuskarte übersetzt angezeigt. |
| Nichts passiert nach der Installation | Den YouTube-Tab einmal neu laden. (Beim ersten Klick lädt die Erweiterung ihre Skripte auch in schon offene Tabs nach.) |
| Kein Ton | Siehe [Hinweise für Ubuntu](#installation-unter-ubuntu). Die Wiedergabe-Seite siehst du unter `chrome://extensions` → Details → *Ansichten prüfen* (während der Wiedergabe). |

Bei einem Issue bitte die Momentaufnahme anhängen (sie enthält die Video-URL und keine Zugangsdaten) und den Browser samt Version nennen.

## Datenschutz, Kosten, Grenzen

- **Datenfluss:** Der bereinigte Text der Zusammenfassung wird an `texttospeech.googleapis.com` gesendet, sonst an keinen Server. Die Erweiterung hat keine eigenen Server und kein Tracking.
- **API-Key:** Er steht unverschlüsselt im lokalen Speicher deines Browserprofils und wird nur im Header `X-Goog-Api-Key` an die Google-TTS-API gesendet, nie in URLs oder Logs. Beschränke ihn in der Cloud Console auf die TTS-API und setze ein Budget.
- **Ask-Unterhaltungen:** Jede Zusammenfassung ist eine normale „Ask“-Unterhaltung in deinem Google-Konto, der Prompt der Erweiterung erscheint dort als deine Frage. Laut [YouTube-Hilfe](https://support.google.com/youtube/answer/14110396) werden mit dem Konto verbundene Unterhaltungen nach 45 Tagen gelöscht, und Menschen können Unterhaltungen prüfen.
- **Genauigkeit:** Gemini kann sich irren. Die Erweiterung liest wieder, was YouTube liefert.
- **Fragil:** Keine offizielle Schnittstelle (siehe oben). Nur Desktop-Browser, nur `www.youtube.com/watch`.
- **Nicht automatisch getestet:** gegen das echte YouTube (Anmeldung, Region, schrittweise Einführung der Funktion). Die Tests prüfen die Logik gegen eine nachgebaute Seite, siehe unten.

## Entwicklung und Tests

Voraussetzung: Node.js ≥ 20 (CI: 22 und 24). Unter Ubuntu z. B. über [nvm](https://github.com/nvm-sh/nvm), da die Paketquellen teils ältere Versionen enthalten.

```bash
npm ci          # installiert jsdom (einzige Abhängigkeit, nur für Tests)
npm test        # führt alle Tests aus (node:test)
npm run build   # erzeugt dist/yt-gemini-vorleser-<version>.zip
```

Nach Änderungen am Code unter `chrome://extensions` auf **Neu laden** klicken und den YouTube-Tab neu laden.

### Aufbau

```
manifest.json            Manifest V3
src/
  background.js          Service Worker: Klick auf Symbol, Offscreen-Dokument, Badge, Nachrichten
  content.js             Content-Script auf youtube.com: verbindet Ablauf, Anzeige und Nachrichten
  lib/
    settings.js          Standardwerte, Validierung, Sprachen, Prompt-Aufbau, chrome.storage
    text.js              Bereinigen, Kürzen, Aufteilen (UTF-8-Bytes), Zeilen-Diff
    youtube-dom.js       Ask-Button, Panel, Chips, Eingabefeld, Antworttext, Einfügestelle, Diagnose
    messages.js          Meldungstexte und Diagnose „warum fehlt Ask?“ (VPN-Hinweis)
    runner.js            Ablaufsteuerung nach dem Klick
    overlay.js           Statuskarte (Shadow DOM)
    page-button.js       Button „Vorlesen“ in der Aktionsleiste unter dem Video
    google-tts.js        REST-Client für Cloud Text-to-Speech (synthesize, voices)
    speaker.js           Stücke erzeugen und nacheinander abspielen, stoppen
  offscreen/             Offscreen-Dokument (AUDIO_PLAYBACK) für die Wiedergabe
  options/               Optionsseite
test/                    Tests mit node:test und jsdom (ca. 190 Tests)
scripts/build.js         ZIP-Build ohne Abhängigkeiten
scripts/generate-icons.py  Optional: Icons neu erzeugen (Pillow)
.github/workflows/ci.yml GitHub Actions
```

Alle `src/lib/*.js` sind klassische Skripte im UMD-Stil: Sie laufen in der Erweiterung ohne Bundler (Content-Script-Liste im Manifest, `importScripts`, `<script>`) und in den Tests per `require()`.

### Was die Tests abdecken

- **Text:** Zeitstempel, Markdown, Links, Emojis, Hinweise; Aufteilen unter der 5000-Byte-Grenze der API; Zeilen-Diff.
- **Google-TTS-Client:** Request-Aufbau, Key im Header, Fehlerübersetzung (Key ungültig, API aus, Abrechnung, Kontingent, Netzwerk), Stimmenliste. Ohne Netzwerk, mit Fake-`fetch`.
- **Sprachausgabe:** Reihenfolge, Vorab-Laden, Stopp, Ersetzen laufender Wiedergabe, Fehlerfälle.
- **YouTube-Seite (jsdom-Attrappe):** Ask-Button mit EN/DE-Beschriftung, Panel und Chips, Eingabefeld ohne Kommentar- und Suchfelder, Tippen und Absenden, Textsammlung, Anmeldestatus, Standorterkennung.
- **Gesamtablauf:** Ask öffnen → Prompt in der gewählten Sprache → vorlesen; Sprachwechsel; Rückfälle zwischen Prompt und YouTube-Vorschlag; Panel schon offen; wiederholter Lauf; eigener Prompt mit Platzhaltern; **Geofencing mit VPN-Hinweis auf die USA**; Standort US ohne VPN-Rat; nicht angemeldet; fehlender Key; Zeitlimit; Kürzen; Abbruch.
- **Service Worker:** Klick-Routing, Nachinjektion, Offscreen-Dokument genau einmal, Statusweitergabe.
- **Button auf der Seite:** Position hinter „Ask“/„Teilen“ (auch mit YouTubes Wrapper-Elementen), Selbstreparatur nach Neuaufbau der Leiste, SPA-Navigation, Zustandswechsel „Vorlesen“/„Stopp“, Aufräumen verwaister Instanzen.
- **Optionsseite** und **Offscreen-Skript** (echte HTML-Dateien in jsdom: Laden, Speichern, Stimmen laden, Test, Wiedergabe), **Content-Script** mit der Lade-Reihenfolge aus dem Manifest, **Statuskarte**, **Manifest und Struktur** (Dateien vorhanden, minimale Berechtigungen, kein `eval`/`innerHTML`, Key wird nicht geloggt), **ZIP-Build**.

Die Attrappe in `test/helpers/fake-youtube.js` ist ein Modell. Die echte Oberfläche von „Ask“ ist nicht dokumentiert und ändert sich.

### Continuous Integration

`.github/workflows/ci.yml` läuft bei Push auf `main` und bei Pull Requests auf **Ubuntu 24.04 und Ubuntu 26.04** mit **Node 22 und 24**, installiert mit `npm ci`, führt `npm test` aus und baut anschließend das ZIP, das als Artefakt bereitsteht. Die Runner-Labels sind fest gepinnt (`ubuntu-22.04` wird von GitHub abgekündigt, `ubuntu-latest` wechselt im Herbst 2026 von 24.04 auf 26.04).

Repository anlegen:

```bash
cd ~/yt-gemini-vorleser
git init -b main && git add . && git commit -m "Erste Version"
git remote add origin git@github.com:<dein-konto>/yt-gemini-vorleser.git
git push -u origin main
```

## Lizenz

MIT, siehe [LICENSE](LICENSE).
