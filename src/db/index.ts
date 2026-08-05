import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | null = null;

function connect(): Database {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Falta DATABASE_URL. En local: copiá .env.example como .env y completalo. ' +
        'En Vercel: Project Settings -> Environment Variables.',
    );
  }

  /**
   * `prepare: false` es obligatorio con el pooler de Supabase en modo transaction:
   * no mantiene la sesion entre consultas, asi que los prepared statements fallan.
   *
   * `max: 1` porque cada invocacion serverless es un proceso efimero; abrir mas
   * conexiones por instancia solo agota el limite del pooler.
   */
  const client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

/**
 * Conexion diferida: importar este modulo no abre nada ni exige variables de
 * entorno. La conexion se crea en la primera consulta real.
 *
 * Hace falta porque el middleware de Astro tambien se ejecuta al prerenderizar
 * la landing durante el build, cuando no hay base de datos disponible.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    instance ??= connect();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export { schema };
