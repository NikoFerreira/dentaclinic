/**
 * Datos de demostracion para una instancia compartible.
 *
 * Crea cuentas de prueba y turnos en distintos estados, para que quien abra la
 * URL encuentre una agenda con contenido en lugar de un calendario vacio.
 *
 * TODO son datos ficticios y las contrasenas son publicas a proposito: esta
 * instancia es una demo. NUNCA cargar pacientes reales en una base donde corrio
 * este script.
 *
 * Es idempotente y solo toca las cuentas `demo.*`: no borra ni modifica datos
 * de otros usuarios.
 *
 *   npm run demo:seed
 */
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '../src/db';
import { appointments, availabilityRules, blackouts, services, users } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';
import {
  addDays,
  formatFull,
  todayInClinic,
  weekdayOf,
  zonedToUtc,
} from '../src/lib/schedule';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se asume que las variables ya estan en el entorno.
}

/** Contrasena compartida por todas las cuentas de demostracion. */
const DEMO_PASSWORD = 'demo-dentaclinic-2026';

const DEMO_ADMIN = {
  email: 'demo.admin@dentaclinic.local',
  fullName: 'Administración (demo)',
  phone: '+595 21 555 0180',
};

const DEMO_PATIENTS = [
  { email: 'demo.ana@dentaclinic.local', fullName: 'Ana Giménez', phone: '+595 981 111 222' },
  { email: 'demo.luis@dentaclinic.local', fullName: 'Luis Rojas', phone: '+595 981 333 444' },
  { email: 'demo.sofia@dentaclinic.local', fullName: 'Sofía Vera', phone: '+595 981 555 666' },
];

async function upsertUser(
  person: { email: string; fullName: string; phone: string },
  role: 'admin' | 'client',
  passwordHash: string,
): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, person.email))
    .limit(1);

  if (existing[0]) {
    // Se reestablece la contrasena y el rol: el script sirve tambien para
    // recuperar el acceso a la demo si alguien lo cambio.
    await db
      .update(users)
      .set({ passwordHash, role, failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, existing[0].id));
    return existing[0].id;
  }

  const [created] = await db
    .insert(users)
    .values({ ...person, passwordHash, role })
    .returning({ id: users.id });

  return created.id;
}

/** Huecos futuros validos, tomados de las reglas de atencion reales. */
async function futureSlots(howMany: number): Promise<Date[]> {
  const rules = await db.select().from(availabilityRules);
  if (rules.length === 0) {
    throw new Error('No hay horarios de atención cargados. Ejecutá primero: npm run db:seed');
  }

  const found: Date[] = [];
  const today = todayInClinic();

  for (let offset = 0; offset <= 21 && found.length < howMany; offset += 1) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);

    const dayRules = rules
      .filter((rule) => rule.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);

    for (const rule of dayRules) {
      for (
        let minute = rule.startMinute;
        minute + rule.slotMinutes <= rule.endMinute;
        minute += rule.slotMinutes
      ) {
        const startsAt = zonedToUtc(date.year, date.month, date.day, minute);
        // Margen de una hora: evita que el turno quede en el pasado mientras
        // alguien recorre la demo.
        if (startsAt.getTime() > Date.now() + 3_600_000) {
          found.push(startsAt);
          if (found.length >= howMany) break;
        }
      }
      if (found.length >= howMany) break;
    }
  }

  if (found.length < howMany) {
    throw new Error(
      `Solo se encontraron ${found.length} huecos futuros de los ${howMany} necesarios. Revisá los horarios de atención.`,
    );
  }

  return found;
}

console.log('Cargando datos de demostración...\n');

const passwordHash = await hashPassword(DEMO_PASSWORD);

await upsertUser(DEMO_ADMIN, 'admin', passwordHash);

const patientIds: string[] = [];
for (const patient of DEMO_PATIENTS) {
  patientIds.push(await upsertUser(patient, 'client', passwordHash));
}
console.log(`  cuentas: 1 administración + ${patientIds.length} pacientes`);

