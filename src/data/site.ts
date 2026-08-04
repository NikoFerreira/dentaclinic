import type { IconName } from '../components/icons';

/**
 * Fuente única de contenido de la landing.
 * Editar aquí evita tocar el markup de las secciones.
 */

export const site = {
  name: 'DentaClinic',
  tagline: 'Consultorio odontológico',
  description:
    'Consultorio odontológico con tecnología digital y un equipo con más de 10 años de experiencia. Odontología general, estética dental y ortodoncia en Asunción.',
  phoneLabel: '+595 21 555 0180',
  phoneHref: 'tel:+595215550180',
  whatsappLabel: '+595 981 555 018',
  whatsappHref: 'https://wa.me/595981555018',
  email: 'hola@dentaclinic.com.py',
  address: 'Av. Mariscal López 1234, Asunción',
  addressHref: 'https://maps.google.com/?q=Av.+Mariscal+Lopez+1234+Asuncion',
} as const;

export const navLinks = [
  { label: 'Servicios', href: '#servicios' },
  { label: 'Nosotros', href: '#nosotros' },
  { label: 'Preguntas', href: '#faq' },
  { label: 'Contacto', href: '#contacto' },
] as const;

export const services: ReadonlyArray<{
  icon: IconName;
  title: string;
  description: string;
  items: readonly string[];
}> = [
  {
    icon: 'tooth',
    title: 'Odontología General',
    description:
      'Prevención, limpiezas y restauraciones para mantener tu boca sana durante todo el año.',
    items: ['Profilaxis y flúor', 'Empastes estéticos', 'Endodoncia'],
  },
  {
    icon: 'sparkles',
    title: 'Estética Dental',
    description:
      'Tratamientos precisos para mejorar el color, la forma y la armonía de tu sonrisa.',
    items: ['Blanqueamiento', 'Carillas de porcelana', 'Diseño de sonrisa'],
  },
  {
    icon: 'braces',
    title: 'Ortodoncia',
    description:
      'Alineación progresiva con planificación digital y controles claros en cada etapa.',
    items: ['Brackets estéticos', 'Alineadores invisibles', 'Ortodoncia infantil'],
  },
];

export const stats = [
  { value: '+10', unit: 'años', label: 'de experiencia clínica' },
  { value: '+5.000', unit: '', label: 'pacientes atendidos' },
  { value: '100%', unit: '', label: 'diagnóstico digital' },
  { value: '4.9', unit: '/5', label: 'valoración de pacientes' },
] as const;

export const trustPoints: ReadonlyArray<{
  icon: IconName;
  title: string;
  description: string;
}> = [
  {
    icon: 'cpu',
    title: 'Tecnología digital',
    description:
      'Radiografía digital de baja radiación, escáner intraoral 3D y planificación asistida por software.',
  },
  {
    icon: 'users',
    title: 'Equipo especializado',
    description:
      'Odontólogos con formación de posgrado en estética, endodoncia y ortodoncia, en capacitación continua.',
  },
  {
    icon: 'shield',
    title: 'Protocolos de bioseguridad',
    description:
      'Esterilización trazable por ciclo, material de un solo uso y consultorios con aire filtrado.',
  },
];

export const faqs = [
  {
    question: '¿Cuál es el horario de atención?',
    answer:
      'Atendemos de lunes a viernes de 08:00 a 20:00 y los sábados de 08:00 a 13:00. Las urgencias se coordinan por WhatsApp fuera de ese horario.',
  },
  {
    question: '¿Qué incluye la primera cita?',
    answer:
      'Una evaluación completa de unos 40 minutos: revisión clínica, radiografía digital si es necesaria y un plan de tratamiento por escrito con tiempos y costos antes de iniciar cualquier procedimiento.',
  },
  {
    question: '¿Trabajan con seguros médicos?',
    answer:
      'Sí. Trabajamos con los principales seguros y prepagas del país. Al agendar podés indicarnos tu cobertura y confirmamos el porcentaje aplicable antes de la consulta.',
  },
  {
    question: '¿El tratamiento duele?',
    answer:
      'Usamos anestesia tópica previa a la infiltración y técnicas mínimamente invasivas, por lo que la mayoría de los tratamientos son indoloros. Si tenés ansiedad dental, avisanos y adaptamos el ritmo de la sesión.',
  },
  {
    question: '¿Ofrecen planes de pago?',
    answer:
      'Sí. Aceptamos tarjetas de crédito y débito, transferencias y financiación en cuotas sin interés para tratamientos de ortodoncia y rehabilitación.',
  },
  {
    question: '¿Atienden niños?',
    answer:
      'Sí, desde los 3 años. La primera visita es de adaptación, sin instrumental, para que el niño conozca el consultorio con tranquilidad.',
  },
] as const;

export const specialties = [
  'Odontología general',
  'Estética dental',
  'Ortodoncia',
  'Endodoncia',
  'Odontopediatría',
  'Urgencia dental',
] as const;

export const schedule = [
  { days: 'Lunes a viernes', hours: '08:00 - 20:00' },
  { days: 'Sábados', hours: '08:00 - 13:00' },
  { days: 'Domingos y feriados', hours: 'Cerrado' },
] as const;

export const socials: ReadonlyArray<{
  label: string;
  href: string;
  icon: 'instagram' | 'facebook' | 'whatsapp';
}> = [
  { label: 'Instagram de DentaClinic', href: 'https://instagram.com/dentaclinic', icon: 'instagram' },
  { label: 'Facebook de DentaClinic', href: 'https://facebook.com/dentaclinic', icon: 'facebook' },
  { label: 'WhatsApp de DentaClinic', href: site.whatsappHref, icon: 'whatsapp' },
];
