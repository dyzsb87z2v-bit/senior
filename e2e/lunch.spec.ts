import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL || 'staff@e2e.de';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-passwort-123';

async function login(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL(/\/mittag/);
}

test.describe.configure({ mode: 'serial' });

/** Each project (desktop, tablet) works with its own customer so runs do not collide. */
const codeFor = (project: string) => (project === 'tablet' ? '315' : '427');

test('unauthenticated visitors are sent to the login page', async ({ page }) => {
  await page.goto('/mittag');
  await expect(page).toHaveURL(/\/login/);
});

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill('falsch-falsch-falsch');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('alert')).toContainText('falsch');
});

test('HEUTE shows the day and the status counters', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Heute — Mittagessen/ })).toBeVisible();
  await expect(page.getByText('NEU', { exact: true }).first()).toBeVisible();
});

test('a customer can be created and found', async ({ page }, info) => {
  const code = codeFor(info.project.name);
  await login(page);
  await page.goto('/mittag/kunden');
  await page.getByRole('button', { name: /Kunde anlegen/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Kundennummer/).fill(code);
  await dialog.getByLabel(/Vorname/).fill('Erika');
  await dialog.getByLabel(/Nachname/).fill(`Müller-${code}`);
  await dialog.getByLabel(/Zimmer/).fill('12');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(`#${code}`)).toBeVisible();
  await expect(page.getByRole('link', { name: `Müller-${code}` })).toBeVisible();
});

test('the menu is saved and the phone service reads it back', async ({ page }) => {
  await login(page);
  await page.goto('/mittag/speiseplan');
  // Wait for the day to load: either the empty state or an existing dish.
  const emptyState = page.getByText(/noch keinen Speiseplan/);
  await expect(emptyState.or(page.getByPlaceholder('Schnitzel mit Kartoffeln und Gemüse').first())).toBeVisible();
  const empty = await emptyState.isVisible();
  if (empty) {
    await page.getByRole('button', { name: /Gericht hinzufügen/ }).click();
    await page.getByPlaceholder('Schnitzel mit Kartoffeln und Gemüse').fill('Schnitzel mit Kartoffeln und Gemüse');
    await page.getByPlaceholder('Kartoffeln, Gemüse').fill('Kartoffeln, Gemüse');
    await page.getByPlaceholder('ohne Zwiebeln, Reis statt Kartoffeln').fill('ohne Zwiebeln, Reis statt Kartoffeln');
  }
  await page.getByRole('button', { name: 'Speichern' }).first().click();
  await expect(page.getByText('Gespeichert').first()).toBeVisible();
  await expect(page.getByText(/Heute haben wir: Nummer eins: Schnitzel/)).toBeVisible();
});

test('a typed call goes through the real dialog and reaches the dashboard live', async ({ page, context }, info) => {
  const code = codeFor(info.project.name);
  const spoken = code === '427' ? 'vier zwei sieben' : 'drei eins fünf';
  await login(page);
  const dashboard = await context.newPage();
  await dashboard.goto('/mittag');
  await expect(dashboard.getByText('Live')).toBeVisible({ timeout: 15_000 });

  await page.goto('/mittag/anrufe');
  await page.getByRole('button', { name: /Anruf starten/ }).click();
  await expect(page.getByText(/Willkommen beim/)).toBeVisible();
  const input = page.getByPlaceholder('Vier zwei sieben');
  const send = page.getByRole('button', { name: 'Senden' });
  await input.fill(spoken); await send.click();
  await expect(page.getByText(new RegExp(`Kundennummer ${spoken} erkannt`))).toBeVisible();
  await input.fill('Ich hätte gerne Schnitzel mit Kartoffeln und Gemüse, aber ohne Zwiebeln'); await send.click();
  await expect(page.getByText(/Ist das richtig/)).toBeVisible();
  await input.fill('Ja'); await send.click();
  await expect(page.getByText(/erfolgreich aufgenommen/)).toBeVisible();

  // The dashboard was never reloaded: the order arrived over the event stream.
  // (Brought to the front first: an emulated mobile tab in the background is frozen by the browser.)
  await dashboard.bringToFront();
  await expect(dashboard.getByText(`#${code}`).first()).toBeVisible({ timeout: 15_000 });
  await expect(dashboard.locator('article', { hasText: `#${code}` }).getByText('OHNE ZWIEBELN').first()).toBeVisible();
  await expect(dashboard.getByText(/Neue Bestellung/).first()).toBeVisible();
});

test('the kitchen sees the order in large type and moves it forward; kitchen cannot open customers', async ({ page }, info) => {
  const code = codeFor(info.project.name);
  await login(page, 'kueche@e2e.de');
  await page.goto('/mittag/kueche');
  const card = page.locator('article', { hasText: `#${code}` });
  await expect(card).toBeVisible();
  await expect(card.getByText('SCHNITZEL MIT KARTOFFELN UND GEMÜSE')).toBeVisible();
  await expect(card.getByText('Zimmer: 12')).toBeVisible();
  await card.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(card.getByText('BESTÄTIGT')).toBeVisible();
  await page.goto('/mittag/kunden');
  await expect(page.getByRole('alert')).toContainText('nicht erlaubt');
  await expect(page.getByRole('link', { name: 'KUNDEN' })).toHaveCount(0);
});

test('staff can change status from the orders list and see the call transcript', async ({ page }, info) => {
  const code = codeFor(info.project.name);
  await login(page);
  await page.goto('/mittag/bestellungen');
  const card = page.locator('article', { hasText: `#${code}` });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Zubereiten' }).click();
  await expect(card.getByText('IN ZUBEREITUNG')).toBeVisible();
  await card.getByRole('link', { name: 'Anruf ansehen' }).click();
  await expect(page.getByText(/Gesprächsprotokoll/)).toBeVisible();
  await expect(page.getByText(/Willkommen beim/).first()).toBeVisible();
});

test('admin manages settings and the team', async ({ page }) => {
  await login(page, 'admin@e2e.de');
  await page.goto('/mittag/einstellungen');
  await page.getByLabel(/Name im Gruß/).fill('Haus Sonnenschein');
  await page.getByRole('button', { name: 'Speichern' }).first().click();
  await expect(page.getByText('Gespeichert').first()).toBeVisible();
  await expect(page.getByText('staff@e2e.de', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/api\/voice\/twilio/).first()).toBeVisible();
});
