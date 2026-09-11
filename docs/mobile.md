# Die App auf dem Handy oder Tablet

Die Oberfläche des Mittagessen-Service ist eine installierbare Web-App
(PWA). Sie wird nicht aus einem App-Store geladen, sondern einmal von der
eigenen Adresse des Restaurants — danach liegt sie wie eine App auf dem
Startbildschirm, öffnet ohne Browserleiste und zeigt Bestellungen live.

## Voraussetzung: eine HTTPS-Adresse

Installieren geht nur von einer `https://`-Adresse. Der schnellste Weg ist
ein kleiner Server (VPS) mit Docker und einer Domain:

```bash
git clone https://github.com/dyzsb87z2v-bit/senior && cd senior
cp .env.example .env
# in .env: DOMAIN=mittag.example.de  PUBLIC_URL=https://mittag.example.de
#          SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, TWILIO_AUTH_TOKEN, ANTHROPIC_API_KEY, LUNCH_HANDOFF_NUMBER
docker compose up -d --build
docker compose exec app node dist/server/db/seed.js
```

Caddy holt das Zertifikat selbst; die DNS-Einträge der Domain müssen auf den
Server zeigen und die Ports 80 und 443 offen sein. Danach:
`https://mittag.example.de/mittag`.

## Installieren

**Android (Chrome):** Adresse öffnen, anmelden, oben rechts auf
**App installieren** tippen (oder Chrome-Menü → „App installieren“).

**iPhone / iPad (Safari):** Adresse öffnen, anmelden, Teilen-Symbol →
**Zum Home-Bildschirm**. Safari zeigt keinen Installieren-Knopf; das ist
bei Apple so.

**Windows / Mac (Chrome, Edge):** Installieren-Symbol in der Adressleiste.

## Was die App auf dem Handy kann

* HEUTE, BESTELLUNGEN, KÜCHE, KUNDEN, SPEISEPLAN, ANRUFE, EINSTELLUNGEN — je nach Rolle.
* Bestellungen erscheinen live (Ereignisstrom); nach einer Funkpause holt
  die App den Stand sofort nach.
* Neue Bestellungen werden oben eingeblendet, solange die App geöffnet ist.
  Push-Nachrichten bei geschlossener App gibt es noch nicht.

## Die eigene Handynummer

Die Handynummer gehört **nicht** in den Code. Zwei Stellen:

* **Weiterleitung ans Restaurant** (wenn ein Anrufer „Mitarbeiter“ sagt
  oder der Assistent nicht weiterkommt): EINSTELLUNGEN → *Telefonnummer für
  Weiterleitung*, im Format `+49…`. Alternativ `LUNCH_HANDOFF_NUMBER` in `.env`.
* **Als Kunde testen:** KUNDEN → Kunde anlegen, die Handynummer bei
  *Telefon* eintragen. Dann vom Handy die Twilio-Nummer anrufen und die
  Kundennummer sagen.

Die Twilio-Nummer selbst wird im Twilio-Konto gekauft; ihr Voice-Webhook
zeigt auf `https://<DOMAIN>/api/voice/twilio` (siehe `docs/deployment.md`).
