import { and, asc, count, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '../db';
import { appointments, availabilityRules, blackouts, type AvailabilityRule } from '../db/schema';
import { addDays, localWeekdayAndMinutes, zonedToUtc, type CalendarDate } from './schedule';

/** Estados que ocupan un horario; los demas lo liberan. */
const OCCUPYING = ['pending', 'confirmed', 'completed'] as const;

// ---------------------------------------------------------------------------
// Horarios de atencion
// ---------------------------------------------------------------------------

export function listRules() {
  return db
    .select()
    .from(availabilityRules)
    .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute));
}

/**
 * Dos reglas del mismo dia que se solapan generarian huecos duplicados a la
 * misma hora en el calendario. Se rechaza antes de insertar.
 */
export function findOverlap(
  rules: AvailabilityRule[],
  weekday: number,
  startMinute: number,
  endMinute: number,
): AvailabilityRule | null {
  return (
    rules.find(
      (rule) =>
        rule.weekday === weekday && startMinute < rule.endMinute && endMinute > rule.startMinute,
    ) ?? null
  );
}

export async function createRule(input: {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
}) {
  await db.insert(availabilityRules).values(input);
}

export async function deleteRule(id: number) {
  await db.delete(availabilityRules).where(eq(availabilityRules.id, id));
}

/**
 * Turnos activos a futuro que caen en el rango de una regla.
 *
 * Se consulta antes de borrarla: si se elimina el horario, esos turnos dejan de
 * aparecer en la grilla del calendario y quedarian invisibles para todos.
 */
export async function countAppointmentsUnderRule(rule: AvailabilityRule): Promise<number> {
  const upcoming = await db
    .select({ startsAt: appointments.startsAt })
    .from(appointments)
    .where(
      and(gte(appointments.startsAt, new Date()), inArray(appointments.status, [...OCCUPYING])),
    );

  // El filtro fino se hace en memoria: comparar dia de la semana y minuto local
  // en SQL exigiria replicar la conversion de zona horaria dentro de la base.
  return upcoming.filter((row) => {
    const { weekday, minutes } = localWeekdayAndMinutes(row.startsAt);
    return weekday === rule.weekday && minutes >= rule.startMinute && minutes < rule.endMinute;
  }).length;
}

// ---------------------------------------------------------------------------
// Feriados y cierres
// ---------------------------------------------------------------------------

export function listBlackouts() {
  return db.select().from(blackouts).orderBy(asc(blackouts.startsAt));
}

/**
 * Crea un cierre a partir de dos fechas de almanaque, ambas inclusive.
 *
 * El rango se guarda como [desde 00:00, hasta+1dia 00:00) en hora local, para
 * que el ultimo dia quede cubierto completo.
 */
export async function createBlackout(from: CalendarDate, to: CalendarDate, reason: string | null) {
  const startsAt = zonedToUtc(from.year, from.month, from.day, 0);
  const dayAfter = addDays(to, 1);
  const endsAt = zonedToUtc(dayAfter.year, dayAfter.month, dayAfter.day, 0);

  await db.insert(blackouts).values({ startsAt, endsAt, reason });
}

export async function deleteBlackout(id: number) {
  await db.delete(blackouts).where(eq(blackouts.id, id));
}

/** Turnos activos que caen dentro de un cierre: quedarian tapados por el bloqueo. */
export async function countAppointmentsInBlackout(startsAt: Date, endsAt: Date): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(appointments)
    .where(
      and(
        gte(appointments.startsAt, startsAt),
        lt(appointments.startsAt, endsAt),
        inArray(appointments.status, [...OCCUPYING]),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}
