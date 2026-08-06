/**
 * Verificacion de integracion de la agenda contra Postgres real.
 *
 * Usa PGlite: Postgres compilado a WebAssembly, corriendo dentro de este mismo
 * proceso y en memoria. No hace falta instalar Postgres ni crear cuenta en
 * ningun proveedor, y la base se descarta al terminar.
 *
 * Aplica la MISMA migracion que produccion y ejercita los flujos reales:
 * hasheo de contrasenas, reserva, garantia anti-duplicados, liberacion de
 * horarios y armado del calendario.
 *
 *   npm run check:agenda
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq, gte, lt } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { appointments, availabilityRules, blackouts, services, users } from '../src/db/schema';
import { hashPassword, verifyPassword } from '../src/lib/password';
import {
  addDays,
  buildWeek,
  isValidSlotStart,
  startOfWeek,
  todayInClinic,
  weekdayOf,
  zonedToUtc,
  type WeekAppointment,
} from '../src/lib/schedule';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FALLA  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// Se importa la funcion de produccion a proposito: si deja de detectar las
// violaciones de unicidad, estas comprobaciones fallan.
import { isUniqueViolation } from '../src/lib/http';

// ---------------------------------------------------------------------------
// Base en memoria + migracion real
// ---------------------------------------------------------------------------

const client = new PGlite();
const db = drizzle(client, { schema });

const migrationsDir = join(process.cwd(), 'drizzle');
const sqlFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

console.log(`Aplicando ${sqlFiles.length} migración(es) a Postgres en memoria...`);

for (const file of sqlFiles) {
  const contents = readFileSync(join(migrationsDir, file), 'utf8');
  for (const statement of contents.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await client.exec(trimmed);
  }
  console.log(`  ${file}`);
}

// ---------------------------------------------------------------------------
// 1. Estructura
// ---------------------------------------------------------------------------
console.log('\nEstructura de la base');

const tables = await client.query<{ tablename: string }>(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`,
);
const tableNames = tables.rows.map((row) => row.tablename);
for (const expected of [
  'appointments',
  'availability_rules',
  'blackouts',
  'contact_requests',
  'services',
  'sessions',
  'users',
]) {
  check(`tabla ${expected}`, tableNames.includes(expected), `existentes: ${tableNames.join(', ')}`);
}

const indexes = await client.query<{ indexdef: string; indexname: string }>(
  `select indexname, indexdef from pg_indexes where schemaname = 'public'`,
);
const slotIndex = indexes.rows.find((row) => row.indexname === 'appointments_active_slot_unique');
check('índice único parcial de horarios existe', Boolean(slotIndex));
check(
  'el índice es UNIQUE y filtra por estado',
  Boolean(slotIndex?.indexdef.includes('UNIQUE') && slotIndex?.indexdef.toLowerCase().includes('where')),
  slotIndex?.indexdef ?? '',
);

// ---------------------------------------------------------------------------
// 2. Datos base
// ---------------------------------------------------------------------------
console.log('\nCarga inicial');

await db.insert(services).values([
  { slug: 'odontologia-general', name: 'Odontología general', durationMinutes: 60 },
  { slug: 'ortodoncia', name: 'Ortodoncia', durationMinutes: 60 },
]);

await db.insert(availabilityRules).values(
  [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 8 * 60, endMinute: 12 * 60, slotMinutes: 60 },
    { weekday, startMinute: 14 * 60, endMinute: 20 * 60, slotMinutes: 60 },
  ]),
);

const rules = await db.select().from(availabilityRules);
check('reglas de atención cargadas', rules.length === 10, `${rules.length} reglas`);

const serviceRows = await db.select().from(services);
const generalId = serviceRows.find((s) => s.slug === 'odontologia-general')!.id;

// ---------------------------------------------------------------------------
// 3. Contrasenas
// ---------------------------------------------------------------------------
console.log('\nAutenticación');

const hash = await hashPassword('contrasena-de-prueba-larga');
check('el hash es Argon2id', hash.startsWith('$argon2id$'), hash.slice(0, 20));
check('no guarda la contraseña en claro', !hash.includes('contrasena-de-prueba-larga'));
check('acepta la contraseña correcta', await verifyPassword(hash, 'contrasena-de-prueba-larga'));
check('rechaza la contraseña incorrecta', !(await verifyPassword(hash, 'otra-cosa')));
check('rechaza un hash corrupto sin lanzar', !(await verifyPassword('no-es-un-hash', 'x')));

const [admin] = await db
  .insert(users)
  .values({
    email: 'admin@dentaclinic.local',
    passwordHash: hash,
    fullName: 'Administración',
    phone: '+595 21 555 0180',
    role: 'admin',
  })
  .returning({ id: users.id, role: users.role });

const [ana] = await db
  .insert(users)
  .values({
    email: 'ana@example.com',
    passwordHash: hash,
    fullName: 'Ana Giménez',
    phone: '+595 981 111 222',
  })
  .returning({ id: users.id, role: users.role });

const [luis] = await db
  .insert(users)
  .values({
    email: 'luis@example.com',
    passwordHash: hash,
    fullName: 'Luis Rojas',
    phone: '+595 981 333 444',
  })
  .returning({ id: users.id, role: users.role });

check('el rol por defecto es client', ana.role === 'client', ana.role);
check('el admin conserva su rol', admin.role === 'admin');

let duplicateEmailRejected = false;
try {
  await db
    .insert(users)
    .values({
      email: 'ana@example.com',
      passwordHash: hash,
      fullName: 'Otra Ana',
      phone: '+595 981 000 000',
    });
} catch (error) {
  duplicateEmailRejected = isUniqueViolation(error);
}
check('la base rechaza correos duplicados', duplicateEmailRejected);

// ---------------------------------------------------------------------------
// 4. Reserva y garantia anti-duplicados
// ---------------------------------------------------------------------------
console.log('\nReserva de turnos');

/** Primer hueco válido a futuro, según las reglas cargadas. */
function nextSlot(skip = 0): Date {
  const today = todayInClinic();
  let seen = 0;
  for (let offset = 0; offset <= 21; offset += 1) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);
    const dayRules = rules
      .filter((rule) => rule.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (const rule of dayRules) {
      for (let m = rule.startMinute; m + rule.slotMinutes <= rule.endMinute; m += rule.slotMinutes) {
        const startsAt = zonedToUtc(date.year, date.month, date.day, m);
        if (startsAt.getTime() > Date.now() + 3600_000) {
          if (seen === skip) return startsAt;
          seen += 1;
        }
      }
    }
  }
  throw new Error('no se encontró un hueco futuro');
}