const serviceRows = await db.select().from(services);
if (serviceRows.length === 0) {
  throw new Error('No hay especialidades cargadas. Ejecutá primero: npm run db:seed');
}
const serviceId = (slug: string) =>
  serviceRows.find((service) => service.slug === slug)?.id ?? serviceRows[0].id;

// Solo los turnos de las cuentas de demo, para que el script sea repetible sin
// chocar con el indice unico de horarios.
const removed = await db
  .delete(appointments)
  .where(inArray(appointments.userId, patientIds))
  .returning({ id: appointments.id });
if (removed.length > 0) console.log(`  turnos de demo anteriores eliminados: ${removed.length}`);

const slots = await futureSlots(6);

const planned = [
  {
    label: 'PENDIENTE',
    userId: patientIds[0],
    serviceId: serviceId('ortodoncia'),
    startsAt: slots[0],
    status: 'pending' as const,
    notes: 'Quiero consultar por alineadores invisibles.',
  },
  {
    label: 'PENDIENTE',
    userId: patientIds[1],
    serviceId: serviceId('urgencia-dental'),
    startsAt: slots[1],
    status: 'pending' as const,
    notes: 'Me duele una muela desde anoche.',
  },
  {
    label: 'CONFIRMADO',
    userId: patientIds[1],
    serviceId: serviceId('odontologia-general'),
    startsAt: slots[2],
    status: 'confirmed' as const,
    notes: null,
  },
  {
    label: 'CONFIRMADO',
    userId: patientIds[2],
    serviceId: serviceId('estetica-dental'),
    startsAt: slots[3],
    status: 'confirmed' as const,
    notes: 'Consulta por blanqueamiento.',
  },
  {
    label: 'CANCELADO',
    userId: patientIds[0],
    serviceId: serviceId('odontologia-general'),
    startsAt: slots[4],
    status: 'cancelled' as const,
    notes: null,
  },
];

for (const item of planned) {
  await db.insert(appointments).values({
    userId: item.userId,
    serviceId: item.serviceId,
    startsAt: item.startsAt,
    endsAt: new Date(item.startsAt.getTime() + 60 * 60 * 1000),
    status: item.status,
    notes: item.notes,
  });
  console.log(`  ${item.label.padEnd(11)} ${formatFull(item.startsAt)}`);
}

// Un feriado la semana proxima, para que se vea el estado "cerrado" con rayado.
const holiday = addDays(todayInClinic(), 8);
const holidayStart = zonedToUtc(holiday.year, holiday.month, holiday.day, 0);
const holidayEnd = new Date(holidayStart.getTime() + 24 * 60 * 60 * 1000);

// Solapamiento: la columna va primero en cada comparacion, porque Drizzle
// enlaza el parametro del lado derecho.
const alreadyBlocked = await db
  .select({ id: blackouts.id })
  .from(blackouts)
  .where(and(lt(blackouts.startsAt, holidayEnd), gt(blackouts.endsAt, holidayStart)))
  .limit(1);

if (alreadyBlocked.length === 0) {
  await db
    .insert(blackouts)
    .values({ startsAt: holidayStart, endsAt: holidayEnd, reason: 'Feriado nacional' });
  console.log(`  CERRADO     ${holiday.day}/${holiday.month} (feriado)`);
}

console.log('\n' + '='.repeat(58));
console.log('Cuentas de demostración — contraseña compartida:');
console.log(`  ${DEMO_PASSWORD}`);
console.log('');
console.log(`  administración: ${DEMO_ADMIN.email}`);
for (const patient of DEMO_PATIENTS) console.log(`  paciente:       ${patient.email}`);
console.log('='.repeat(58));
console.log('\nSon datos ficticios y las contraseñas son públicas.');
console.log('No cargar pacientes reales en esta base.');

process.exit(0);
