/**
 * The database, as Drizzle sees it. `npm run db:generate` turns changes here
 * into a SQL migration under ./drizzle; `npm run db:migrate` applies them.
 *
 * Personal data is kept to what the kitchen and delivery need. Orders keep a
 * snapshot of the dish and the customer's name and room so a kitchen card
 * stays correct when the menu or the customer is edited later, and so an
 * order survives the customer's deletion (anonymised).
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['ADMIN', 'STAFF', 'KITCHEN']);
export const orderStatus = pgEnum('order_status', ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']);
export const orderSource = pgEnum('order_source', ['voice', 'manual']);
export const menuCategory = pgEnum('menu_category', ['main', 'vegetarian', 'soup', 'dessert', 'special']);
export const modificationType = pgEnum('modification_type', ['without', 'replace', 'extra', 'note']);
export const callStatus = pgEnum('call_status', ['in_progress', 'completed', 'handoff', 'abandoned', 'failed']);
export const confirmationState = pgEnum('confirmation_state', ['pending', 'confirmed', 'rejected', 'none']);
export const alertType = pgEnum('alert_type', ['unknown_customer', 'ambiguous_order', 'allergy_request', 'unavailable_item', 'repeated_failures', 'human_handoff', 'caller_mismatch', 'system_error']);
export const alertSeverity = pgEnum('alert_severity', ['info', 'warning', 'critical']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  role: userRole('role').notNull().default('STAFF'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`)]);

export const sessions = pgTable('sessions', {
  /** SHA-256 of the cookie value; the cookie itself is never stored. */
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent').notNull().default(''),
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]);

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customerCode: text('customer_code').notNull(),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull(),
  salutation: text('salutation').notNull().default(''),
  phoneNumber: text('phone_number').notNull().default(''),
  roomNumber: text('room_number').notNull().default(''),
  active: boolean('active').notNull().default(true),
  notes: text('notes').notNull().default(''),
  ...timestamps,
}, (t) => [uniqueIndex('customers_code_idx').on(t.customerCode), index('customers_phone_idx').on(t.phoneNumber)]);

export const menuDays = pgTable('menu_days', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  date: date('date').notNull(),
  published: boolean('published').notNull().default(true),
  orderDeadline: text('order_deadline').notNull().default(''),
  note: text('note').notNull().default(''),
  ...timestamps,
}, (t) => [uniqueIndex('menu_days_date_idx').on(t.date)]);

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  menuDayId: uuid('menu_day_id').notNull().references(() => menuDays.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  position: integer('position').notNull(),
  nameDe: text('name_de').notNull(),
  descriptionDe: text('description_de').notNull().default(''),
  category: menuCategory('category').notNull().default('main'),
  available: boolean('available').notNull().default(true),
  components: text('components').array().notNull().default(sql`'{}'::text[]`),
  allergens: text('allergens').array().notNull().default(sql`'{}'::text[]`),
  ingredients: text('ingredients').array().notNull().default(sql`'{}'::text[]`),
  allowedModifications: text('allowed_modifications').array().notNull().default(sql`'{}'::text[]`),
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
  ...timestamps,
}, (t) => [uniqueIndex('menu_items_date_position_idx').on(t.date, t.position), index('menu_items_date_idx').on(t.date)]);

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  callSid: text('call_sid').notNull(),
  provider: text('provider').notNull().default('twilio'),
  callerNumber: text('caller_number').notNull().default(''),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerCode: text('customer_code').notNull().default(''),
  stage: text('stage').notNull().default('ASK_CODE'),
  /** The dialog engine's persisted state (without the transcript). */
  state: jsonb('state').notNull().default(sql`'{}'::jsonb`),
  turns: integer('turns').notNull().default(0),
  failures: integer('failures').notNull().default(0),
  transcript: jsonb('transcript').notNull().default(sql`'[]'::jsonb`),
  detectedOrder: jsonb('detected_order').notNull().default(sql`'{}'::jsonb`),
  confirmation: confirmationState('confirmation').notNull().default('none'),
  orderId: uuid('order_id'),
  callStatus: callStatus('call_status').notNull().default('in_progress'),
  handoffReason: text('handoff_reason').notNull().default(''),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  ...timestamps,
}, (t) => [uniqueIndex('calls_sid_idx').on(t.callSid), index('calls_customer_idx').on(t.customerId), index('calls_started_idx').on(t.startedAt)]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderDate: date('order_date').notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerCode: text('customer_code').notNull(),
  customerName: text('customer_name').notNull().default(''),
  roomNumber: text('room_number').notNull().default(''),
  menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'set null' }),
  itemPosition: integer('item_position'),
  itemName: text('item_name').notNull(),
  components: text('components').array().notNull().default(sql`'{}'::text[]`),
  quantity: integer('quantity').notNull().default(1),
  specialRequest: text('special_request').notNull().default(''),
  allergyNote: text('allergy_note').notNull().default(''),
  needsReview: boolean('needs_review').notNull().default(false),
  reviewReason: text('review_reason').notNull().default(''),
  status: orderStatus('status').notNull().default('NEW'),
  source: orderSource('source').notNull().default('voice'),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  confirmedByCustomer: boolean('confirmed_by_customer').notNull().default(false),
  ...timestamps,
}, (t) => [index('orders_date_idx').on(t.orderDate), index('orders_status_idx').on(t.status), index('orders_customer_idx').on(t.customerId), index('orders_code_idx').on(t.customerCode)]);

export const orderModifications = pgTable('order_modifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  type: modificationType('type').notNull(),
  target: text('target').notNull(),
  replacement: text('replacement').notNull().default(''),
  textDe: text('text_de').notNull(),
  allowed: boolean('allowed').notNull().default(false),
  position: integer('position').notNull().default(0),
}, (t) => [index('order_modifications_order_idx').on(t.orderId)]);

export const orderStatusHistory = pgTable('order_status_history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  status: orderStatus('status').notNull(),
  changedBy: text('changed_by').notNull().default(''),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('order_status_history_order_idx').on(t.orderId)]);

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: alertType('type').notNull(),
  severity: alertSeverity('severity').notNull().default('warning'),
  message: text('message').notNull(),
  callId: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerCode: text('customer_code').notNull().default(''),
  resolved: boolean('resolved').notNull().default(false),
  resolvedBy: text('resolved_by').notNull().default(''),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('alerts_resolved_idx').on(t.resolved, t.createdAt)]);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorEmail: text('actor_email').notNull().default(''),
  actorRole: text('actor_role').notNull().default(''),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull().default(''),
  summary: text('summary').notNull().default(''),
  before: jsonb('before'),
  after: jsonb('after'),
  callId: uuid('call_id'),
  orderId: uuid('order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_logs_created_idx').on(t.createdAt)]);

/** One row (id = 1). Secrets never live here; they are environment variables. */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  restaurantName: text('restaurant_name').notNull().default('Mittagessen-Service'),
  storeTranscripts: boolean('store_transcripts').notNull().default(true),
  callRetentionDays: integer('call_retention_days').notNull().default(30),
  orderRetentionDays: integer('order_retention_days').notNull().default(365),
  handoffNumber: text('handoff_number').notNull().default(''),
  orderDeadline: text('order_deadline').notNull().default('10:30'),
  allowSameDayAfterDeadline: boolean('allow_same_day_after_deadline').notNull().default(true),
  maxFailures: integer('max_failures').notNull().default(3),
  confidenceThreshold: integer('confidence_threshold_percent').notNull().default(70),
  useCallerId: boolean('use_caller_id').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
