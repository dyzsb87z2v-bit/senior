# Auf Render veröffentlichen (auch vom Handy aus)

Render baut die App aus diesem Repository, legt die PostgreSQL-Datenbank an
und gibt ihr eine https-Adresse. Alles im Browser, kein Computer nötig.

1. `https://render.com` → mit GitHub anmelden (das Konto, dem das Repository gehört).
2. Diese Adresse öffnen: `https://render.com/deploy?repo=https://github.com/dyzsb87z2v-bit/senior`
   (oder im Dashboard: New → Blueprint → Repository `senior` wählen).
3. Render zeigt die Vorlage aus `render.yaml` und fragt nach den Werten:
   * `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mind. 10 Zeichen) — das erste Konto, wird beim ersten Start angelegt
   * `TWILIO_AUTH_TOKEN` — aus dem Twilio-Konto (siehe unten); kann zunächst leer bleiben
   * `LUNCH_HANDOFF_NUMBER` — Ihre Handynummer im Format `+49…`, für die Weiterleitung
   * `ANTHROPIC_API_KEY` — optional; ohne Schlüssel läuft nur die Regel-Erkennung
4. **Apply**. Nach einigen Minuten ist die App unter `https://mittagessen-service-….onrender.com` erreichbar.
   Die Vorlage nutzt die **kostenlosen** Pläne: kein Geld nötig. Zwei Einschränkungen:
   der Dienst schläft nach 15 Minuten ohne Aufruf ein und braucht etwa eine Minute
   zum Aufwachen — **vor dem Anruf zuerst `…/mittag` im Browser öffnen** —, und die
   kostenlose Datenbank läuft nach 30 Tagen ab (dann Plan wechseln oder Supabase, unten).
5. `…/mittag` öffnen, mit `ADMIN_EMAIL`/`ADMIN_PASSWORD` anmelden. Die Beispielkunden
   427, 315, 108 und der Speiseplan von heute sind schon da (`SEED_SAMPLE=true`).

Die öffentliche Adresse liest die App selbst aus Renders `RENDER_EXTERNAL_URL`;
`PUBLIC_URL` muss nicht gesetzt werden. Migrationen laufen beim Start.

## Twilio: die Telefonnummer

1. `https://www.twilio.com/try-twilio` → Konto anlegen, eigene Handynummer bestätigen.
2. Console → *Phone Numbers* → *Get a trial number* (ein Testkonto bekommt meist eine
   US-Nummer; eine deutsche Nummer braucht ein Upgrade und einen Adressnachweis).
3. Bei der Nummer → *Configure* → *Voice → A call comes in*:
   **Webhook**, `https://<ihre-render-adresse>/api/voice/twilio`, HTTP **POST**.
   *Call status changes*: `https://<ihre-render-adresse>/api/voice/twilio/status`, POST.
4. Console-Startseite → *Auth Token* kopieren → in Render unter *Environment* als
   `TWILIO_AUTH_TOKEN` eintragen → Save (die App startet neu).
5. Die Twilio-Nummer vom eigenen Handy anrufen. Ein Testkonto spielt zuerst einen
   kurzen Hinweis ab und verlangt einen Tastendruck; danach begrüßt der Assistent
   auf Deutsch. Dann: „vier zwei sieben“ → „Schnitzel ohne Zwiebeln“ → „Ja“.
   Die Bestellung erscheint sofort unter HEUTE und KÜCHE.

Bei einem Testkonto ruft ein Anruf aus Deutschland eine US-Nummer an
(Auslandstarif des eigenen Anbieters). Für den Betrieb: Twilio-Konto aufladen und
eine deutsche Nummer buchen; sonst ändert sich nichts.

## Kostenlose Datenbank ohne Ablauf: Supabase

`https://supabase.com` → New project (Region Frankfurt) → *Project Settings → Database →
Connection string (URI)*, Modus *Session*, Passwort einsetzen und `?sslmode=require`
anhängen. In Render unter *Environment* `DATABASE_URL` auf diesen Wert setzen; die
Render-Datenbank kann dann gelöscht werden. Die App verbindet sich per TLS.

## Railway statt Render

`https://railway.app` → New Project → Deploy from GitHub repo → `senior`;
dann *Add PostgreSQL*. Beim Dienst unter *Variables*: `DATABASE_URL` =
`${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`, `SESSION_SECRET` (zufällig,
mind. 32 Zeichen), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SEED_SAMPLE=true`,
`TWILIO_AUTH_TOKEN`, `LUNCH_HANDOFF_NUMBER`. Unter *Settings → Networking* eine
öffentliche Domain erzeugen; die App liest sie aus `RAILWAY_PUBLIC_DOMAIN`.
