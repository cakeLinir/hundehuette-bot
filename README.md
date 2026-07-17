# 🐾 Hundehütte Bot

> Der offizielle Community Discord Bot von **hundekuchenlive** —  
> hilfreich, informativ und ein bisschen chaotisch.

[![Discord](https://img.shields.io/badge/Discord-hundekuchenlive-5865F2?style=flat&logo=discord)](https://discord.gg/WfTbuyhXcJ)
[![Node.js](https://img.shields.io/badge/Node.js-v24-339933?style=flat&logo=node.js)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat)](https://discord.js.org/)

---

## 📋 Inhaltsverzeichnis

- [Features](#-features)
- [Commands](#-commands)
- [Setup](#-setup)
- [Konfiguration](#-konfiguration)
- [Update-Workflow](#-update-workflow)
- [Tech Stack](#-tech-stack)
- [Rechtliches](#-rechtliches)

---

## ✨ Features

| Feature | Beschreibung |
|---|---|
| 👋 Willkommen | Automatische Begrüßung neuer Mitglieder |
| 🎮 Rollen-Vergabe | Rollen via interaktive Buttons |
| 🎫 Ticket System | Private Support-Kanäle per Button |
| 📬 Feedback System | Interaktives Formular mit Dropdowns & Modal |
| 🛡️ Auto Moderation | Wort-, Link- und Spam-Filter |
| 📢 Ankündigungen | Formatierte Community-Ankündigungen |
| 🔨 Moderation | Kick, Ban, Clear |
| ⚙️ Custom Commands | Eigene Slash-Befehle pro Server erstellen |
| 🧩 Modulares System | Jedes Feature pro Server aktivierbar |
| 🌐 Mehrsprachigkeit | Deutsch 🇩🇪 & Englisch 🇬🇧 |
| 📊 Logging | Farbige strukturierte Konsolen-Logs |

---

## 💬 Commands

### ⚙️ Administration
| Command | Beschreibung |
|---|---|
| `/config` | Server-Konfiguration verwalten |
| `/module` | Module & Sprache verwalten |
| `/custom create` | Custom Command erstellen |
| `/custom delete` | Custom Command löschen |
| `/custom list` | Alle Custom Commands anzeigen |
| `/bot sync` | Slash Commands synchronisieren |
| `/bot status` | Bot Status & Uptime anzeigen |

### 🎮 Community
| Command | Beschreibung |
|---|---|
| `/rollen-setup` | Rollen-Auswahl Nachricht posten |
| `/ankuendigung` | Ankündigung erstellen |
| `/feedback` | Feedback an das Team senden |
| `/ticket setup` | Ticket-System einrichten |
| `/ticket close` | Aktuelles Ticket schließen |

### 🔨 Moderation
| Command | Beschreibung |
|---|---|
| `/kick` | Mitglied vom Server kicken |
| `/ban` | Mitglied vom Server bannen |
| `/clear` | Nachrichten löschen (1-100) |

### 🔧 Utility
| Command | Beschreibung |
|---|---|
| `/ping` | Bot Latenz anzeigen |
| `/cmd` | Custom Command ausführen |
| `/help` | Alle Befehle anzeigen |

---

## 🚀 Setup

### Voraussetzungen
- [Node.js](https://nodejs.org/) v18 oder höher
- Ein [Discord Bot Token](https://discord.com/developers/applications)
- Ein Windows VPS oder lokaler Server

### Installation

    git clone https://github.com/cakeLinir/hundehuette-bot.git
    cd hundehuette-bot
    npm install

### Umgebungsvariablen

Erstelle eine `.env` Datei im Hauptordner:

    TOKEN=DEIN_BOT_TOKEN
    CLIENT_ID=DEINE_CLIENT_ID
    GUILD_ID=DEINE_SERVER_ID

| Variable | Beschreibung | Fundort |
|---|---|---|
| `TOKEN` | Bot Token | Developer Portal → Bot → Reset Token |
| `CLIENT_ID` | Anwendungs-ID | Developer Portal → General Information |
| `GUILD_ID` | Server ID | Rechtsklick auf Server → ID kopieren |

### Starten

    # Slash Commands registrieren (einmalig)
    npm run deploy

    # Bot starten
    npm start

---

## ⚙️ Konfiguration

Nach dem Start den Bot auf dem Server einrichten:

    /config welcome #kanal
    /config feedback-kanal #kanal
    /config rollen-add rolle:@Rolle label:Name emoji:🎮
    /rollen-setup
    /ticket category kategorie-id:ID
    /ticket setup #kanal
    /config automod aktiv:True
    /module sprache sprache:Deutsch
    /module list

---

## 🔄 Update-Workflow

### Lokale Entwicklung

    git add .
    git commit -m "Beschreibung der Änderung"
    git push

### VPS updaten

    cd C:\Bots\hundehuette-bot
    git pull
    pm2 restart hundehuette

### Neue Commands synchronisieren

    /bot sync

---

## 🛠️ Tech Stack

| Technologie | Version | Zweck |
|---|---|---|
| [Node.js](https://nodejs.org/) | v24 | Laufzeitumgebung |
| [discord.js](https://discord.js.org/) | v14 | Discord API Bibliothek |
| [dotenv](https://www.npmjs.com/package/dotenv) | v16 | Umgebungsvariablen |
| [PM2](https://pm2.keymetrics.io/) | Latest | Prozess-Manager (VPS) |

### Projektstruktur

    hundehuette-bot/
    ├── src/
    │   ├── commands/
    │   │   ├── admin/        — config, bot, module, custom
    │   │   ├── community/    — rollen, ticket, feedback, ankuendigung
    │   │   ├── moderation/   — kick, ban, clear
    │   │   └── utility/      — ping, cmd, help
    │   ├── events/           — ready, interactionCreate, guildMemberAdd, messageCreate
    │   ├── handler/          — commandHandler, eventHandler
    │   ├── locales/          — de.json, en.json
    │   └── utils/            — embedBuilder, settingsManager, moduleManager, i18n, logger
    ├── data/                 — guildSettings.json (nicht in Git)
    ├── docs/                 — GitHub Pages (Terms, Privacy)
    ├── .env                  — Secrets (nicht in Git)
    ├── deploy-commands.js
    ├── index.js
    └── package.json

---

## ⚖️ Rechtliches

- [Nutzungsbedingungen](https://cakelinir.github.io/hundehuette-bot/terms)
- [Datenschutzerklärung](https://cakelinir.github.io/hundehuette-bot/privacy)

---

<div align="center">
  Entwickelt mit 🐾 von <strong>hundekuchenlive</strong>
</div>
