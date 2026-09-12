# Mittagessen-Service — telefonische Mittagessen-Bestellung für Senioren

Bewohnerinnen und Bewohner einer Senioreneinrichtung bestellen ihr Mittagessen
mit einem ganz normalen Telefon: anrufen, Kundennummer sagen, Gericht sagen,
mit „Ja“ bestätigen. Das Restaurant sieht die Bestellung im selben Moment auf
dem Dashboard und in der Küchenanzeige.

```
ANRUF → KUNDENNUMMER SAGEN → ESSEN SAGEN → BESTÄTIGEN
```

Kein App-Download, kein Touchscreen, keine feste Satzform. Der Assistent
spricht Deutsch, langsam und ruhig, fragt bei Unsicherheit nach und rät nie.
Wer einen Menschen möchte, bekommt einen.

## Was das System kann

* **Telefon (Twilio):** deutsche Spracherkennung und Sprachausgabe, Eingabe
  der Kundennummer auch über die Tasten, geduldig bei Pausen, Weiterleitung
  ans Restaurant bei Bedarf.
* **Verstehen:** Kundennummern („vier zwei sieben“, „427“, „Nummer
  vierhundertsiebenundzwanzig“), Gerichte („Nummer eins“, „das Schnitzel“,
  „das vegetarische Essen“), Änderungen („ohne Zwiebeln“, „Reis statt
  Kartoffeln“), Mengen, „das gleiche wie gestern“, Allergiehinweise — per
  Regelwerk und, für freie Sätze, mit **Claude Fable 5.1**.
* **Sicherheit der Bestellung:** Prüfung gegen den Speiseplan von heute,
  Rückfrage statt Raten, mündliche Bestätigung jeder Bestellung, Kennzeichnung
  für menschliche Prüfung (Allergie, ungelistete Änderung, nach Bestellschluss).
* **Restaurant:** HEUTE, BESTELLUNGEN, KÜCHE (große Karten), KUNDEN
  (mit Historie, Export und Löschung), SPEISEPLAN (tageweise, Kopie von
  gestern), ANRUFE (Protokolle, Test-Anruf per Text), EINSTELLUNGEN
  (Team & Rollen, Datenschutz, Systemstatus). Aktualisiert sich live.
* **Rollen:** ADMIN, STAFF, KITCHEN. Sitzungen mit sicheren Cookies, CSRF-Schutz,
  Rate-Limits, Audit-Log, konfigurierbare Aufbewahrung, DSGVO-Export und -Löschung.

## Stack

Node.js 22 · TypeScript · Fastify · PostgreSQL 16 · Drizzle ORM · React · Vite ·
Tailwind · zod · Twilio Programmable Voice · Anthropic SDK (`claude-fable-5-1`) ·
vitest · Playwright · Docker. Details: [`docs/architecture.md`](docs/architecture.md).

## Schnell ausprobieren (ein Befehl, ohne Telefon)

Mit Docker:

```bash
git clone https://github.com/dyzsb87z2v-bit/senior && cd senior
cp .env.example .env                 # ADMIN_PASSWORD und SESSION_SECRET eintragen (SEED_SAMPLE=true lassen)
docker compose up -d --build
```

Dann `http://localhost:3000/mittag` öffnen, mit `ADMIN_EMAIL`/`ADMIN_PASSWORD`
anmelden, ANRUFE → **Anruf starten** und tippen: `427` → `Schnitzel ohne
Zwiebeln` → `Ja`. Die Bestellung erscheint auf HEUTE und in der KÜCHE, ohne
Neuladen. Das ist der echte Dialog; nur das Telefon fehlt.

## Lokal starten (Entwicklung)

Voraussetzungen: Node 22.18+, PostgreSQL 16 (oder Docker).

```bash
cp .env.example .env            # DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD eintragen
npm ci
npm run db:migrate              # legt die Tabellen an
SEED_SAMPLE=true npm run db:seed   # Admin-Konto, Beispielkunden 427/315/108, Speiseplan von heute
npm run dev                     # Server auf :3000, Web-Oberfläche auf :5173
```

Dann `http://localhost:5173/mittag` öffnen, anmelden, unter ANRUFE einen
Testanruf starten: „427“ → „Schnitzel ohne Zwiebeln“ → „Ja“. Die Bestellung
erscheint auf HEUTE ohne Neuladen.

Oder alles in Docker: `docker compose up --build` (App auf :3000), danach
`docker compose exec app node dist/server/db/seed.js`.

## Telefon anschließen (Twilio)

1. Deutsche Nummer mit Voice-Funktion kaufen.
2. Voice-Konfiguration → „A call comes in“: **Webhook**, HTTP **POST**,
   `https://<PUBLIC_URL>/api/voice/twilio`.
3. Status-Callback: `https://<PUBLIC_URL>/api/voice/twilio/status`, POST.
4. Auth Token des Kontos in `TWILIO_AUTH_TOKEN` eintragen.
5. Restaurant-Nummer unter EINSTELLUNGEN → Weiterleitung eintragen.

EINSTELLUNGEN → System zeigt die genauen URLs. Der Server prüft die
Twilio-Signatur jeder Anfrage; unsignierte Anfragen werden abgelehnt.

## Fable (Claude Fable 5.1)

`ANTHROPIC_API_KEY` setzen; Modell per `LUNCH_AI_MODEL` (Standard
`claude-fable-5-1`). Ohne Schlüssel läuft nur das Regelwerk. Nach dem
Deployment prüfen:

```bash
ANTHROPIC_API_KEY=… node scripts/fable-smoke.mjs "Ich hätte gerne Schnitzel mit Reis statt Kartoffeln"
```

## Prüfen

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript, Server und Domäne
npm run test        # vitest: 96 Domänentests + 19 Servertests gegen echtes PostgreSQL
npm run build       # Server (dist/) und Web (web/dist/)
npm run test:e2e    # Playwright im Browser, startet den Server selbst
```

Die Servertests und Playwright erwarten eine Test-Datenbank unter
`TEST_DATABASE_URL` (Standard `postgres://postgres@127.0.0.1:5433/senior_lunch_test`).
Ohne heruntergeladene Browser: `PLAYWRIGHT_CHROMIUM_PATH=/pfad/zu/chromium`.

## Auf dem Handy oder Tablet

Die Oberfläche ist als App installierbar (PWA): von einer HTTPS-Adresse
öffnen, anmelden, **App installieren** (Android/Chrome) oder Teilen → **Zum
Home-Bildschirm** (iPhone). `docker compose up -d --build` bringt mit Caddy
gleich HTTPS mit (`DOMAIN` in `.env`). Anleitung: [`docs/mobile.md`](docs/mobile.md).

## Betrieb

Umgebungsvariablen, Migrationen, Health-Check, Logs, Backup und Aufbewahrung:
[`docs/deployment.md`](docs/deployment.md).

## Struktur

```
src/domain/     Dialog-Engine, Zahlen, Speiseplan-Abgleich, Prompts, TwiML — reines TypeScript, ohne I/O
src/server/     Fastify: Konfiguration, DB (Drizzle), Auth, API, Voice-Webhooks, Fable-Provider
web/            React-Oberfläche (deutsch), gebaut nach web/dist
drizzle/        SQL-Migrationen
tests/          vitest: domain/ (Dialogszenarien), server/ (API und Webhook gegen PostgreSQL)
e2e/            Playwright
docs/           Architektur, Deployment
```
