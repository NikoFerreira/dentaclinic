import { z } from 'zod';

/**
 * Toda entrada se valida en el servidor. Los atributos `required` del HTML son
 * una comodidad para el usuario, no una defensa: cualquiera puede enviar el
 * formulario sin ellos.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, 'El correo es demasiado largo.')
  .pipe(z.email({ message: 'Ingresá un correo electrónico válido.' }));

const phone = z
  .string()
  .trim()
  .min(7, 'Ingresá un teléfono válido.')
  .max(40, 'El teléfono es demasiado largo.')
  .regex(/^[0-9+()\s-]+$/, 'El teléfono solo puede tener números, espacios y + ( ) -');

export const loginSchema = z.object({
  email,
  // En el login no se aplica la política de longitud: solo se compara el hash.
  password: z.string().min(1, 'Ingresá tu contraseña.').max(200),
});

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Ingresá tu nombre completo.')
    .max(120, 'El nombre es demasiado largo.'),
  email,
  phone,
  password: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres.')
    .max(200, 'La contraseña es demasiado larga.'),
});

export const bookingSchema = z.object({
  startsAt: z.string().min(1),
  serviceId: z.coerce.number().int().positive(),
  notes: z
    .string()
    .trim()
    .max(500, 'El mensaje no puede superar los 500 caracteres.')
    .optional()
    .transform((value) => (value ? value : null)),
});

export const appointmentActionSchema = z.object({
  accion: z.enum(['confirmar', 'rechazar', 'cancelar', 'completar']),
  volverA: z.string().optional(),
});

/** Primer mensaje de error de un `safeParse`, listo para mostrar. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
}
