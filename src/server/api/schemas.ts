import { z } from 'zod';
import { isValidIsoDate } from '../../domain/dates.ts';

export const Code = z.string().trim().regex(/^\d{1,6}$/, 'Kundennummer: 1–6 Ziffern');
export const Phone = z.string().trim().transform((s) => s.replace(/[\s-]+/g, '')).pipe(z.string().regex(/^(\+?[0-9]{5,20})?$/, 'Telefonnummer'));
export const Text = (max: number) => z.string().trim().max(max);
export const IsoDate = z.string().refine(isValidIsoDate, 'Datum (YYYY-MM-DD)');
export const Id = z.string().uuid();

export const CustomerInput = z.object({
  customerCode: Code,
  firstName: Text(80).default(''),
  lastName: Text(80).min(1, 'Nachname fehlt'),
  salutation: z.enum(['Frau', 'Herr', '']).default(''),
  phoneNumber: Phone.default(''),
  roomNumber: Text(20).default(''),
  notes: Text(1000).default(''),
});

export const MenuItemInput = z.object({
  id: Id.optional(),
  position: z.number().int().min(1).max(20),
  nameDe: Text(120).min(2),
  descriptionDe: Text(500).default(''),
  category: z.enum(['main', 'vegetarian', 'soup', 'dessert', 'special']).default('main'),
  available: z.boolean().default(true),
  components: z.array(Text(60)).max(12).default([]),
  allergens: z.array(Text(60)).max(20).default([]),
  ingredients: z.array(Text(60)).max(40).default([]),
  allowedModifications: z.array(Text(80)).max(20).default([]),
  aliases: z.array(Text(60)).max(10).default([]),
});

export const MenuDayInput = z.object({
  published: z.boolean().default(true),
  orderDeadline: z.string().regex(/^(\d{2}:\d{2})?$/).default(''),
  note: Text(500).default(''),
  items: z.array(MenuItemInput).max(20).default([]),
});

export const ManualOrderInput = z.object({
  customerId: Id,
  menuItemId: Id,
  orderDate: IsoDate,
  quantity: z.number().int().min(1).max(20).default(1),
  modifications: z.array(Text(120)).max(10).default([]),
  specialRequest: Text(300).default(''),
  allergyNote: Text(300).default(''),
});

export const StatusInput = z.object({ status: z.enum(['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']) });

export const SettingsInput = z.object({
  restaurantName: Text(80).optional(),
  storeTranscripts: z.boolean().optional(),
  callRetentionDays: z.number().int().min(1).max(3650).optional(),
  orderRetentionDays: z.number().int().min(7).max(3650).optional(),
  handoffNumber: Phone.optional(),
  orderDeadline: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
  allowSameDayAfterDeadline: z.boolean().optional(),
  maxFailures: z.number().int().min(2).max(6).optional(),
  confidenceThreshold: z.number().min(0.4).max(0.95).optional(),
  useCallerId: z.boolean().optional(),
});

export const LoginInput = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });
export const UserCreateInput = z.object({ email: z.string().trim().email().max(200), password: z.string().min(10).max(200), name: Text(80).default(''), role: z.enum(['ADMIN', 'STAFF', 'KITCHEN']) });
export const UserUpdateInput = z.object({ role: z.enum(['ADMIN', 'STAFF', 'KITCHEN']).optional(), active: z.boolean().optional(), name: Text(80).optional(), password: z.string().min(10).max(200).optional() });
export const SimulateInput = z.object({ callId: Id.optional(), utterance: Text(500).optional(), callerNumber: Phone.default('') });
