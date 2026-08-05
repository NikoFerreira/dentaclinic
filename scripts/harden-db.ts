/**
 * Cierra el acceso publico a las tablas de la agenda.
 *
 * POR QUE HACE FALTA
 *
 * Supabase expone automaticamente todo el esquema `public` como API REST y
 * otorga permisos al rol `anon`, cuya clave viaja en el navegador. Nuestras
 * tablas se crean por migracion, y las migraciones NO activan el aislamiento
 * por filas. Sin este paso, una peticion como
 *
 *   GET https://<proyecto>.supabase.co/rest/v1/users?select=*
 *
 * devolveria nombres, telefonos, correos y motivos de consulta de los
 * pacientes: datos de salud, accesibles con una clave publica.
 *
 * QUE HACE
 *
 * 1. Activa row level security en cada tabla, sin definir politicas. Sin
 *    politicas, RLS deniega todo a `anon` y `authenticated`.
 * 2. Revoca los permisos de esos roles sobre las tablas (defensa en capas).
 *
 * La aplicacion sigue funcionando: se conecta como `postgres`, dueño de las
 * tablas, y en PostgreSQL el dueño no queda sujeto a RLS.
 *
 * Es idempotente: se puede volver a ejecutar sin efectos adversos.
 *
 *   npm run db:harden
 */
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from '../src/db/schema';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se asume que las variables ya estan en el entorno.
}

// DDL: hace falta la conexion de sesion, no el pooler en modo transaction.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error('Falta DIRECT_URL (o DATABASE_URL) en el entorno.');
}

/**
 * Los nombres salen del esquema, asi que una tabla nueva queda cubierta sola.
 * Se ensancha a `unknown[]` porque el modulo tambien exporta enums y tipos:
 * el predicado de abajo es el que separa las tablas.
 */
const tableNames = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table).name)
  .sort();

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

console.log(`Asegurando ${tableNames.length} tablas...\n`);

const roles = await sql<{ rolname: string }[]>`
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
`;
const publicRoles = roles.map((row) => row.rolname);

if (publicRoles.length === 0) {
  console.log('  (no existen los roles anon/authenticated: no es una base de Supabase)');
} else {
  console.log(`  roles públicos detectados: ${publicRoles.join(', ')}`);
}

for (const name of tableNames) {
  await sql`alter table public.${sql(name)} enable row level security`;

  if (publicRoles.includes('anon')) {
    await sql`revoke all on table public.${sql(name)} from anon`;
  }
  if (publicRoles.includes('authenticated')) {
    await sql`revoke all on table public.${sql(name)} from authenticated`;
  }

  console.log(`  ${name}: RLS activado${publicRoles.length ? ' y permisos revocados' : ''}`);
}

// ---------------------------------------------------------------------------
// Verificacion: se comprueba el estado real, no se asume que los ALTER surtieron efecto.
// ---------------------------------------------------------------------------
console.log('\nVerificación');

const rlsState = await sql<{ relname: string; relrowsecurity: boolean }[]>`
  select c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(${tableNames})
  order by c.relname
`;

const sinRls = rlsState.filter((row) => !row.relrowsecurity).map((row) => row.relname);
console.log(
  sinRls.length === 0
    ? `  RLS activo en las ${rlsState.length} tablas`
    : `  FALTA activar RLS en: ${sinRls.join(', ')}`,
);

const policies = await sql<{ count: string }[]>`
  select count(*)::text as count from pg_policies where schemaname = 'public'
`;
console.log(`  políticas definidas: ${policies[0].count} (0 significa "denegar todo" para anon)`);

if (publicRoles.length > 0) {
  const grants = await sql<{ table_name: string; grantee: string; privilege_type: string }[]>`
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = any(${publicRoles})
      and table_name = any(${tableNames})
  `;
  console.log(
    grants.length === 0
      ? '  permisos de anon/authenticated: ninguno'
      : `  ATENCIÓN: quedan ${grants.length} permisos: ${grants
          .slice(0, 6)
          .map((g) => `${g.grantee}->${g.table_name}:${g.privilege_type}`)
          .join(', ')}`,
  );
}

console.log('\nListo. Comprobá desde afuera que la API pública no devuelve datos:');
console.log('  curl "https://<proyecto>.supabase.co/rest/v1/users?select=*" -H "apikey: <clave-anon>"');

await sql.end();
process.exit(sinRls.length === 0 ? 0 : 1);
