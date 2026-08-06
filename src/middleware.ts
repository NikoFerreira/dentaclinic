import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, validateSession } from './lib/auth';

/** Exigen sesion iniciada, cualquier rol. */
const AUTHENTICATED_PREFIXES = ['/agenda', '/mis-turnos'];

/** Exclusivas de administracion. */
const ADMIN_PREFIXES = ['/admin'];

function matches(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Las rutas prerenderizadas (la landing) se generan en build: no hay cookies
  // ni base de datos disponibles, y tampoco hacen falta.
  if (context.isPrerendered) {
    context.locals.user = null;
    return next();
  }

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  context.locals.user = token ? await validateSession(token) : null;

  const path = context.url.pathname;
  const isAdminRoute = matches(path, ADMIN_PREFIXES);

  if ((isAdminRoute || matches(path, AUTHENTICATED_PREFIXES)) && !context.locals.user) {
    const target = `${path}${context.url.search}`;
    return context.redirect(`/ingresar?redirigir=${encodeURIComponent(target)}`);
  }

  // La autorizacion se resuelve en el servidor. Ocultar botones en la interfaz
  // no es una defensa: un cliente podria pedir /admin directamente.
  if (isAdminRoute && context.locals.user?.role !== 'admin') {
    return context.redirect('/agenda');
  }

  // ------------------------------------------------------------------
  // CAPTURA TEMPORAL DE ERRORES. Eliminar junto con /api/diagnostico.
  // Con ?depurar=<token> devuelve la excepcion en texto plano, porque los
  // logs de Vercel no son accesibles desde el entorno de desarrollo.
  // ------------------------------------------------------------------
  if (context.url.searchParams.get('depurar') === '1b5c4c800088e501a4904f0d414eb208') {
    try {
      const response = await next();
      return new Response(
        `OK status=${response.status}\ncontent-type=${response.headers.get('content-type')}`,
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    } catch (error) {
      const err = error as Error;
      let texto = `ERROR: ${err.name}: ${err.message}\n\n${err.stack ?? ''}`;
      if (err.cause) texto += `\n\nCAUSA: ${String((err.cause as Error).message ?? err.cause)}`;

      // Se oculta la contrasena por si apareciera en la traza.
      for (const url of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
        if (!url) continue;
        try {
          const password = new URL(url).password;
          if (password.length > 3) texto = texto.split(password).join('«oculto»');
        } catch {
          // URL invalida
        }
      }

      return new Response(texto.slice(0, 3000), {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  }

  return next();
});
