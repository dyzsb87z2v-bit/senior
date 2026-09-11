import type { Customer, DialogContext, EngineSettings, MenuItem, PreviousOrder, UnderstandInput, Understanding } from '../../src/domain/types.ts';
import { understandWithRules } from '../../src/domain/understanding.ts';

export const TODAY = '2026-09-11';

export const MENU: MenuItem[] = [
  {
    id: 'm1', date: TODAY, position: 1, nameDe: 'Schnitzel mit Kartoffeln und Gemüse', category: 'main', available: true,
    components: ['Kartoffeln', 'Gemüse'], allergens: ['Gluten'], ingredients: ['Schweinefleisch', 'Zwiebeln'],
    allowedModifications: ['ohne Zwiebeln', 'Reis statt Kartoffeln'],
  },
  {
    id: 'm2', date: TODAY, position: 2, nameDe: 'Fisch mit Reis und Salat', category: 'main', available: true,
    components: ['Reis', 'Salat'], allergens: ['Fisch'], allowedModifications: ['ohne Salat'],
  },
  {
    id: 'm3', date: TODAY, position: 3, nameDe: 'Vegetarische Pasta', category: 'vegetarian', available: true,
    components: ['Pasta', 'Tomatensoße'], allergens: ['Gluten'], aliases: ['Nudeln'], allowedModifications: ['ohne Käse'],
  },
  {
    id: 'm4', date: TODAY, position: 4, nameDe: 'Gulasch mit Knödeln', category: 'main', available: false,
    components: ['Knödel'], allowedModifications: [],
  },
];

export const CUSTOMERS: Customer[] = [
  { id: 'c427', customerCode: '427', firstName: 'Erika', lastName: 'Müller', salutation: 'Frau', roomNumber: '12', active: true, phoneNumber: '+491700000427' },
  { id: 'c315', customerCode: '315', firstName: 'Karl', lastName: 'Schmidt', salutation: 'Herr', roomNumber: '7', active: true, phoneNumber: '+491700000315' },
  { id: 'c999', customerCode: '999', lastName: 'Inaktiv', active: false },
];

export const SETTINGS: EngineSettings = {
  restaurantName: 'Mittagessen-Service',
  confidenceThreshold: 0.7,
  maxFailures: 3,
  useCallerId: true,
  orderDeadline: '10:30',
  allowSameDayAfterDeadline: true,
  handoffAvailable: true,
};

export function makeContext(overrides: Partial<DialogContext> & { previous?: Record<string, PreviousOrder | null>; understand?: (i: UnderstandInput) => Promise<Understanding> } = {}): DialogContext {
  const previous = overrides.previous || {};
  return {
    settings: { ...SETTINGS, ...(overrides.settings || {}) },
    menu: overrides.menu || MENU,
    today: TODAY,
    findCustomerByCode: async (code) => CUSTOMERS.find((c) => c.customerCode === code) || null,
    findCustomerByPhone: async (phone) => CUSTOMERS.find((c) => c.phoneNumber === phone) || null,
    previousOrder: async (customerId) => previous[customerId] ?? null,
    understand: overrides.understand || (async (i) => understandWithRules(i)),
    log: overrides.log,
  };
}

/** A morning call, before the deadline. */
export const AT = new Date('2026-09-11T08:00:00+02:00');
