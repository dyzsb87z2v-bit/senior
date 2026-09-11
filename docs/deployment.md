# Betrieb und Deployment

## 1. Umgebungsvariablen

Alle in `.env.example` beschrieben. Pflicht für den Betrieb:

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | PostgreSQL-Verbindung |
| `SESSION_SECRET` | mindestens 32 zufällige Zeichen (`openssl rand -base64 48`) |
| `PUBLIC_URL` | öffentliche https-Adresse (Cookies, CSRF, Twilio-URLs) |
| `TWILIO_AUTH_TOKEN` | Signaturprüfung der Twilio-Webhooks |
| `ANTHROPIC_API_KEY` | Fable; ohne Schlüssel nur Regelwerk |
| `LUNCH_HANDOFF_NUMBER` | Restaurant-Telefon für die Weiterleitung (oder in Einstellungen) |

In Produktion verweigert der Server den Start, wenn `PUBLIC_URL` nicht mit
`https://` beginnt oder `LUNCH_ALLOW_UNSIGNED_WEBHOOKS=true` gesetzt ist.

## 2. Datenbank und Migrationen

Schema in `src/server/db/schema.ts`, SQL-Migrationen in `drizzle/`.
Der Server wendet ausstehende Migrationen beim Start an (idempotent);
`npm run db:migrate` tut dasselbe von Hand. Neue Migration nach einer
Schemaänderung: `npm run db:generate`.

Erstes Konto: `ADMIN_EMAIL` und `ADMIN_PASSWORD` setzen, dann
`npm run db:seed` (legt den Admin nur an, wenn noch kein Benutzer existiert).

## 3. Build und Start

```bash
npm ci
npm run build              # dist/ (Server) und web/dist/ (Oberfläche)
NODE_ENV=production node dist/server/index.js
```

Oder als Container: `docker build -t senior-lunch .` und
`docker run --env-file .env -p 3000:3000 senior-lunch`; `docker-compose.yml`
startet PostgreSQL gleich mit. Ein Reverse-Proxy (Caddy, nginx, Traefik)
mit TLS davor; `trustProxy` ist aktiv, `X-Forwarded-*` wird ausgewertet.

## 4. Health-Check

`GET /health` liefert

```json
{ "status": "ok", "database": "ok", "menuItemsToday": 3, "integrations": { "twilio": true, "fable": true, "fableModel": "claude-fable-5-1", "handoffNumber": true }, "uptimeSeconds": 120 }
```

und HTTP 503 (`degraded`), wenn die Datenbank nicht antwortet oder
`TWILIO_AUTH_TOKEN` fehlt. Der Docker-Healthcheck nutzt denselben Endpunkt.

## 5. Logging

pino, eine JSON-Zeile pro Ereignis: `voice.turn` (callSid, callId, stage,
Dauer), `order.saved`, `call.handoff`, `fable.response` (Latenz, Tokens,
Cache-Treffer), `api.error`. Cookies und Passwörter werden geschwärzt; das
Gesagte erscheint nie im Log. `LOG_LEVEL` steuert die Ausführlichkeit.

## 6. Backup und Aufbewahrung

* Backup: `pg_dump` der Datenbank nach eigenem Zeitplan (täglich empfohlen),
  bei Compose z. B. `docker compose exec db pg_dump -U postgres senior_lunch > backup.sql`.
* Aufbewahrung: nächtlich um 03:30 (Europe/Berlin) löscht der Server Anrufe
  älter als `callRetentionDays`, Bestellungen älter als `orderRetentionDays`
  und erledigte Meldungen; „Aufbewahrung jetzt anwenden“ in den
  Einstellungen stößt es sofort an. Abgelaufene Sitzungen werden stündlich entfernt.
* DSGVO: Kunden → Daten exportieren (JSON) / Löschen (Anrufe gelöscht,
  Bestellungen anonymisiert). Jede Aktion steht im Audit-Log.

## 7. Twilio

Nummer → Voice → „A call comes in“: Webhook, POST, `PUBLIC_URL/api/voice/twilio`.
Status-Callback: `PUBLIC_URL/api/voice/twilio/status`. Hinter einem Tunnel
(z. B. für Tests) `LUNCH_PUBLIC_VOICE_URL`/`LUNCH_PUBLIC_STATUS_URL` auf die
in Twilio eingetragenen URLs setzen, da die Signatur die exakte URL einschließt.

Spracherkennung und Sprachausgabe sind Twilios eingebaute deutsche Modelle
(`language="de-DE"`, `speechModel="phone_call"`, `enhanced="true"`,
Stimme `Polly.Vicki`); es wird nichts aufgezeichnet.

## 8. Fable nach dem Deployment prüfen

```bash
ANTHROPIC_API_KEY=… node scripts/fable-smoke.mjs "Ich möchte das erste Essen, aber ohne Zwiebeln"
```

zeigt Modell, Latenz, Tokenverbrauch und das validierte Ergebnis.
