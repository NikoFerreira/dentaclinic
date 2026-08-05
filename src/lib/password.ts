import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Hasheo de contrasenas, aislado del resto de la capa de autenticacion para que
 * pueda usarse tambien desde scripts de Node (el seed), sin arrastrar codigo que
 * dependa de Astro o de `import.meta.env`.
 *
 * Parametros recomendados por OWASP para Argon2id: 19 MiB de memoria,
 * 2 iteraciones, paralelismo 1.
 */
const ARGON_OPTIONS = {
  /**
   * 2 = Argon2id en @node-rs/argon2. Se escribe el literal porque la libreria lo
   * declara como `const enum`, incompatible con `verbatimModuleSyntax`.
   * Es tambien el valor por defecto, pero se deja explicito: es una decision de
   * seguridad y no debe depender de que la libreria no cambie su default.
   */
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, password);
  } catch {
    // Hash con formato invalido o corrupto: se trata como credencial incorrecta.
    return false;
  }
}
