import type { APIRoute } from 'astro';
import { SESSION_COOKIE, clearSessionCookie, invalidateSession } from '../lib/auth';

export const prerender = false;

/**
 * Cierre de sesion por POST, no por GET: un enlace GET podria ser disparado por
 * un precargador o una imagen incrustada en otro sitio (CSRF de cierre).
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    // Se borra de la base para que el token no sirva aunque alguien lo tenga.
    await invalidateSession(token);
  }

  clearSessionCookie(cookies);
  return redirect('/ingresar', 303);
};
