import { defineConfig } from 'drizzle-kit';

// Carga .env sin dependencias externas (Node 20.12+).
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se asume que las variables ya estan en el entorno.
}

// Las migraciones usan la conexion directa: el pooler de Supabase en modo
// transaction no admite las sentencias DDL que genera drizzle-kit.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'Falta DIRECT_URL (o DATABASE_URL) en el entorno. Copiá .env.example como .env y completalo.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
