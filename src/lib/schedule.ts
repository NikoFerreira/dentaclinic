import type { AppointmentStatus, AvailabilityRule } from '../db/schema';

/**
 * Manejo de horarios del consultorio.
 *
 * Regla de oro: en la base todo son instantes UTC (`timestamptz`). La hora local
 * solo existe al construir la grilla y al mostrar texto. Las conversiones usan
 * `Intl` en lugar de un desplazamiento fijo, asi que siguen siendo correctas si
 * Paraguay vuelve a aplicar horario de verano.
 */
export const CLINIC_TZ = 'America/Asuncion';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function rawParts(instant: Date) {
  const map: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Desplazamiento de la zona del consultorio respecto a UTC, en minutos. */
export function tzOffsetMinutes(instant: Date): number {
  const p = rawParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = instant.getTime() - instant.getMilliseconds();
  return (asIfUtc - truncated) / 60000;
}

/** Convierte una hora de pared local (minutos desde medianoche) al instante UTC. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
): Date {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  const firstOffset = tzOffsetMinutes(guess);
  const candidate = new Date(guess.getTime() - firstOffset * 60000);

  // Segunda pasada: cubre los dias en que el desplazamiento cambia.
  const secondOffset = tzOffsetMinutes(candidate);
  return secondOffset === firstOffset
    ? candidate
    : new Date(guess.getTime() - secondOffset * 60000);
}

// ---------------------------------------------------------------------------
// Fechas de calendario (sin hora ni zona: representan un dia del almanaque)
// ---------------------------------------------------------------------------

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(date: CalendarDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseISODate(value: string | null | undefined): CalendarDate | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Rechaza fechas inexistentes como 2026-02-31, que Date normalizaria en silencio.
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** 0 = domingo ... 6 = sabado, igual que Date.getDay. */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function addDays(date: CalendarDate, amount: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Lunes de la semana que contiene la fecha dada. */
export function startOfWeek(date: CalendarDate): CalendarDate {
  const weekday = weekdayOf(date);
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, offsetToMonday);
}

export function todayInClinic(now: Date = new Date()): CalendarDate {
  const p = rawParts(now);
  return { year: p.year, month: p.month, day: p.day };
}

export function isSameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

// ---------------------------------------------------------------------------
// Horas de pared, como las escribe una persona
// ---------------------------------------------------------------------------

/** 0 = domingo ... 6 = sabado, igual que `weekdayOf`. */
export const WEEKDAY_NAMES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

/** 480 -> "08:00". Para mostrar y para el valor de un <input type="time">. */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * Dia de la semana y minutos desde medianoche de un instante, en hora local del
 * consultorio. Sirve para comparar un turno guardado en UTC contra las reglas
 * de atencion, que estan expresadas en hora de pared.
 */
export function localWeekdayAndMinutes(instant: Date): { weekday: number; minutes: number } {
  const parts = rawParts(instant);
  return {
    weekday: weekdayOf({ year: parts.year, month: parts.month, day: parts.day }),
    minutes: parts.hour * 60 + parts.minute,
  };
}

/** "08:00" -> 480. Devuelve `null` si no es una hora valida del dia. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;

  return hours * 60 + mins;
}

// ---------------------------------------------------------------------------
// Formato para mostrar
// ---------------------------------------------------------------------------

const timeFormatter = new Intl.DateTimeFormat('es-PY', {
  timeZone: CLINIC_TZ,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

const longDateFormatter = new Intl.DateTimeFormat('es-PY', {
  timeZone: CLINIC_TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const shortDateFormatter = new Intl.DateTimeFormat('es-PY', {
  timeZone: CLINIC_TZ,
  day: '2-digit',
  month: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('es-PY', {
  timeZone: CLINIC_TZ,
  weekday: 'short',
});

/** Fecha y hora completas, para correos y listados. */
const fullFormatter = new Intl.DateTimeFormat('es-PY', {
  timeZone: CLINIC_TZ,
  hourCycle: 'h23',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatTime = (instant: Date) => timeFormatter.format(instant);
export const formatLongDate = (instant: Date) => longDateFormatter.format(instant);
export const formatFull = (instant: Date) => fullFormatter.format(instant);

/** Etiquetas de una columna del calendario, a partir de una fecha de almanaque. */
export function dateLabels(date: CalendarDate) {
  const noon = zonedToUtc(date.year, date.month, date.day, 12 * 60);
  return {
    weekday: weekdayFormatter.format(noon).replace('.', ''),
    short: shortDateFormatter.format(noon),
    long: longDateFormatter.format(noon),
  };
}

// ---------------------------------------------------------------------------
// Construccion de la grilla semanal
// ---------------------------------------------------------------------------

export type SlotState = 'free' | 'pending' | 'confirmed' | 'blocked' | 'past';

/**
 * Estados que BLOQUEAN el horario: nadie mas puede solicitarlo.
 *
 * Los pendientes no estan: son solicitudes, no reservas. Varios pacientes
 * pueden pedir el mismo horario y administracion decide cual confirma.
 */
const BLOCKING: ReadonlySet<AppointmentStatus> = new Set(['confirmed', 'completed']);

export interface WeekAppointment {
  id: string;
  userId: string;
  startsAt: Date;
  status: AppointmentStatus;
  serviceName: string;
  patientName: string;
}

export interface Blackout {
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface SlotAppointment {
  id: string;
  status: AppointmentStatus;
  serviceName: string;
  /** `null` cuando el espectador no tiene derecho a saber de quien es el turno. */
  patientName: string | null;
  isOwn: boolean;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  state: SlotState;
  /**
   * Si el espectador puede solicitar este horario. Un horario con solicitudes
   * pendientes sigue siendo solicitable: solo un turno confirmado lo cierra.
   */
  bookable: boolean;
  /** Turno confirmado que ocupa el horario, si hay. */
  confirmed: SlotAppointment | null;
  /** Solicitudes pendientes compitiendo por el horario. */
  pending: SlotAppointment[];
  /** Si el espectador ya tiene un turno o solicitud en este horario. */
  isOwn: boolean;
  blockedReason: string | null;
}

export interface DayColumn {
  date: CalendarDate;
  iso: string;
  labels: ReturnType<typeof dateLabels>;
  isToday: boolean;
  slots: Slot[];
}

export interface BuildWeekOptions {
  weekStart: CalendarDate;
  rules: AvailabilityRule[];
  appointments: WeekAppointment[];
  blackouts: Blackout[];
  now: Date;
  viewer: { id: string; role: 'admin' | 'client' };
}

function overlapsBlackout(start: Date, end: Date, blackouts: Blackout[]): Blackout | null {
  for (const blackout of blackouts) {
    if (start < blackout.endsAt && end > blackout.startsAt) return blackout;
  }
  return null;
}

export function buildWeek(options: BuildWeekOptions): DayColumn[] {
  const { weekStart, rules, appointments, blackouts, now, viewer } = options;

  /** Turno confirmado por horario: como maximo uno, lo garantiza la base. */
  const confirmedBySlot = new Map<number, WeekAppointment>();
  /** Solicitudes pendientes por horario: pueden ser varias compitiendo. */
  const pendingBySlot = new Map<number, WeekAppointment[]>();

  for (const appointment of appointments) {
    const key = appointment.startsAt.getTime();
    if (BLOCKING.has(appointment.status)) {
      confirmedBySlot.set(key, appointment);
    } else if (appointment.status === 'pending') {
      const list = pendingBySlot.get(key) ?? [];
      list.push(appointment);
      pendingBySlot.set(key, list);
    }
  }

  /** Privacidad: un paciente nunca ve de quien es un turno ajeno. */
  const toSlotAppointment = (appointment: WeekAppointment): SlotAppointment => {
    const isOwn = appointment.userId === viewer.id;
    return {
      id: appointment.id,
      status: appointment.status,
      serviceName: appointment.serviceName,
      patientName: viewer.role === 'admin' || isOwn ? appointment.patientName : null,
      isOwn,
    };
  };

  const today = todayInClinic(now);
  const days: DayColumn[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStart, offset);
    const weekday = weekdayOf(date);
    const dayRules = rules
      .filter((rule) => rule.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);

    const slots: Slot[] = [];

    for (const rule of dayRules) {
      for (
        let minute = rule.startMinute;
        minute + rule.slotMinutes <= rule.endMinute;
        minute += rule.slotMinutes
      ) {
        const startsAt = zonedToUtc(date.year, date.month, date.day, minute);
        const endsAt = new Date(startsAt.getTime() + rule.slotMinutes * 60000);
        const key = startsAt.getTime();

        const confirmedRaw = confirmedBySlot.get(key);
        const pendingRaw = pendingBySlot.get(key) ?? [];

        const confirmed = confirmedRaw ? toSlotAppointment(confirmedRaw) : null;
        const pending = pendingRaw.map(toSlotAppointment);
        const isOwn = Boolean(confirmed?.isOwn) || pending.some((item) => item.isOwn);

        const isPast = startsAt.getTime() <= now.getTime();
        const blackout = overlapsBlackout(startsAt, endsAt, blackouts);

        /**
         * Prioridad de estados: confirmado > cerrado > pasado > pendiente > libre.
         *
         * Pendiente va DESPUES de pasado y cerrado a proposito: un horario que
         * ya paso o esta bloqueado no se puede solicitar aunque haya
         * solicitudes vivas encima.
         */
        let state: SlotState;
        if (confirmed) state = 'confirmed';
        else if (blackout) state = 'blocked';
        else if (isPast) state = 'past';
        else if (pending.length > 0) state = 'pending';
        else state = 'free';

        slots.push({
          startsAt,
          endsAt,
          state,
          // Solo un confirmado, un bloqueo o el paso del tiempo cierran el horario.
          bookable: !confirmed && !blackout && !isPast,
          confirmed,
          pending,
          isOwn,
          blockedReason: blackout?.reason ?? null,
        });
      }
    }

    days.push({
      date,
      iso: toISODate(date),
      labels: dateLabels(date),
      isToday: isSameDate(date, today),
      slots,
    });
  }

  return days;
}

/**
 * Valida que un instante caiga exactamente en un hueco de la grilla.
 * Impide que alguien reserve una hora arbitraria manipulando el formulario.
 */
export function isValidSlotStart(startsAt: Date, rules: AvailabilityRule[]): AvailabilityRule | null {
  const parts = rawParts(startsAt);
  const date: CalendarDate = { year: parts.year, month: parts.month, day: parts.day };
  const minutes = parts.hour * 60 + parts.minute;
  const weekday = weekdayOf(date);

  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    if (minutes < rule.startMinute) continue;
    if (minutes + rule.slotMinutes > rule.endMinute) continue;
    if ((minutes - rule.startMinute) % rule.slotMinutes !== 0) continue;
    // Confirma que el instante reconstruido coincide, descartando segundos sueltos.
    if (zonedToUtc(date.year, date.month, date.day, minutes).getTime() !== startsAt.getTime()) continue;
    return rule;
  }

  return null;
}
