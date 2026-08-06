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

  // Soporte de zonas horarias: si el runtime no trae ICU completo,
  // Intl con America/Asuncion lanza RangeError y toda pagina que formatee
  // fechas devuelve 500.
  resultado.intl = (() => {
    const salida: Record<string, unknown> = {
      nodeVersion: process.version,
      zonaPorDefecto: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    try {
      const fmt = new Intl.DateTimeFormat('es-PY', {
        timeZone: 'America/Asuncion',
        dateStyle: 'full',
        timeStyle: 'short',
      });
      salida.asuncionOk = true;
      salida.ejemplo = fmt.format(new Date(Date.UTC(2026, 7, 6, 15, 0, 0)));
      salida.zonaResuelta = fmt.resolvedOptions().timeZone;
      salida.localeResuelto = fmt.resolvedOptions().locale;
    } catch (error) {
      salida.asuncionOk = false;
      salida.error = String((error as Error).message).slice(0, 200);
    }

    return salida;
  })();

  // Armado real de la grilla semanal: es lo que hace /agenda antes de renderizar.
  try {
    const { buildWeek, startOfWeek, todayInClinic } = await import('../../lib/schedule');
    const { loadWeekData } = await import('../../lib/agenda');
    const weekStart = startOfWeek(todayInClinic());
    const datos = await loadWeekData(weekStart);
    const dias = buildWeek({
      weekStart,
      rules: datos.rules,
      appointments: datos.appointments,
      blackouts: datos.blackouts,
      now: new Date(),
      viewer: { id: '00000000-0000-0000-0000-000000000000', role: 'admin' },
    });
    resultado.grilla = {
      ok: true,
      dias: dias.length,
      huecos: dias.reduce((total, dia) => total + dia.slots.length, 0),
    };
  } catch (error) {
    const err = error as { message?: string; stack?: string };
    resultado.grilla = {
      ok: false,
      mensaje: redact(String(err.message ?? error), secrets).slice(0, 300),
      pila: redact(String(err.stack ?? '').split('\n').slice(0, 4).join(' | '), secrets).slice(0, 400),
    };
  }

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
