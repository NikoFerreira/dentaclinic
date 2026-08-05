import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema de la agenda de DentaClinic.
 *
 * Convenciones:
 * - Todos los instantes se guardan como `timestamptz` (UTC). La conversion a la
 *   hora local del consultorio ocurre en src/lib/schedule.ts, nunca en la base.
 * - Los horarios de atencion se guardan como minutos desde medianoche en hora
 *   local, no como `time`, para evitar ambiguedad de zona horaria.
 */

export const userRole = pgEnum('user_role', ['admin', 'client']);

export const appointmentStatus = pgEnum('appointment_status', [
  'pending', // solicitado por el paciente, esperando confirmacion
  'confirmed', // confirmado por el consultorio
  'rejected', // rechazado por el consultorio
  'cancelled', // cancelado por el paciente
  'completed', // atendido
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Siempre normalizado a minusculas antes de insertar. */
    email: text('email').notNull(),
    /** Argon2id. La contrasena en claro no se guarda ni se registra en logs. */
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    role: userRole('role').notNull().default('client'),
    /** Contador para frenar ataques de fuerza bruta sobre una misma cuenta. */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    /**
     * SHA-256 del token de sesion, no el token en si. Si la base se filtra,
     * los hashes no sirven para suplantar a nadie.
     */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const services = pgTable(
  'services',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('services_slug_unique').on(t.slug)],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatus('status').notNull().default('pending'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_starts_at_idx').on(t.startsAt),
    index('appointments_user_id_idx').on(t.userId),
    /**
     * Indice unico PARCIAL: impide que dos turnos activos ocupen el mismo
     * horario. La garantia vive en la base, no en el codigo, asi que dos
     * peticiones simultaneas no pueden reservar el mismo hueco.
     * Los turnos rechazados o cancelados quedan fuera y liberan el horario.
     */
    uniqueIndex('appointments_active_slot_unique')
      .on(t.startsAt)
      .where(sql`status in ('pending', 'confirmed', 'completed')`),
  ],
);

export const availabilityRules = pgTable('availability_rules', {
  id: serial('id').primaryKey(),
  /** 0 = domingo ... 6 = sabado (igual que Date.getDay). */
  weekday: integer('weekday').notNull(),
  /** Minutos desde medianoche, hora local del consultorio. 480 = 08:00. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  slotMinutes: integer('slot_minutes').notNull().default(30),
});

export const blackouts = pgTable(
  'blackouts',
  {
    id: serial('id').primaryKey(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
  },
  (t) => [index('blackouts_range_idx').on(t.startsAt, t.endsAt)],
);

/** Mensajes del formulario publico de la landing (no requieren cuenta). */
export const contactRequests = pgTable('contact_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  specialty: text('specialty').notNull(),
  message: text('message'),
  handled: boolean('handled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];
