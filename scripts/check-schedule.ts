/**
 * Comprobaciones de la logica de horarios (src/lib/schedule.ts).
 *
 * No necesita base de datos: verifica conversion de zona horaria, armado de la
 * grilla semanal y validacion de huecos, que es donde se concentra el riesgo de
 * errores sutiles.
 *
 *   npm run check:schedule
 */
import type { AvailabilityRule } from '../src/db/schema';
import {
  addDays,
  buildWeek,
  formatTime,
  isValidSlotStart,
  parseISODate,
  startOfWeek,
  toISODate,
  tzOffsetMinutes,
  zonedToUtc,
} from '../src/lib/schedule';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failures.push(`${label}\n    esperado: ${e}\n    obtenido: ${a}`);
  }
}

// --- Zona horaria -----------------------------------------------------------
// Paraguay esta en UTC-3, asi que las 08:00 locales son las 11:00 UTC.
const morning = zonedToUtc(2026, 8, 12, 8 * 60);
check('08:00 de Asunción en UTC', morning.toISOString(), '2026-08-12T11:00:00.000Z');
check('desplazamiento en minutos', tzOffsetMinutes(morning), -180);
check('formatTime devuelve la hora local', formatTime(morning), '08:00');

// Ida y vuelta: el instante reconstruido debe dar la misma hora de pared.
const evening = zonedToUtc(2026, 12, 31, 19 * 60 + 30);
check('ida y vuelta 19:30', formatTime(evening), '19:30');
check('medianoche local', formatTime(zonedToUtc(2026, 3, 1, 0)), '00:00');

// --- Fechas de calendario ---------------------------------------------------
check('lunes de una semana (miércoles)', toISODate(startOfWeek({ year: 2026, month: 8, day: 5 })), '2026-08-03');
check('lunes de una semana (domingo)', toISODate(startOfWeek({ year: 2026, month: 8, day: 9 })), '2026-08-03');
check('lunes se mantiene', toISODate(startOfWeek({ year: 2026, month: 8, day: 3 })), '2026-08-03');
check('cruce de mes', toISODate(addDays({ year: 2026, month: 1, day: 31 }, 1)), '2026-02-01');
check('año bisiesto', toISODate(addDays({ year: 2028, month: 2, day: 28 }, 1)), '2028-02-29');
check('rechaza fecha inexistente', parseISODate('2026-02-31'), null);
check('rechaza formato basura', parseISODate('no-es-fecha'), null);
check('acepta fecha válida', parseISODate('2026-08-12'), { year: 2026, month: 8, day: 12 });

// --- Grilla semanal --------------------------------------------------------
const rules: AvailabilityRule[] = [
  { id: 1, weekday: 1, startMinute: 8 * 60, endMinute: 12 * 60, slotMinutes: 60 },
  { id: 2, weekday: 1, startMinute: 14 * 60, endMinute: 20 * 60, slotMinutes: 60 },
  { id: 3, weekday: 6, startMinute: 8 * 60, endMinute: 13 * 60, slotMinutes: 60 },
];

const weekStart = { year: 2026, month: 8, day: 3 }; // lunes
const now = zonedToUtc(2026, 8, 3, 10 * 60); // lunes 10:00 local

const week = buildWeek({
  weekStart,
  rules,
  appointments: [
    {
      id: 'a1',
      userId: 'paciente-1',
      startsAt: zonedToUtc(2026, 8, 3, 15 * 60),
      status: 'confirmed',
      serviceName: 'Ortodoncia',
      patientName: 'Ana Giménez',
    },
    {
      id: 'a2',
      userId: 'paciente-2',
      startsAt: zonedToUtc(2026, 8, 3, 16 * 60),
      status: 'pending',
      serviceName: 'Endodoncia',
      patientName: 'Luis Rojas',
    },
    {
      id: 'a3',
      userId: 'paciente-1',
      startsAt: zonedToUtc(2026, 8, 3, 17 * 60),
      status: 'cancelled', // cancelado: NO debe ocupar el horario
      serviceName: 'Ortodoncia',
      patientName: 'Ana Giménez',
    },
  ],
  blackouts: [
    {
      startsAt: zonedToUtc(2026, 8, 8, 8 * 60),
      endsAt: zonedToUtc(2026, 8, 8, 13 * 60),
      reason: 'Feriado',
    },
  ],
  now,
  viewer: { id: 'paciente-1', role: 'client' },
});

