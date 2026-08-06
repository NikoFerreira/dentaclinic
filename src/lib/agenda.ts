import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '../db';
import { appointments, availabilityRules, blackouts, services, users } from '../db/schema';
import { addDays, zonedToUtc, type CalendarDate } from './schedule';

/** Limites UTC de una semana local que empieza el lunes dado. */
function weekBounds(weekStart: CalendarDate) {
  const end = addDays(weekStart, 7);
  return {
    from: zonedToUtc(weekStart.year, weekStart.month, weekStart.day, 0),
    to: zonedToUtc(end.year, end.month, end.day, 0),
  };
}

export async function loadWeekData(weekStart: CalendarDate) {
  const { from, to } = weekBounds(weekStart);

  /**
   * Las tres consultas van SECUENCIALES, no con Promise.all.
   *
   * En produccion el pool es de una sola conexion, y el pooler de Supabase en
   * modo transaction asigna un backend por transaccion: no tolera varias
   * consultas encoladas en paralelo sobre la misma conexion. Lanzarlas juntas
   * hacia que la peticion muriera con "canceling statement due to statement
   * timeout" (57014) y toda la agenda devolviera 500 en produccion, mientras en
   * desarrollo funcionaba porque ahi el pool es mas grande.
   *
   * Secuencial cuesta unos 350 ms contra Ohio, en lugar de ~120 ms, y no
   * depende del tamano del pool ni del modo del pooler.
   */
  const rules = await db
    .select()
    .from(availabilityRules)
    .orderBy(asc(availabilityRules.startMinute));

  const weekAppointments = await db
    .select({
      id: appointments.id,
      userId: appointments.userId,
      startsAt: appointments.startsAt,
      status: appointments.status,
      serviceName: services.name,
      patientName: users.fullName,
    })
    .from(appointments)
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .innerJoin(users, eq(appointments.userId, users.id))
    .where(and(gte(appointments.startsAt, from), lt(appointments.startsAt, to)));

  // Un bloqueo cuenta si se solapa con la semana, no solo si empieza dentro.
  const weekBlackouts = await db
    .select()
    .from(blackouts)
    .where(and(lt(blackouts.startsAt, to), gte(blackouts.endsAt, from)));

  return { rules, appointments: weekAppointments, blackouts: weekBlackouts };
}

export function listActiveServices() {
  return db
    .select()
    .from(services)
    .where(eq(services.active, true))
    .orderBy(asc(services.id));
}

export function listAvailabilityRules() {
  return db.select().from(availabilityRules);
}

export function listBlackoutsOverlapping(from: Date, to: Date) {
  return db
    .select()
    .from(blackouts)
    .where(and(lt(blackouts.startsAt, to), gte(blackouts.endsAt, from)));
}

/** Turnos de un paciente, del mas reciente al mas antiguo. */
export function listUserAppointments(userId: string) {
  return db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      notes: appointments.notes,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .where(eq(appointments.userId, userId))
    .orderBy(asc(appointments.startsAt));
}

/** Solicitudes pendientes de confirmacion, para el panel de administracion. */
export function listPendingAppointments() {
  return db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      notes: appointments.notes,
      createdAt: appointments.createdAt,
      serviceName: services.name,
      patientName: users.fullName,
      patientPhone: users.phone,
      patientEmail: users.email,
    })
    .from(appointments)
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .innerJoin(users, eq(appointments.userId, users.id))
    .where(eq(appointments.status, 'pending'))
    .orderBy(asc(appointments.startsAt));
}

/** Turnos ya confirmados que todavia no ocurrieron, para administracion. */
export function listUpcomingConfirmed() {
  return db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      notes: appointments.notes,
      serviceName: services.name,
      patientName: users.fullName,
      patientPhone: users.phone,
      patientEmail: users.email,
    })
    .from(appointments)
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .innerJoin(users, eq(appointments.userId, users.id))
    .where(and(eq(appointments.status, 'confirmed'), gte(appointments.startsAt, new Date())))
    .orderBy(asc(appointments.startsAt));
}

/**
 * Comprueba si un horario ya esta CERRADO por un turno confirmado.
 *
 * Los pendientes no cuentan: son solicitudes y varias pueden competir por el
 * mismo horario. Es solo para dar un mensaje claro antes de insertar; la
 * garantia real es el indice unico parcial de la tabla.
 */
export async function isSlotTaken(startsAt: Date): Promise<boolean> {
  const rows = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.startsAt, startsAt),
        inArray(appointments.status, ['confirmed', 'completed']),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Solicitudes pendientes que compiten por un horario. */
export function listPendingAtSlot(startsAt: Date) {
  return db
    .select({
      id: appointments.id,
      userId: appointments.userId,
      patientName: users.fullName,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(users, eq(appointments.userId, users.id))
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .where(and(eq(appointments.startsAt, startsAt), eq(appointments.status, 'pending')));
}

/** Pacientes registrados, para que administracion cargue un turno en su nombre. */
export function listPatients() {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.role, 'client'))
    .orderBy(asc(users.fullName));
}
