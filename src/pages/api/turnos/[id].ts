import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { appointments, type AppointmentStatus } from '../../../db/schema';
import { safeRedirect } from '../../../lib/http';
import { appointmentActionSchema } from '../../../lib/validation';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Acciones reservadas a administración. */
const ADMIN_ONLY = new Set(['confirmar', 'rechazar', 'completar']);

const NEXT_STATUS: Record<string, AppointmentStatus> = {
  confirmar: 'confirmed',
  rechazar: 'rejected',
  cancelar: 'cancelled',
  completar: 'completed',
};

/** Estados desde los que cada acción es válida. */
const ALLOWED_FROM: Record<string, ReadonlySet<AppointmentStatus>> = {
  confirmar: new Set<AppointmentStatus>(['pending']),
  rechazar: new Set<AppointmentStatus>(['pending']),
  completar: new Set<AppointmentStatus>(['confirmed']),
  cancelar: new Set<AppointmentStatus>(['pending', 'confirmed']),
};

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const { user } = locals;
  if (!user) return redirect('/ingresar', 303);

  const id = params.id ?? '';
  // Se valida el formato antes de consultar: un id no-UUID hace fallar la query.
  if (!UUID_PATTERN.test(id)) {
    return new Response('Identificador de turno inválido', { status: 400 });
  }

  const form = await request.formData();
  const parsed = appointmentActionSchema.safeParse({
    accion: form.get('accion'),
    volverA: form.get('volverA') ?? undefined,
  });

  if (!parsed.success) {
    return new Response('Acción inválida', { status: 400 });
  }

  const { accion } = parsed.data;
  const fallback = user.role === 'admin' ? '/admin' : '/mis-turnos';
  const back = safeRedirect(parsed.data.volverA, fallback);

  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const appointment = rows[0];

  if (!appointment) {
    return new Response('Turno no encontrado', { status: 404 });
  }

  /**
   * Autorización en el servidor. Ocultar botones en la interfaz no protege
   * nada: cualquiera puede enviar este POST a mano.
   */
  if (ADMIN_ONLY.has(accion)) {
    if (user.role !== 'admin') return new Response('No autorizado', { status: 403 });
  } else if (user.role !== 'admin' && appointment.userId !== user.id) {
    // Un paciente solo puede cancelar sus propios turnos.
    return new Response('No autorizado', { status: 403 });
  }

  if (!ALLOWED_FROM[accion].has(appointment.status)) {
    return redirect(`${back}${back.includes('?') ? '&' : '?'}estado=invalido`, 303);
  }

  // Un paciente no puede cancelar un turno que ya ocurrió; administración sí,
  // para poder corregir la agenda a posteriori.
  if (accion === 'cancelar' && user.role !== 'admin' && appointment.startsAt.getTime() <= Date.now()) {
    return redirect(`${back}${back.includes('?') ? '&' : '?'}estado=tarde`, 303);
  }

  await db
    .update(appointments)
    .set({ status: NEXT_STATUS[accion], updatedAt: new Date() })
    .where(eq(appointments.id, id));

  const flag =
    accion === 'cancelar' ? 'cancelado=1' : accion === 'confirmar' ? 'confirmado=1' : 'actualizado=1';

  return redirect(`${back}${back.includes('?') ? '&' : '?'}${flag}`, 303);
};
