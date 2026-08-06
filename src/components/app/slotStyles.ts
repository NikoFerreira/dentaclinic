import type { IconName } from '../icons';
import type { AppointmentStatus } from '../../db/schema';
import type { SlotState } from '../../lib/schedule';

/**
 * Cada estado se distingue por color, etiqueta de texto E icono.
 * El color solo nunca alcanza: WCAG 1.4.1 exige otro canal de informacion.
 */
export const SLOT_META: Record<
  SlotState,
  { label: string; icon: IconName; classes: string; legend: string }
> = {
  free: {
    label: 'Libre',
    icon: 'plus',
    classes:
      'border-ink-200 bg-white text-ink-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700',
    legend: 'Disponible para reservar',
  },
  pending: {
    label: 'Pendiente',
    icon: 'clock',
    // Lleva estilos de hover porque sigue siendo solicitable: un pendiente es
    // una solicitud, no una reserva, y varias pueden competir por el horario.
    classes: 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 hover:bg-amber-100',
    legend: 'Con solicitudes, todavía se puede pedir',
  },
  confirmed: {
    label: 'Reservado',
    icon: 'check',
    classes: 'border-brand-400 bg-brand-100 text-brand-700',
    legend: 'Turno confirmado',
  },
  blocked: {
    label: 'Cerrado',
    icon: 'ban',
    classes: 'border-ink-200 bg-ink-100 bg-stripes text-ink-500',
    legend: 'Cerrado por feriado o bloqueo',
  },
  past: {
    label: 'Pasado',
    icon: 'dash',
    classes: 'border-ink-200/60 bg-page text-ink-500',
    legend: 'Horario ya transcurrido',
  },
};

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pendiente de confirmación',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  completed: 'Atendido',
};

export const STATUS_BADGE: Record<AppointmentStatus, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-800',
  confirmed: 'border-brand-300 bg-brand-50 text-brand-700',
  rejected: 'border-red-300 bg-red-50 text-red-800',
  cancelled: 'border-ink-200 bg-ink-100 text-ink-500',
  completed: 'border-mint-300 bg-mint-50 text-mint-600',
};