const slotA = nextSlot(0);
const slotB = nextSlot(1);

check('el hueco elegido es válido según las reglas', isValidSlotStart(slotA, rules) !== null);
check(
  'rechaza una hora fuera de la grilla (08:17)',
  isValidSlotStart(new Date(slotA.getTime() + 17 * 60000), rules) === null,
);

const book = (userId: string, startsAt: Date, status: 'pending' | 'confirmed' = 'pending') =>
  db
    .insert(appointments)
    .values({
      userId,
      serviceId: generalId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      status,
    })
    .returning({ id: appointments.id });

const [anaAppointment] = await book(ana.id, slotA);
check('Ana solicita un horario libre', Boolean(anaAppointment.id));

/**
 * Varias SOLICITUDES por el mismo horario estan permitidas a proposito: un
 * pendiente es un pedido, no una reserva. Si bloqueara, el primero en pedir se
 * quedaria el horario aunque despues no le sirviera.
 */
let segundaSolicitud = false;
try {
  await book(luis.id, slotA);
  segundaSolicitud = true;
} catch {
  segundaSolicitud = false;
}
check('la base ADMITE una segunda solicitud para el mismo horario', segundaSolicitud);

// Pero un CONFIRMADO si cierra el horario.
const slotConfirmado = nextSlot(5);
await book(ana.id, slotConfirmado, 'confirmed');

let segundoConfirmadoRechazado = false;
try {
  await book(luis.id, slotConfirmado, 'confirmed');
} catch (error) {
  segundoConfirmadoRechazado = isUniqueViolation(error);
}
check('la BASE impide DOS turnos confirmados en el mismo horario', segundoConfirmadoRechazado);

// Dos confirmaciones realmente simultaneas: solo una debe sobrevivir.
const raceSlot = nextSlot(2);
const raceResults = await Promise.allSettled([
  book(ana.id, raceSlot, 'confirmed'),
  book(luis.id, raceSlot, 'confirmed'),
]);
const fulfilled = raceResults.filter((r) => r.status === 'fulfilled').length;
check('ante dos confirmaciones simultáneas solo una gana', fulfilled === 1, `${fulfilled} exitosas`);

// ---------------------------------------------------------------------------
// 5. Transiciones de estado
// ---------------------------------------------------------------------------
console.log('\nEstados del turno');

