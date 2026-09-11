# Mittagessen-Service — Architektur

Ein eigenständiges System: ein Node.js-Server, eine PostgreSQL-Datenbank,
eine kleine Web-Oberfläche. Nichts davon hängt an einer anderen Anwendung.

## Der Stack

| Schicht | Was |
| --- | --- |
| Backend | Node.js 22, TypeScript, Fastify 5 |
| Datenbank | PostgreSQL 16, Drizzle ORM, SQL-Migrationen unter `drizzle/` |
| Frontend | React 18, Vite, Tailwind CSS; gebaut nach `web/dist`, vom Server ausgeliefert |
| Validierung | zod an jeder Systemgrenze (Umgebung, API-Eingaben, KI-Antworten) |
| Telefonie | Twilio Programmable Voice (Anruf, deutsche Spracherkennung, Sprachausgabe) über TwiML-Webhooks |
| Sprachverständnis | Claude Fable 5.1 (`claude-fable-5-1`) über das offizielle Anthropic SDK, mit Regelwerk davor |
| Echtzeit | Server-Sent Events (`GET /api/events`) |
| Tests | vitest (Domäne und Server gegen echtes PostgreSQL), Playwright (Browser) |
| Betrieb | Docker, `docker-compose.yml`, `GET /health`, strukturierte JSON-Logs (pino) |

## Was „Fable“ hier ist

Fable ist Claude Fable 5.1, Anthropics Sprachmodell. Es übernimmt genau eine
Stufe der Pipeline: einen gesprochenen Satz in einen strukturierten, per
JSON-Schema eingeschränkten Bestellentwurf zu übersetzen. Telefonie und
Spracherkennung liefert es nicht; das tut Twilio.

Die Anfrage nutzt die dokumentierte `messages.create`-Oberfläche mit
`output_config.format` (JSON-Schema); Thinking bleibt bei diesem Modell
immer eingeschaltet und wird nicht konfiguriert; `output_config.effort` steht
auf `low`, weil ein Anrufer in der Leitung wartet. Ohne API-Schlüssel läuft
nur das Regelwerk; freie Sätze werden dann nachgefragt.

## Die Pipeline

```
ANRUF
  → Twilio-Nummer                        (Telefonie, Anrufernummer, Stille-Timeouts)
  → Twilio Spracherkennung, Deutsch      (<Gather input="speech" language="de-DE">)
  → POST /api/voice/twilio               (X-Twilio-Signature geprüft)
  → Dialog-Engine (src/domain/dialog.ts) reiner Zustandsautomat
      ├─ Regelwerk (Nummern, Gerichtsnamen, Ja/Nein, „wie gestern“)   sofort
      └─ Fable (natürliche Sätze)                                     claude-fable-5-1
  → Prüfung gegen den Speiseplan von heute (immer, serverseitig)
  → Mündliche Bestätigung                (jede Bestellung)
  → orders-Tabelle                       (Transaktion)
  → Server-Sent Events                   → Dashboard und Küchenanzeige
```

Jeder Webhook-Aufruf ist für Twilio zustandslos; der Gesprächszustand liegt in
der Tabelle `calls`, Schlüssel `call_sid`.

## Provider-Abstraktion

| Schnittstelle | Umsetzung | Datei |
| --- | --- | --- |
| Telefonie (Anfrage lesen, Sprechen/Hören/Weiterleiten/Auflegen rendern) | Twilio TwiML | `src/domain/twilio.ts` |
| `OrderUnderstandingProvider` | Regelwerk `understanding.ts`, Fable `src/server/ai/fableProvider.ts`, kombiniert `CompositeUnderstanding` | `src/domain/`, `src/server/ai/` |
| Dialog-Engine (providerunabhängig) | `runTurn(state, input, ctx)` | `src/domain/dialog.ts` |

Die Engine kennt weder Twilio noch Fable noch die Datenbank. Sie bekommt
Nachschlagefunktionen (`findCustomerByCode`, `previousOrder`, `understand`)
und liefert Sätze, die nächste Aktion und Effekte (`save_order`, `alert`,
`handoff`) zurück. Der Server führt die Effekte aus.

## Datenmodell (PostgreSQL)

`users`, `sessions`, `customers`, `menu_days`, `menu_items`, `orders`,
`order_modifications`, `order_status_history`, `calls`, `alerts`,
`audit_logs`, `settings`. Fremdschlüssel überall; Indizes auf
`customer_code` (unique), `phone_number`, `order_date`, `status`,
`call_sid` (unique), `(date, position)` (unique). Bestellungen speichern
einen Schnappschuss von Gericht, Name und Zimmer.

## Rollen

* **ADMIN** — alles, einschließlich Benutzer, Einstellungen, Export und Löschung.
* **STAFF** — Bestellungen, Kunden, Speiseplan, Anrufe, Meldungen.
* **KITCHEN** — Küchenanzeige und Bestellstatus (vorwärts), sonst nichts.

Durchgesetzt in jeder Route (`requireRole`), nicht nur in der Oberfläche.

## Sicherheit und Datenschutz

* Passwörter mit scrypt; Sitzungen als zufällige 256-Bit-Cookies (httpOnly,
  SameSite=Strict, Secure), serverseitig nur als SHA-256 gespeichert.
* CSRF: SameSite-Cookie plus Origin-Prüfung plus JSON-Pflicht für alle
  schreibenden `/api`-Aufrufe; Twilio-Webhooks sind signiert.
* Rate-Limits (global und Login), Helmet-Header inkl. CSP, Body-Limit.
* Jede KI-Antwort wird gegen den Speiseplan validiert; das Modell wählt nie
  den Kunden und kann kein Gericht erfinden.
* Audit-Log für jede Änderung; Protokoll-Speicherung und Aufbewahrung
  konfigurierbar; nächtliche Löschung; Kundenexport und -löschung (DSGVO).
* Keine Audioaufnahme. Logs enthalten Kennungen, nie das Gesagte.
