# 🐾 Hundehütte Bot

Der offizielle Community-Discord-Bot von **hundekuchenlive** – hilfreich, informativ und ein bisschen chaotisch.

[![Discord](https://img.shields.io/badge/Discord-hundekuchenlive-5865F2?style=flat&logo=discord)](https://discord.gg/WfTbuyhXcJ)
[![Node.js](https://img.shields.io/badge/Node.js-v24-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat&logo=discord)](https://discord.js.org/)

---

## 📋 Inhaltsverzeichnis

- [Features](#-features)
- [Befehle](#-befehle)
- [Speditionsränge und Funktionspositionen](#-speditionsränge-und-funktionspositionen)
- [Installation](#-installation)
- [Konfiguration](#-konfiguration)
- [Update-Workflow](#-update-workflow)
- [Projektstruktur](#-projektstruktur)
- [Technologie-Stack](#-technologie-stack)
- [Rechtliches](#-rechtliches)

---

## ✨ Features

| Feature | Beschreibung |
|---|---|
| 👋 Willkommen | Automatische Begrüßung neuer Mitglieder |
| 🎮 Rollenvergabe | Interaktive Rollenauswahl |
| 🎫 Ticketsystem | Private Support-Kanäle |
| 📬 Feedback | Feedback über interaktive Formulare |
| 🛡️ Automoderation | Filter für Wörter, Links und Spam |
| 📢 Ankündigungen | Formatierte Community-Ankündigungen |
| 🔨 Moderation | Mitglieder verwalten und Nachrichten löschen |
| ⚙️ Custom Commands | Eigene Slash-Befehle verwalten |
| 🧩 Modulares System | Konfigurierbare Bot-Funktionen |
| 🌐 Mehrsprachigkeit | Deutsch und Englisch |
| 📊 Logging | Strukturierte Konsolenprotokolle |
| 🚛 Speditionsränge | Verwaltung der Fahrer-Rangstruktur |
| 🏢 Funktionspositionen | Separate Rollen für Leitungs-, Verwaltungs- und weitere Funktionsbereiche |
| 📝 Positionsbewerbungen | Bewerbungen mit Mindest-Rangprüfung und rollenbasierter Prüfung |
| 🔐 Berechtigungen | Zugriffskontrollen für administrative und positionsbezogene Aktionen |

---

## 💬 Befehle

Die verfügbaren Befehle hängen von der jeweiligen Konfiguration, den Berechtigungen und der Registrierung der Slash Commands ab.

### ⚙️ Administration

| Befehl | Beschreibung |
|---|---|
| `/config` | Server-Konfiguration verwalten |
| `/module` | Module und Sprache verwalten |
| `/custom create` | Eigenen Custom Command erstellen |
| `/custom delete` | Custom Command löschen |
| `/custom list` | Vorhandene Custom Commands anzeigen |
| `/bot sync` | Slash Commands synchronisieren |
| `/bot status` | Bot-Status und Laufzeit anzeigen |
| `/ets-rollen` | Speditionsränge und Funktionsrollen verwalten |

### 🎮 Community

| Befehl | Beschreibung |
|---|---|
| `/rollen-setup` | Nachricht zur Rollenauswahl veröffentlichen |
| `/ankuendigung` | Ankündigung erstellen |
| `/feedback` | Feedback an das Team senden |
| `/ticket setup` | Ticketsystem einrichten |
| `/ticket close` | Aktuelles Ticket schließen |
| `/stellenbewerbung panel` | Bewerbungs-Auswahlmenü veröffentlichen |
| `/stellenbewerbung review-kanal` | Kanal für Bewerbungsprüfungen konfigurieren |
| `/stellenbewerbung pruefer` | Zusätzliche Prüferrollen für Positionen verwalten |

### 🔨 Moderation

| Befehl | Beschreibung |
|---|---|
| `/kick` | Mitglied vom Server entfernen |
| `/ban` | Mitglied vom Server bannen |
| `/clear` | Nachrichten löschen |

### 🔧 Utility

| Befehl | Beschreibung |
|---|---|
| `/ping` | Bot-Latenz anzeigen |
| `/cmd` | Custom Command ausführen |
| `/help` | Hilfe und verfügbare Befehle anzeigen |

---

## 🚛 Speditionsränge und Funktionspositionen

Der Bot unterscheidet zwischen **Speditionsrängen** und **Funktionspositionen**. Beide werden getrennt konfiguriert und verwaltet.

### Speditionsränge

Die Speditionsränge bilden die Rangstruktur der Fahrer ab. Sie dienen unter anderem als Grundlage für Mindest-Rangprüfungen.

### Funktionspositionen

Funktionspositionen bilden Aufgaben und Verantwortungsbereiche innerhalb der Spedition ab, beispielsweise:

- Geschäftsführung und stellvertretende Geschäftsführung
- Betriebs- und Dispositionsleitung
- Buchhaltungs- und Werkstattleitung
- Ausbildungsleitung und Personalmanagement
- Event- und Konvoimanagement
- Moderation, Disposition und weitere operative Aufgaben

Die verfügbaren Positionen und ihre Voraussetzungen werden zentral in `src/config/positions.js` gepflegt. Die Speditionsränge sind in `src/config/ranks.js` definiert.

### Bewerbungsablauf

1. Die Administration veröffentlicht mit `/stellenbewerbung panel` das Auswahlmenü.
2. Mitglieder wählen eine verfügbare Position aus.
3. Der Bot prüft die Mindest-Rangvoraussetzungen und fordert die erforderlichen Bewerbungsangaben an.
4. Die Bewerbung wird im konfigurierten Prüfkanal zur Bearbeitung bereitgestellt.
5. Berechtigte Prüfer können über die vorgesehenen Interaktionen über die Bewerbung entscheiden.
6. Bei einer erfolgreichen Annahme wird die zugehörige Discord-Rolle vergeben.

Die Berechtigungsprüfung berücksichtigt die zuständigen Prüfer einer Position sowie dafür vorgesehene administrative Berechtigungen. Die genaue Konfiguration erfolgt über die Bot-Befehle und die Positionsdefinitionen.

---

## 🚀 Installation

### Voraussetzungen

- [Node.js](https://nodejs.org/) – empfohlen wird die im Projekt verwendete Version 24
- Ein Discord-Bot und eine Anwendung im [Discord Developer Portal](https://discord.com/developers/applications)
- Ein lokaler Rechner oder Server, auf dem der Bot dauerhaft ausgeführt werden kann
- Git

### Repository herunterladen

```bash
git clone https://github.com/cakeLinir/hundehuette-bot.git
cd hundehuette-bot
npm install
```

### Umgebungsvariablen

Lege im Projektstamm eine Datei namens `.env` an:

```env
TOKEN=DEIN_BOT_TOKEN
CLIENT_ID=DEINE_APPLICATION_ID
GUILD_ID=DEINE_SERVER_ID
```

| Variable | Bedeutung | Fundort |
|---|---|---|
| `TOKEN` | Geheimen Bot-Token bereitstellen | Developer Portal → Bot |
| `CLIENT_ID` | ID der Discord-Anwendung | Developer Portal → General Information |
| `GUILD_ID` | ID des Discord-Servers, sofern für die jeweilige Konfiguration benötigt | Discord: Entwicklermodus aktivieren und Server-ID kopieren |

**Sicherheit:** Die `.env`-Datei enthält vertrauliche Informationen und darf nicht in Git eingecheckt oder öffentlich geteilt werden. Verwende für öffentliche Dokumentation ausschließlich Platzhalter und Beispielkonfigurationen.

### Slash Commands registrieren

```bash
npm run deploy
```

Dieser Schritt registriert die Slash Commands bei Discord. Führe ihn nur aus, wenn die Registrierung tatsächlich erforderlich ist und du die Auswirkungen auf die Command-Registrierung geprüft hast.

### Bot starten

```bash
npm start
```

---

## ⚙️ Konfiguration

Viele Funktionen werden über Slash Commands auf dem Discord-Server eingerichtet.

Beispiele für vorhandene Konfigurationsbefehle:

```text
/config welcome
/config feedback-kanal
/config rollen-add
/rollen-setup
/ticket setup
/module sprache
/module list
```

Die konkreten Optionen und Pflichtparameter werden von Discord anhand der registrierten Command-Definitionen angezeigt.

### Bewerbungsworkflow einrichten

1. Prüfe die Funktionspositionen in `src/config/positions.js`.
2. Stelle sicher, dass die benötigten Discord-Rollen existieren.
3. Richte die Rollenverwaltung über `/ets-rollen` ein.
4. Konfiguriere den Prüfkanal über `/stellenbewerbung review-kanal`.
5. Hinterlege bei Bedarf zusätzliche Prüferrollen über `/stellenbewerbung pruefer`.
6. Veröffentliche das Auswahlmenü über `/stellenbewerbung panel`.

Die Bewerbungsfunktion benötigt die passenden Discord-Berechtigungen und eine korrekte Zuordnung der Rollen-IDs.

---

## 🔄 Update-Workflow

### Lokale Änderungen

Prüfe vor jedem Commit die Änderungen und nimm nur die Dateien auf, die tatsächlich zum Projekt gehören.

```bash
git status --short
git diff --check
git diff
```

Stelle anschließend die gewünschten Dateien gezielt bereit:

```bash
git add README.md src/config/positions.js
git diff --cached
git commit -m "Beschreibung der Änderung"
git push
```

Passe die Dateiliste an die tatsächlich beabsichtigten Änderungen an. Verwende nicht pauschal `git add .`, wenn lokale Daten, Sicherungskopien oder andere Dateien im Arbeitsverzeichnis liegen könnten.

### Server aktualisieren

Beispiel für eine vorhandene Windows-VPS-Installation mit PM2:

```powershell
Set-Location "C:\Bots\hundehuette-bot"
git pull
pm2 restart hundehuette
```

Passe Pfad und PM2-Prozessnamen an deine tatsächliche Installation an. Ein Neustart sollte nur erfolgen, wenn die Änderungen dies erfordern und der Betrieb dafür vorgesehen ist.

### Slash Commands synchronisieren

```text
/bot sync
```

Der Befehl ist für berechtigte Benutzer vorgesehen. Die Synchronisierung verändert die bei Discord registrierten Slash Commands und sollte daher bewusst ausgeführt werden.

---

## 🗂️ Projektstruktur

```text
hundehuette-bot/
├── src/
│   ├── commands/
│   │   ├── admin/
│   │   ├── community/
│   │   ├── moderation/
│   │   └── utility/
│   ├── config/
│   │   ├── ranks.js
│   │   └── positions.js
│   ├── events/
│   │   └── interactionCreate.js
│   ├── handler/
│   ├── locales/
│   └── utils/
│       ├── positionApplicationInteractions.js
│       ├── positionApplicationPermissions.js
│       └── positionApplicationStore.js
├── docs/
├── deploy-commands.js
├── index.js
├── package.json
├── package-lock.json
└── README.md
```

**Hinweise:**

- `src/config/ranks.js` enthält die Definition der Speditionsränge.
- `src/config/positions.js` enthält die Funktionspositionen und ihre Voraussetzungen.
- `src/utils/positionApplicationStore.js` verwaltet die Bewerbungsdaten.
- `src/utils/positionApplicationPermissions.js` prüft Rang- und Prüferberechtigungen.
- `src/utils/positionApplicationInteractions.js` verarbeitet die Interaktionen des Bewerbungsworkflows.
- Laufzeitdaten, lokale Umgebungsdateien und der lokale ETS-Ordner gehören nicht in das Repository.

---

## 🛠️ Technologie-Stack

| Technologie | Zweck |
|---|---|
| [Node.js](https://nodejs.org/) | JavaScript-Laufzeitumgebung |
| [discord.js](https://discord.js.org/) | Discord-API und Bot-Interaktionen |
| [dotenv](https://www.npmjs.com/package/dotenv) | Umgebungsvariablen laden |
| [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) | SQLite-Datenbank |
| [axios](https://www.npmjs.com/package/axios) | HTTP-Anfragen |
| [Express](https://expressjs.com/) | HTTP-Server, beispielsweise für Health Checks |
| [write-file-atomic](https://www.npmjs.com/package/write-file-atomic) | Atomare Schreibvorgänge für Bewerbungsdaten |
| [PM2](https://pm2.keymetrics.io/) | Prozessverwaltung auf unterstützten Serverinstallationen |

Die verbindlichen Abhängigkeiten und Versionsbereiche stehen in `package.json` und `package-lock.json`.

---

## ⚖️ Rechtliches

- [Nutzungsbedingungen](https://cakelinir.github.io/hundehuette-bot/terms)
- [Datenschutzerklärung](https://cakelinir.github.io/hundehuette-bot/privacy)

---

<div align="center">

Entwickelt mit 🐾 von **hundekuchenlive**

</div>
