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

  return next();
});
