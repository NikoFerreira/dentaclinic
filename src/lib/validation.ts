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

/**
 * Campos extra cuando administracion carga un turno en nombre de un paciente.
 * `patientId` se valida despues contra la lista real de pacientes: que sea un
 * UUID no significa que exista ni que sea un cliente.
 */
export const adminBookingSchema = bookingSchema.extend({
  patientId: z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Elegí un paciente de la lista.',
    ),
  /** `si` deja el turno confirmado de una; `no` lo deja como solicitud. */
  confirmar: z.enum(['si', 'no']).default('no'),
});

export const appointmentActionSchema = z.object({
  accion: z.enum(['confirmar', 'rechazar', 'cancelar', 'completar']),
  volverA: z.string().optional(),
});

/** Hora de pared en formato HH:MM, como la envia un <input type="time">. */
const wallTime = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}$/, 'Usá el formato HH:MM, por ejemplo 08:00.');

export const availabilityRuleSchema = z
  .object({
    weekday: z.coerce.number().int().min(0, 'Día inválido.').max(6, 'Día inválido.'),
    start: wallTime,
    end: wallTime,
    slotMinutes: z.coerce
      .number()
      .int()
      .min(10, 'Los turnos deben durar al menos 10 minutos.')
      .max(480, 'Los turnos no pueden durar más de 8 horas.'),
  })
  .refine((value) => value.start < value.end, {
    message: 'La hora de fin debe ser posterior a la de inicio.',
    path: ['end'],
  });

/** Fecha de almanaque YYYY-MM-DD, como la envia un <input type="date">. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí una fecha válida.');

export const blackoutSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    reason: z
      .string()
      .trim()
      .max(120, 'El motivo no puede superar los 120 caracteres.')
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .refine((value) => value.from <= value.to, {
    message: 'La fecha de fin no puede ser anterior a la de inicio.',
    path: ['to'],
  });

export const deleteByIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Primer mensaje de error de un `safeParse`, listo para mostrar. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
}