check('la semana tiene 7 días', week.length, 7);
check('lunes: 4 + 6 huecos', week[0].slots.length, 10);
check('martes sin reglas: 0 huecos', week[1].slots.length, 0);
check('sábado: 5 huecos', week[5].slots.length, 5);

const monday = week[0].slots;
check('08:00 del lunes ya pasó', monday[0].state, 'past');
check('un horario pasado no es solicitable', monday[0].bookable, false);
check('09:00 del lunes ya pasó', monday[1].state, 'past');
check('14:00 sigue libre', monday[4].state, 'free');
check('un hueco libre es solicitable', monday[4].bookable, true);
check('15:00 está confirmado', monday[5].state, 'confirmed');
check('un confirmado CIERRA el horario', monday[5].bookable, false);
check('16:00 está pendiente', monday[6].state, 'pending');
check('un pendiente NO cierra el horario: sigue solicitable', monday[6].bookable, true);
check('el pendiente figura en la lista de solicitudes', monday[6].pending.length, 1);
check('17:00 cancelado vuelve a libre', monday[7].state, 'free');

check('turno propio se marca como propio', monday[5].confirmed?.isOwn, true);
check('ve el nombre en su propio turno', monday[5].confirmed?.patientName, 'Ana Giménez');
// Privacidad: el turno de otro paciente no debe revelar su identidad.
check('solicitud ajena oculta el nombre', monday[6].pending[0]?.patientName, null);
check('solicitud ajena no se marca como propia', monday[6].pending[0]?.isOwn, false);

check('sábado bloqueado por feriado', week[5].slots[0].state, 'blocked');
check('motivo del bloqueo', week[5].slots[0].blockedReason, 'Feriado');
check('un horario cerrado no es solicitable', week[5].slots[0].bookable, false);

// Un administrador sí ve los nombres de todos.
const adminWeek = buildWeek({
  weekStart,
  rules,
  appointments: [
    {
      id: 'a2',
      userId: 'paciente-2',
      startsAt: zonedToUtc(2026, 8, 3, 16 * 60),
      status: 'pending',
      serviceName: 'Endodoncia',
      patientName: 'Luis Rojas',
    },
  ],
  blackouts: [],
  now,
  viewer: { id: 'admin-1', role: 'admin' },
});
check('el admin ve el nombre del paciente', adminWeek[0].slots[6].pending[0]?.patientName, 'Luis Rojas');

// --- Validacion de huecos (defensa contra parámetros manipulados) ----------
check('acepta un inicio válido', isValidSlotStart(zonedToUtc(2026, 8, 3, 8 * 60), rules)?.id, 1);
check('acepta el segundo tramo', isValidSlotStart(zonedToUtc(2026, 8, 3, 14 * 60), rules)?.id, 2);
check('rechaza hora fuera de grilla', isValidSlotStart(zonedToUtc(2026, 8, 3, 8 * 60 + 17), rules), null);
check('rechaza el hueco de la siesta', isValidSlotStart(zonedToUtc(2026, 8, 3, 13 * 60), rules), null);
check('rechaza después del cierre', isValidSlotStart(zonedToUtc(2026, 8, 3, 20 * 60), rules), null);
check('rechaza día sin atención', isValidSlotStart(zonedToUtc(2026, 8, 4, 8 * 60), rules), null);
check('rechaza domingo', isValidSlotStart(zonedToUtc(2026, 8, 9, 8 * 60), rules), null);

// --- Resultado --------------------------------------------------------------
console.log(`\n${passed} comprobaciones correctas`);
if (failures.length > 0) {
  console.error(`${failures.length} FALLARON:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('Toda la lógica de horarios se comporta como se espera.\n');
