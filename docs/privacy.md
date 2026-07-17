# Datenschutzerklärung — Hundehütte Bot

**Letzte Aktualisierung:** Juli 2026  
**Betreiber:** hundekuchenlive  
**Anwendung:** Hundehütte Bot (Discord Anwendung)

---

## 1. Verantwortlicher

Verantwortlich für die Datenverarbeitung im Sinne der DSGVO:

**hundekuchenlive**  
Kontakt über Discord: [hundekuchenlive Community](https://discord.gg/WfTbuyhXcJ)

---

## 2. Welche Daten werden verarbeitet?

### 2.1 Server-Konfigurationsdaten

Beim Einrichten des Bots durch Server-Administratoren werden folgende Daten
gespeichert:

| Datenkategorie | Beispiel | Zweck |
|---|---|---|
| Server-ID (Guild ID) | Numerische ID | Zuordnung der Einstellungen zum Server |
| Kanal-IDs | Numerische IDs | Willkommens-, Feedback-, Log-Kanäle |
| Rollen-IDs | Numerische IDs | Rollen-Vergabe System |
| Kategorie-IDs | Numerische IDs | Ticket-Kategorien |
| Konfigurationseinstellungen | Sprache, aktive Module | Betrieb des Bots |
| Verbotene Wörter | Textliste | Auto-Moderation |
| Custom Commands | Name, Titel, Inhalt | Benutzerdefinierte Befehle |

### 2.2 Ticket-Daten

Beim Erstellen eines Support-Tickets werden folgende Daten gespeichert:

| Datenkategorie | Zweck |
|---|---|
| Discord Kanal-ID des Tickets | Verwaltung offener Tickets |
| Discord User-ID des Erstellers | Verhinderung doppelter Tickets |
| Erstellungszeitpunkt | Nachvollziehbarkeit |

**Wichtig:** Der Inhalt von Ticket-Gesprächen wird vom Bot **nicht** gespeichert.
Gespräche finden direkt in Discord statt und unterliegen Discords eigener
Datenschutzrichtlinie.

### 2.3 Feedback-Daten

Wenn Nutzer das Feedback-System verwenden, werden folgende Daten verarbeitet:

| Datenkategorie | Zweck |
|---|---|
| Feedback-Text | Weiterleitung an das Server-Team |
| Kategorie | Sortierung des Feedbacks |
| Verbesserungsvorschlag (optional) | Weiterleitung an das Server-Team |
| Discord Username (bei nicht-anonymem Feedback) | Identifikation des Absenders |
| Zeitstempel | Nachvollziehbarkeit |

Bei **anonymem Feedback** wird kein Username gespeichert oder weitergeleitet.

### 2.4 Temporäre Sitzungsdaten

Während der Nutzung des Feedback-Formulars werden temporäre Daten im
Arbeitsspeicher des Servers gehalten:

| Datenkategorie | Speicherdauer |
|---|---|
| Discord User-ID | Bis zum Absenden oder Verwerfen des Formulars |
| Gewählte Kategorie | Bis zum Absenden oder Verwerfen des Formulars |
| Gewählte Identität (anonym/nicht-anonym) | Bis zum Absenden oder Verwerfen des Formulars |

Diese Daten werden **nicht** dauerhaft gespeichert und nach Abschluss des
Formulars automatisch gelöscht.

### 2.5 Moderationsaktionen

Bei Moderationsaktionen (Kick, Ban, Clear) werden folgende Daten in den
Bot-Logs protokolliert:

| Datenkategorie | Zweck |
|---|---|
| Discord Tag des Betroffenen | Nachvollziehbarkeit der Aktion |
| Discord Tag des Moderators | Nachvollziehbarkeit der Aktion |
| Grund der Aktion | Dokumentation |
| Zeitstempel | Nachvollziehbarkeit |

Diese Logs sind ausschließlich in der Konsole des Bot-Servers sichtbar und
werden nicht dauerhaft in einer Datenbank gespeichert.

---

## 3. Wo werden die Daten gespeichert?

Alle dauerhaft gespeicherten Daten werden in einer JSON-Datei
(`guildSettings.json`) auf dem Bot-Server gespeichert. Der Server befindet
sich in der Europäischen Union und wird von **hundekuchenlive** betrieben.

Es werden keine Daten in externen Datenbanken, Cloud-Diensten oder bei
Drittanbietern gespeichert.

---

## 4. Rechtsgrundlage der Verarbeitung

Die Datenverarbeitung erfolgt auf Basis von:

- **Art. 6 Abs. 1 lit. b DSGVO** — Verarbeitung zur Erfüllung eines Vertrages
  (Bereitstellung der Bot-Funktionen)
- **Art. 6 Abs. 1 lit. f DSGVO** — Berechtigtes Interesse am ordnungsgemäßen
  Betrieb des Bots und der Server-Verwaltung

---

## 5. Datenweitergabe an Dritte

Daten werden **nicht** an Dritte weitergegeben, verkauft oder vermietet.

Eine Ausnahme besteht lediglich wenn:
- Eine gesetzliche Verpflichtung zur Weitergabe besteht
- Die Weitergabe zur Wahrung berechtigter Interessen erforderlich ist

Die Discord-Plattform selbst verarbeitet Daten gemäß ihrer eigenen
[Datenschutzrichtlinie](https://discord.com/privacy).

---

## 6. Speicherdauer

| Datenkategorie | Speicherdauer |
|---|---|
| Server-Konfiguration | Bis zur Entfernung des Bots vom Server |
| Ticket-Daten | Bis das Ticket geschlossen wird |
| Feedback-Inhalte (im Feedback-Kanal) | Gemäß der Discord-Kanalverwaltung des Servers |
| Temporäre Sitzungsdaten | Bis zum Abschluss des jeweiligen Vorgangs |

---

## 7. Deine Rechte

Als betroffene Person hast du folgende Rechte gemäß DSGVO:

- **Auskunftsrecht (Art. 15 DSGVO)** — Du hast das Recht zu erfahren welche
  Daten über dich gespeichert sind
- **Berichtigungsrecht (Art. 16 DSGVO)** — Du hast das Recht auf Berichtigung
  unrichtiger Daten
- **Löschungsrecht (Art. 17 DSGVO)** — Du hast das Recht auf Löschung deiner Daten
- **Einschränkungsrecht (Art. 18 DSGVO)** — Du hast das Recht auf Einschränkung
  der Verarbeitung
- **Widerspruchsrecht (Art. 21 DSGVO)** — Du hast das Recht der Verarbeitung
  zu widersprechen

Zur Ausübung deiner Rechte wende dich über Discord an das Team:  
**Discord:** [hundekuchenlive Community](https://discord.gg/WfTbuyhXcJ)

---

## 8. Datensicherheit

Die gespeicherten Daten werden durch folgende Maßnahmen geschützt:

- Der Bot-Server ist durch Zugangsdaten gesichert
- Sensible Daten (Bot-Token, API-Keys) werden in Umgebungsvariablen gespeichert
  und nicht im Quellcode hinterlegt
- Der Quellcode ist in einem privaten GitHub-Repository gesichert

---

## 9. Minderjährige

Der Bot richtet sich nicht gezielt an Kinder unter 13 Jahren. Gemäß den
Discord-Nutzungsbedingungen müssen alle Nutzer mindestens 13 Jahre alt sein.

---

## 10. Änderungen dieser Datenschutzerklärung

Wir behalten uns vor, diese Datenschutzerklärung bei Änderungen der
Bot-Funktionen oder rechtlichen Anforderungen anzupassen. Die aktuelle
Version ist stets unter dieser URL abrufbar.

---

## 11. Beschwerderecht

Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.
In Deutschland ist dies der jeweilige Landesdatenschutzbeauftragte.

---

## 12. Kontakt

Bei Fragen zum Datenschutz wende dich an:  
**Discord:** [hundekuchenlive Community](https://discord.gg/WfTbuyhXcJ)
