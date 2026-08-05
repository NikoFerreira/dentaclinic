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

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: string }).code === UNIQUE_VIOLATION
    : false;
}
