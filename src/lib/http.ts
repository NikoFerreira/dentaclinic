/**
 * Solo permite redirecciones internas.
 *
 * Sin esta comprobacion, `/ingresar?redirigir=https://sitio-falso.com` mandaria
 * al usuario a otro dominio despues de iniciar sesion (open redirect), una via
 * clasica de phishing.
 */
export function safeRedirect(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const target = value.trim();
  if (!target.startsWith('/')) return fallback;
  // `//host` y `/\host` los interpretan los navegadores como URL absolutas.
  if (target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

/** Codigo de PostgreSQL para violacion de restriccion unica. */
const UNIQUE_VIOLATION = '23505';

/**
 * Detecta una violacion de restriccion unica recorriendo la cadena de causas.
 *
 * Drizzle envuelve los errores del driver en `DrizzleQueryError`, que no expone
 * `code` en el nivel superior: el codigo de PostgreSQL queda en `error.cause`.
 * Mirar solo el primer nivel hacia que estas violaciones pasaran por
 * desapercibidas y terminaran en un error 500 en lugar de un mensaje util
 * ("ese correo ya existe", "ese horario acaba de ser reservado").
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
