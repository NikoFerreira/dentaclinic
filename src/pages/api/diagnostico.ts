import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * DIAGNOSTICO TEMPORAL. Eliminar en cuanto se resuelva el problema de conexion.
 *
 * Informa el ESTADO de las variables de conexion sin revelar su contenido:
 * si estan presentes, si el formato es valido, y qué error devuelve la base.
 * Nunca imprime la contrasena, y el mensaje de error se redacta por si acaso.
 *
 * Protegido con un token en la query para que no quede accesible a cualquiera.
 */
const TOKEN = '1b5c4c800088e501a4904f0d414eb208';

/** Quita la contrasena de cualquier texto antes de devolverlo. */
function redact(text: string, secrets: string[]): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret && secret.length > 3) safe = safe.split(secret).join('«oculto»');
  }
  return safe;
}

function inspect(raw: string | undefined) {
  if (!raw) return { presente: false as const };

  const empiezaConComilla = raw.startsWith('"') || raw.startsWith("'");
  const terminaConComilla = raw.endsWith('"') || raw.endsWith("'");

  let host: string | null = null;
  let puerto: string | null = null;
  let usuario: boolean | null = null;
  let password: boolean | null = null;
  let urlValida = false;

  try {
    const url = new URL(raw);
    host = url.hostname;
    puerto = url.port;
    usuario = url.username.length > 0;
    password = url.password.length > 0;
    urlValida = url.protocol === 'postgresql:' || url.protocol === 'postgres:';
  } catch {
    urlValida = false;
  }

  return {
    presente: true as const,
    longitud: raw.length,
    empiezaConComilla,
    terminaConComilla,
    esquema: raw.slice(0, 13),
    urlValida,
    host,
    puerto,
    tieneUsuario: usuario,
    tienePassword: password,
  };
}

export const GET: APIRoute = async ({ url }) => {
  if (url.searchParams.get('token') !== TOKEN) {
    return new Response('No autorizado', { status: 404 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  const secrets: string[] = [];
  for (const candidate of [databaseUrl, directUrl]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.password) secrets.push(decodeURIComponent(parsed.password), parsed.password);
    } catch {
      // URL invalida: no hay contrasena que extraer
    }
  }

  const resultado: Record<string, unknown> = {
    nodeEnv: process.env.NODE_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    DATABASE_URL: inspect(databaseUrl),
    DIRECT_URL: inspect(directUrl),
  };

  // Intento de conexion real: el mensaje de error es lo que revela la causa.
  try {
    const { db } = await import('../../db');
    const { services } = await import('../../db/schema');
    const inicio = Date.now();
    const rows = await db.select().from(services);
    resultado.conexion = { ok: true, ms: Date.now() - inicio, filas: rows.length };
  } catch (error) {
    const err = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    resultado.conexion = {
      ok: false,
      code: err.code ?? err.cause?.code ?? null,
      mensaje: redact(String(err.message ?? error), secrets).slice(0, 400),
      causa: err.cause ? redact(String(err.cause.message ?? ''), secrets).slice(0, 300) : null,
    };
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