await db.update(appointments).set({ status: 'confirmed' }).where(eq(appointments.id, anaAppointment.id));
const confirmedRow = await db
  .select({ status: appointments.status })
  .from(appointments)
  .where(eq(appointments.id, anaAppointment.id));
check('administración confirma el turno', confirmedRow[0].status === 'confirmed');

// Cancelar debe LIBERAR el horario: el indice parcial excluye los cancelados.
const [luisAppointment] = await book(luis.id, slotB);
await db.update(appointments).set({ status: 'cancelled' }).where(eq(appointments.id, luisAppointment.id));

let rebookedAfterCancel = false;
try {
  await book(ana.id, slotB);
  rebookedAfterCancel = true;
} catch {
  rebookedAfterCancel = false;
}
check('cancelar libera el horario para otra persona', rebookedAfterCancel);

// ---------------------------------------------------------------------------
// 6. Calendario
// ---------------------------------------------------------------------------
console.log('\nCalendario semanal');

const weekStart = startOfWeek(todayInClinic());
const weekEnd = addDays(weekStart, 7);
const from = zonedToUtc(weekStart.year, weekStart.month, weekStart.day, 0);
const to = zonedToUtc(weekEnd.year, weekEnd.month, weekEnd.day, 0);

const rows = await db
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

const blackoutRows = await db.select().from(blackouts);
const weekRows = rows as WeekAppointment[];

const adminWeek = buildWeek({
  weekStart,
  rules,
  appointments: weekRows,
  blackouts: blackoutRows,
  now: new Date(),
  viewer: { id: admin.id, role: 'admin' },
});

const luisWeek = buildWeek({
  weekStart,
  rules,
  appointments: weekRows,
  blackouts: blackoutRows,
  now: new Date(),
  viewer: { id: luis.id, role: 'client' },
});

check('el calendario arma 7 días', adminWeek.length === 7);

const allSlots = adminWeek.flatMap((day) => day.slots);
check('hay huecos libres', allSlots.some((slot) => slot.state === 'free'));

const findSlot = (week: typeof adminWeek, at: Date) =>
  week.flatMap((day) => day.slots).find((slot) => slot.startsAt.getTime() === at.getTime());

const adminSlotA = findSlot(adminWeek, slotA);
const luisSlotA = findSlot(luisWeek, slotA);

if (!adminSlotA || !luisSlotA) {
  check('el turno de Ana aparece en la semana en curso', false, 'cae en otra semana; se omite');
} else {
  check('el turno confirmado se pinta como confirmado', adminSlotA.state === 'confirmed', adminSlotA.state);
  check('un confirmado CIERRA el horario', adminSlotA.bookable === false);
  check('administración ve el nombre del paciente', adminSlotA.confirmed?.patientName === 'Ana Giménez');
  check(
    'PRIVACIDAD: otro paciente ve el horario ocupado pero sin el nombre',
    luisSlotA.state === 'confirmed' && luisSlotA.confirmed?.patientName === null,
    `estado=${luisSlotA.state} nombre=${String(luisSlotA.confirmed?.patientName)}`,
  );
  check('el turno ajeno no se marca como propio', luisSlotA.confirmed?.isOwn === false);
}

// Bloqueo por feriado
const holiday = addDays(todayInClinic(), 1);
const holidayStart = zonedToUtc(holiday.year, holiday.month, holiday.day, 0);
await db.insert(blackouts).values({
  startsAt: holidayStart,
  endsAt: new Date(holidayStart.getTime() + 86_400_000),
  reason: 'Feriado nacional',
});

const withHoliday = buildWeek({
  weekStart,
  rules,
  appointments: [],
  blackouts: await db.select().from(blackouts),
  now: new Date(),
  viewer: { id: admin.id, role: 'admin' },
});
const holidaySlots = withHoliday
  .flatMap((day) => day.slots)
  .filter((slot) => slot.startsAt >= holidayStart && slot.startsAt < new Date(holidayStart.getTime() + 86_400_000));

if (holidaySlots.length === 0) {
  check('el feriado cae en un día con atención', false, 'cayó en domingo; se omite');
} else {
  check('los horarios del feriado quedan cerrados', holidaySlots.every((slot) => slot.state === 'blocked'));
  check('el bloqueo informa el motivo', holidaySlots[0].blockedReason === 'Feriado nacional');
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(58));
if (failures.length === 0) {
  console.log(`${passed} comprobaciones, todas correctas.`);
} else {
  console.log(`${passed} correctas, ${failures.length} FALLIDAS:`);
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log('='.repeat(58));

await client.close();
process.exit(failures.length === 0 ? 0 : 1);
