/**
 * Carga inicial de la base: especialidades, horarios de atencion y el primer
 * usuario administrador.
 *
 * Se puede volver a ejecutar sin duplicar datos.
 *   npm run db:seed
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index';
import { availabilityRules, services, users } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

// Carga .env sin dependencias externas (Node 20.12+).
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se asume que las variables ya estan en el entorno.
}

const SPECIALTIES = [
  { slug: 'odontologia-general', name: 'Odontología general' },
  { slug: 'estetica-dental', name: 'Estética dental' },
  { slug: 'ortodoncia', name: 'Ortodoncia' },
  { slug: 'endodoncia', name: 'Endodoncia' },
  { slug: 'odontopediatria', name: 'Odontopediatría' },
  { slug: 'urgencia-dental', name: 'Urgencia dental' },
];

/**
 * Horarios en minutos desde medianoche, hora de Asuncion.
 * Lunes a viernes 08:00-12:00 y 14:00-20:00; sabados 08:00-13:00.
 * Turnos de 60 minutos.
 */
const SCHEDULE = [
  ...[1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 8 * 60, endMinute: 12 * 60, slotMinutes: 60 },
    { weekday, startMinute: 14 * 60, endMinute: 20 * 60, slotMinutes: 60 },
  ]),
  { weekday: 6, startMinute: 8 * 60, endMinute: 13 * 60, slotMinutes: 60 },
];

async function seedServices() {
  await db.insert(services).values(SPECIALTIES).onConflictDoNothing();
  const rows = await db.select({ id: services.id }).from(services);
  console.log(`  especialidades: ${rows.length}`);
}

async function seedSchedule() {
  const existing = await db.select({ id: availabilityRules.id }).from(availabilityRules);
  if (existing.length > 0) {
    console.log(`  horarios: ${existing.length} reglas ya cargadas, se dejan como estan`);
    return;
  }
  await db.insert(availabilityRules).values(SCHEDULE);
  console.log(`  horarios: ${SCHEDULE.length} reglas creadas`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('  admin: se omite (faltan ADMIN_EMAIL y/o ADMIN_PASSWORD en .env)');
    return;
  }

  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres.');
  }

  const passwordHash = await hashPassword(password);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existing.length > 0) {
    // Reejecutar el seed actualiza la clave, util si se perdio el acceso.
    await db.update(users).set({ passwordHash, role: 'admin' }).where(eq(users.email, email));
    console.log(`  admin: ${email} ya existía, contraseña y rol actualizados`);
    return;
  }

  await db.insert(users).values({
    email,
    passwordHash,
    fullName: process.env.ADMIN_NAME?.trim() || 'Administración',
    phone: process.env.ADMIN_PHONE?.trim() || '+595 21 555 0180',
    role: 'admin',
  });
  console.log(`  admin: ${email} creado`);
}

console.log('Cargando datos iniciales...');
await seedServices();
await seedSchedule();
await seedAdmin();
console.log('Listo.');

process.exit(0);
