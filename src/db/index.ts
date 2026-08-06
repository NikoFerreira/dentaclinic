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
  /**
   * En produccion (Vercel) cada invocacion es un proceso efimero: una sola
   * conexion es lo recomendado y abrir mas solo agota el limite del pooler.
   *
   * En desarrollo el proceso vive horas, y con `max: 1` una consulta trabada
   * encola todas las siguientes de forma permanente: la aplicacion queda
   * colgada hasta reiniciarla. Se observo en la practica. Un pool pequeno evita
   * que un unico problema tumbe todo.
   *
   * No se intenta imponer `statement_timeout` desde el cliente: se comprobo que
   * el pooler de Supabase en modo transaction ignora ese parametro de arranque,
   * tanto como opcion de conexion como via `-c`. Para acotarlo de verdad habria
   * que fijarlo en el rol de la base (ALTER ROLE ... SET statement_timeout).
   */
  const isProduction = process.env.NODE_ENV === 'production';

  const client = postgres(url, {
    prepare: false,
    max: isProduction ? 1 : 5,
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
