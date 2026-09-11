/**
 * Every word of the lunch service's staff interface, in German. A second
 * language is a second file with the same keys, registered in ./index.js.
 */
export default {
  app: { title: 'Mittagessen-Service', subtitle: 'Bestellungen per Telefon', logout: 'Abmelden', role: { ADMIN: 'Verwaltung', STAFF: 'Mitarbeiter', KITCHEN: 'Küche' } },
  login: { email: 'E-Mail-Adresse', password: 'Passwort', submit: 'Anmelden' },
  nav: { today: 'HEUTE', orders: 'BESTELLUNGEN', kitchen: 'KÜCHE', customers: 'KUNDEN', menu: 'SPEISEPLAN', calls: 'ANRUFE', settings: 'EINSTELLUNGEN' },
  common: {
    loading: 'Wird geladen …', save: 'Speichern', saved: 'Gespeichert', cancel: 'Abbrechen', delete: 'Löschen', edit: 'Bearbeiten', close: 'Schließen',
    search: 'Suchen', yes: 'Ja', no: 'Nein', back: 'Zurück', retry: 'Erneut versuchen', today: 'Heute', yesterday: 'Gestern', tomorrow: 'Morgen',
    none: 'Keine', all: 'Alle', live: 'Live', offline: 'Verbindung unterbrochen', new: 'Neu', error: 'Fehler', room: 'Zimmer', customer: 'Kunde', code: 'Kundennummer',
  },
  status: { NEW: 'NEU', CONFIRMED: 'BESTÄTIGT', PREPARING: 'IN ZUBEREITUNG', READY: 'FERTIG', DELIVERED: 'GELIEFERT', CANCELLED: 'STORNIERT' },
  statusAction: { NEW: 'Auf Neu', CONFIRMED: 'Bestätigen', PREPARING: 'Zubereiten', READY: 'Fertig', DELIVERED: 'Geliefert', CANCELLED: 'Stornieren' },
  today: {
    title: 'Heute — Mittagessen', newOrders: 'Neue Bestellungen', allOrders: 'Alle Bestellungen von heute', noOrders: 'Noch keine Bestellungen für heute.',
    alerts: 'Meldungen', noAlerts: 'Keine offenen Meldungen.', resolve: 'Erledigt', newOrderToast: 'Neue Bestellung', review: 'Bitte prüfen', menuMissing: 'Für heute ist kein Speiseplan veröffentlicht. Der Telefonservice verbindet Anrufer direkt mit dem Restaurant.',
    openMenu: 'Speiseplan anlegen', callsToday: 'Anrufe heute', handoffs: 'Weiterleitungen',
  },
  orders: {
    title: 'Bestellungen', date: 'Liefertag', filter: 'Status', manual: 'Bestellung eintragen', manualTitle: 'Bestellung von Hand eintragen', dish: 'Gericht', quantity: 'Anzahl',
    modifications: 'Änderungen (eine je Zeile)', specialRequest: 'Sonderwunsch', allergyNote: 'Allergie-Hinweis', source: { voice: 'Telefon', manual: 'Von Hand' },
    empty: 'Keine Bestellungen an diesem Tag.', confirmedByCustomer: 'Vom Kunden bestätigt', call: 'Anruf ansehen', history: 'Verlauf', reviewReason: 'Grund',
  },
  kitchen: { title: 'Küche', empty: 'Keine Bestellungen in Arbeit.', done: 'Fertig gemeldet', showDelivered: 'Gelieferte anzeigen' },
  customers: {
    title: 'Kunden', add: 'Kunde anlegen', edit: 'Kunde bearbeiten', code: 'Kundennummer', firstName: 'Vorname', lastName: 'Nachname', salutation: 'Anrede', phone: 'Telefon (optional)',
    room: 'Zimmer', notes: 'Hinweise', active: 'Aktiv', inactive: 'Inaktiv', deactivate: 'Deaktivieren', activate: 'Aktivieren', empty: 'Noch keine Kunden.', notFound: 'Kein Kunde gefunden.',
    history: 'Bestellverlauf', noHistory: 'Noch keine Bestellungen.', export: 'Daten exportieren (DSGVO)', deleteTitle: 'Kunden löschen', deleteText: 'Der Kunde und alle Anrufe werden gelöscht; Bestellungen werden anonymisiert. Das kann nicht rückgängig gemacht werden.',
    nextCode: 'Nächste freie Nummer', codeHint: 'Die Nummer, die der Kunde am Telefon nennt. 1–6 Ziffern.', phoneHint: 'Nur als Zweitsignal. Die gesprochene Kundennummer bleibt maßgeblich.',
  },
  menu: {
    title: 'Speiseplan', published: 'Veröffentlicht', draft: 'Entwurf', duplicate: 'Speiseplan von gestern übernehmen', addItem: 'Gericht hinzufügen', position: 'Nr.', name: 'Name', description: 'Beschreibung',
    category: 'Kategorie', categories: { main: 'Hauptgericht', vegetarian: 'Vegetarisch', soup: 'Suppe', dessert: 'Nachtisch', special: 'Extra' }, available: 'Verfügbar', unavailable: 'Nicht verfügbar',
    components: 'Bestandteile (Komma)', allergens: 'Allergene (Komma)', ingredients: 'Zutaten (Komma)', allowedModifications: 'Erlaubte Änderungen (Komma, z. B. ohne Zwiebeln, Reis statt Kartoffeln)', aliases: 'Weitere Namen (Komma)',
    deadline: 'Bestellschluss (HH:MM, optional)', note: 'Hinweis fürs Team', empty: 'Für diesen Tag gibt es noch keinen Speiseplan.', remove: 'Entfernen', voiceHint: 'So liest es der Telefonservice vor:',
  },
  calls: {
    title: 'Anrufe', empty: 'Noch keine Anrufe.', transcript: 'Gesprächsprotokoll', noTranscript: 'Protokoll nicht gespeichert (Einstellung).', status: { in_progress: 'Läuft', completed: 'Beendet', handoff: 'Weitergeleitet', abandoned: 'Abgebrochen', failed: 'Fehlgeschlagen' },
    simulator: 'Testanruf (Text)', simulatorHint: 'Der echte Dialog, nur getippt statt gesprochen. Bestellungen aus Testanrufen sind echte Bestellungen.', start: 'Anruf starten', send: 'Senden', callerNumber: 'Anrufernummer (optional)',
    confidence: 'Sicherheit', detected: 'Erkannte Bestellung', duration: 'Dauer', reason: 'Grund', order: 'Bestellung',
  },
  settings: {
    title: 'Einstellungen', general: 'Allgemein', restaurantName: 'Name im Gruß', deadline: 'Bestellschluss (HH:MM)', allowAfterDeadline: 'Nach Bestellschluss trotzdem annehmen (mit Prüfhinweis)',
    handoff: 'Telefonnummer für Weiterleitung (E.164, z. B. +4930…)', useCallerId: 'Anrufernummer als Zweitsignal nutzen', confidence: 'Mindest-Sicherheit (0,4–0,95)', maxFailures: 'Nicht verstandene Runden bis zur Weiterleitung',
    privacy: 'Datenschutz', storeTranscripts: 'Gesprächsprotokolle speichern', callRetention: 'Anrufe aufbewahren (Tage)', orderRetention: 'Bestellungen aufbewahren (Tage)', runRetention: 'Aufbewahrung jetzt anwenden',
    team: 'Team & Rollen', roleNone: 'Kein Zugang', addUser: 'Benutzer anlegen', name: 'Name', password: 'Passwort (mind. 10 Zeichen)', role: 'Rolle', active: 'Aktiv', locked: 'Gesperrt', newPassword: 'Neues Passwort', system: 'System', health: 'Systemstatus', webhooks: 'Telefonie (Twilio)', voiceUrl: 'Voice-Webhook (POST)', statusUrl: 'Status-Callback (POST)',
    integrations: { twilio: 'Twilio-Signatur', fable: 'Fable (Sprachverständnis)', database: 'Datenbank' }, ok: 'OK', missing: 'Nicht konfiguriert', audit: 'Änderungsprotokoll', onlyAdmin: 'Nur die Verwaltung kann Einstellungen ändern.',
  },
  alerts: {
    unknown_customer: 'Unbekannter Kunde', ambiguous_order: 'Unklare Bestellung', allergy_request: 'Allergie-Hinweis', unavailable_item: 'Gericht nicht verfügbar',
    repeated_failures: 'Mehrfach nicht verstanden', human_handoff: 'Weiterleitung', caller_mismatch: 'Anrufernummer passt nicht', system_error: 'Technischer Fehler',
  },
  access: { denied: 'Kein Zugang', deniedText: 'Ihr Konto ist gesperrt oder hat keine Rolle. Bitte wenden Sie sich an die Verwaltung.' },
};
