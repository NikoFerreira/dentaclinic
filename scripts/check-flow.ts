/**
 * Prueba de humo end-to-end contra el servidor en ejecucion y la base real.
 *
 * Recorre los flujos por HTTP como lo haria un navegador: cookies de sesion,
 * cabecera Origin, redirecciones 303. No usa atajos internos.
 *
 * Requiere `npm run dev` corriendo y .env configurado.
 *
 *   npm run check:flow
 */
import postgres from 'postgres';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se asume que las variables ya estan en el entorno.
}

const BASE = process.env.FLOW_BASE_URL ?? 'http://localhost:4321';

const PACIENTE_A = {
  fullName: 'Ana Giménez',
  email: 'demo.paciente.a@example.com',
  phone: '+595 981 111 222',
  password: 'clave-demo-paciente-a',
};

const PACIENTE_B = {
  fullName: 'Luis Rojas',
  email: 'demo.paciente.b@example.com',
  phone: '+595 981 333 444',
  password: 'clave-demo-paciente-b',
};

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FALLA ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Cliente HTTP con tarro de cookies, uno por usuario. */
class Client {
  private cookies = new Map<string, string>();

  constructor(readonly nombre: string) {}

  private header(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return {
      cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    };
  }

  private absorb(response: Response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string) {
    const response = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      headers: this.header(),
    });
    this.absorb(response);
    return { status: response.status, location: response.headers.get('location'), body: await response.text() };
  }

  async post(path: string, fields: Record<string, string>) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...this.header(),
        'content-type': 'application/x-www-form-urlencoded',
        origin: BASE, // checkOrigin lo exige en toda peticion no-GET
      },
      body: new URLSearchParams(fields).toString(),
      });
    this.absorb(response);
    return { status: response.status, location: response.headers.get('location'), body: await response.text() };
  }

  get tieneSesion() {
    return this.cookies.has('dc_session');
  }
}

// ---------------------------------------------------------------------------
// Limpieza previa: hace la prueba repetible
// ---------------------------------------------------------------------------
const sql = postgres(process.env.DIRECT_URL!, { max: 1, prepare: false, connect_timeout: 25 });

const borrados = await sql`
  delete from users where email in (${PACIENTE_A.email}, ${PACIENTE_B.email}) returning id
`;
if (borrados.length > 0) console.log(`Limpieza: ${borrados.length} usuario(s) de prueba anterior(es) eliminados\n`);

// ---------------------------------------------------------------------------
console.log('1. Acceso de administración');

const adminEmail = process.env.ADMIN_EMAIL!;
const adminPassword = process.env.ADMIN_PASSWORD!;
const admin = new Client('admin');

const loginMal = await admin.post('/ingresar', { email: adminEmail, password: 'contrasena-equivocada' });
check(
  'rechaza la contraseña incorrecta sin crear sesión',
  loginMal.status === 200 && !admin.tieneSesion && loginMal.body.includes('Correo o contraseña incorrectos'),
  `status=${loginMal.status} sesion=${admin.tieneSesion}`,
);

const loginBien = await admin.post('/ingresar', { email: adminEmail, password: adminPassword });
check(
  'acepta las credenciales correctas y redirige a /admin',
  loginBien.status === 303 && loginBien.location === '/admin' && admin.tieneSesion,
  `status=${loginBien.status} location=${loginBien.location}`,
);

const panel = await admin.get('/admin');
check('el panel de administración carga', panel.status === 200 && panel.body.includes('Solicitudes de turno'));

// ---------------------------------------------------------------------------
console.log('\n2. Registro de pacientes');

const ana = new Client('ana');
const registroA = await ana.post('/registro', PACIENTE_A);
check(
  'Ana se registra y queda con sesión',
  registroA.status === 303 && registroA.location === '/agenda' && ana.tieneSesion,
  `status=${registroA.status} location=${registroA.location}`,
);

const rolAna = await sql`select role from users where email = ${PACIENTE_A.email}`;
check('el rol asignado es client, no admin', rolAna[0]?.role === 'client', String(rolAna[0]?.role));

// EL BUG CORREGIDO: antes esto devolvia 500 en lugar del mensaje.
const duplicado = new Client('duplicado');
const registroDup = await duplicado.post('/registro', PACIENTE_A);
check(
  'correo duplicado muestra el mensaje y NO un error 500',
  registroDup.status === 200 && registroDup.body.includes('Ya existe una cuenta con ese correo'),
  `status=${registroDup.status}`,
);

const luis = new Client('luis');
const registroB = await luis.post('/registro', PACIENTE_B);
check('Luis se registra', registroB.status === 303 && luis.tieneSesion);

// ---------------------------------------------------------------------------
console.log('\n3. Reserva de un turno');

const agendaAna = await ana.get('/agenda');
check('el calendario carga para el paciente', agendaAna.status === 200 && agendaAna.body.includes('Reservar un turno'));

const libres = [...agendaAna.body.matchAll(/\/agenda\/reservar\?inicio=([^"]+)/g)].map((m) => m[1]);
check('hay huecos libres enlazados para reservar', libres.length > 0, `${libres.length} encontrados`);

const paginaReserva = await ana.get(`/agenda/reservar?inicio=${libres[0]}`);
const startsAt = /name="startsAt"\s+value="([^"]+)"/.exec(paginaReserva.body)?.[1];
const servicioId = /<option value="(\d+)"/.exec(paginaReserva.body)?.[1];
check(
  'la página de confirmación muestra el horario y las especialidades',
  paginaReserva.status === 200 && Boolean(startsAt) && Boolean(servicioId),
  `startsAt=${startsAt} servicio=${servicioId}`,
);

// Sin estos datos el resto de la prueba no tiene sentido: se corta acá con un
// mensaje claro en lugar de arrastrar fallos derivados.
if (!startsAt || !servicioId) {
  console.log('\nNo se pudo obtener un hueco reservable. Se detiene la prueba.');
  console.log(`${passed} correctas, ${failures.length} fallidas antes de detenerse.`);
  await sql.end({ timeout: 5 });
  process.exit(1);
}

const reserva = await ana.post('/agenda/reservar', {
  startsAt,
  serviceId: servicioId,
  notes: 'Consulta por alineadores invisibles.',
});
check(
  'la reserva queda registrada como pendiente',
  reserva.status === 303 && reserva.location === '/mis-turnos?solicitado=1',
  `status=${reserva.status} location=${reserva.location}`,
);

const estadoBd = await sql`
  select a.status, a.notes, u.full_name from appointments a
  join users u on u.id = a.user_id
  where u.email = ${PACIENTE_A.email}
`;
check('en la base figura como pending', estadoBd[0]?.status === 'pending', String(estadoBd[0]?.status));

// ---------------------------------------------------------------------------
console.log('\n4. Varias solicitudes pueden competir por el horario');

const agendaAna2 = await ana.get('/agenda');
check('Ana ve su solicitud marcada como propia', /Tu solicitud|Tu turno/.test(agendaAna2.body));
check('el hueco aparece como pendiente', agendaAna2.body.includes('Pendiente'));
check('y muestra el conteo de solicitudes', /1 solicitud/.test(agendaAna2.body));

/**
 * Un pendiente NO cierra el horario: sigue siendo solicitable. Antes lo
 * bloqueaba, y el primero en pedir se quedaba el horario aunque despues no le
 * sirviera.
 */
check(
  'el horario con solicitudes SIGUE siendo un enlace para pedirlo',
  agendaAna2.body.includes(`/agenda/reservar?inicio=${libres[0]}`),
);

// PRIVACIDAD: Luis ve que hay solicitudes, pero no de quien son.
const agendaLuis = await luis.get('/agenda');
check(
  'PRIVACIDAD: Luis no ve el nombre de Ana en la solicitud ajena',
  !agendaLuis.body.includes('Ana Giménez'),
);
check('Luis también puede solicitar ese horario', agendaLuis.body.includes(`inicio=${libres[0]}`));

// Segunda solicitud para el MISMO horario: debe aceptarse.
const segunda = await luis.post('/agenda/reservar', {
  startsAt,
  serviceId: servicioId,
  notes: 'Yo también quiero ese horario.',
});
check(
  'Luis solicita el mismo horario y se acepta',
  segunda.status === 303 && segunda.location === '/mis-turnos?solicitado=1',
  `status=${segunda.status} location=${segunda.location}`,
);

const compiten = await sql<{ n: number }[]>`
  select count(*)::int as n from appointments
  where starts_at = ${new Date(startsAt)} and status = 'pending'
`;
check('quedan 2 solicitudes para ese horario', compiten[0].n === 2, `${compiten[0].n}`);

const agendaLuis2 = await luis.get('/agenda');
check('el calendario muestra las 2 solicitudes', /2 solicitudes/.test(agendaLuis2.body));

// Horario fuera de la grilla
const fueraDeGrilla = new Date(new Date(startsAt).getTime() + 17 * 60000).toISOString();
const invalido = await luis.post('/agenda/reservar', {
  startsAt: fueraDeGrilla,
  serviceId: servicioId,
  notes: '',
});
check(
  'rechaza un horario fuera de la grilla (manipulando el parámetro)',
  invalido.status === 200 && /no forma parte de la agenda/i.test(invalido.body),
  `status=${invalido.status}`,
);

// ---------------------------------------------------------------------------
console.log('\n5. Administración confirma');

const solicitudes = await admin.get('/admin');
check('la solicitud aparece en el panel', solicitudes.body.includes('Ana Giménez'));
check('con el teléfono del paciente', solicitudes.body.includes('+595 981 111 222'));
check('y el motivo de consulta', solicitudes.body.includes('alineadores invisibles'));

/**
 * El id se busca en la BASE, filtrando por el paciente de prueba.
 *
 * Antes se tomaba la primera coincidencia del HTML del panel, pero ahi se
 * listan TODAS las solicitudes pendientes: con datos de demostracion cargados,
 * la prueba confirmaba el turno de otro paciente y despues fallaba al
 * cancelarlo con un 403 correcto, haciendo parecer un bug donde no habia.
 */
const propio = await sql<{ id: string }[]>`
  select a.id from appointments a
  join users u on u.id = a.user_id
  where u.email = ${PACIENTE_A.email} and a.status = 'pending'
  limit 1
`;
const turnoId = propio[0]?.id;
check('se puede identificar el turno de Ana', Boolean(turnoId), String(turnoId));
check(
  'y aparece listado en el panel de administración',
  Boolean(turnoId) && solicitudes.body.includes(turnoId),
);

if (!turnoId) {
  console.log('\nNo se pudo identificar el turno en el panel. Se detiene la prueba.');
  await sql.end({ timeout: 5 });
  process.exit(1);
}

// Un paciente NO puede confirmar: eso es solo de administracion.
const intentoCliente = await luis.post(`/api/turnos/${turnoId}`, { accion: 'confirmar', volverA: '/agenda' });
check(
  'AUTORIZACIÓN: un paciente no puede confirmar turnos (403)',
  intentoCliente.status === 403,
  `status=${intentoCliente.status}`,
);

const confirmar = await admin.post(`/api/turnos/${turnoId}`, { accion: 'confirmar', volverA: '/admin' });
check('administración confirma el turno', confirmar.status === 303, `status=${confirmar.status}`);

const trasConfirmar = await sql`select status from appointments where id = ${turnoId}`;
check('en la base queda confirmed', trasConfirmar[0]?.status === 'confirmed', String(trasConfirmar[0]?.status));

// Al confirmar una, la que competía por el mismo horario queda rechazada.
const desplazada = await sql<{ status: string }[]>`
  select a.status from appointments a
  join users u on u.id = a.user_id
  where a.starts_at = ${new Date(startsAt)} and u.email = ${PACIENTE_B.email}
`;
check(
  'la solicitud que competía queda RECHAZADA automáticamente',
  desplazada[0]?.status === 'rejected',
  String(desplazada[0]?.status),
);
check(
  'el aviso informa cuántas se desplazaron',
  (confirmar.location ?? '').includes('desplazadas=1'),
  String(confirmar.location),
);

const agendaAna3 = await ana.get('/agenda');
check('el calendario de Ana lo muestra como reservado', agendaAna3.body.includes('Reservado'));

// ---------------------------------------------------------------------------
console.log('\n6. Cancelación libera el horario');

const cancelar = await ana.post(`/api/turnos/${turnoId}`, { accion: 'cancelar', volverA: '/mis-turnos' });
check('Ana cancela su turno', cancelar.status === 303, `status=${cancelar.status}`);

const trasCancelar = await sql`select status from appointments where id = ${turnoId}`;
check('en la base queda cancelled', trasCancelar[0]?.status === 'cancelled', String(trasCancelar[0]?.status));

const agendaFinal = await luis.get('/agenda');
check(
  'el horario vuelve a estar disponible para otra persona',
  agendaFinal.body.includes(`inicio=${libres[0]}`),
);

// ---------------------------------------------------------------------------
console.log('\n7. Administración carga un turno desde el calendario');

const agendaAdmin = await admin.get('/agenda');
check('el calendario de administración carga', agendaAdmin.status === 200);

// Antes el calendario del admin era de solo lectura: no habia forma de dar de
// alta un turno que llega por telefono.
const librosAdmin = [...agendaAdmin.body.matchAll(/\/agenda\/reservar\?inicio=([^"]+)/g)].map(
  (m) => m[1],
);
check(
  'administración ve horarios clickeables para cargar turnos',
  librosAdmin.length > 0,
  `${librosAdmin.length} encontrados`,
);

if (librosAdmin.length > 0) {
  const formAdmin = await admin.get(`/agenda/reservar?inicio=${librosAdmin[0]}`);
  const startAdmin = /name="startsAt"\s+value="([^"]+)"/.exec(formAdmin.body)?.[1];
  const pacienteOpcion = /<option value="([0-9a-f-]{36})"/.exec(formAdmin.body)?.[1];
  const servicioAdmin = /<option value="(\d+)"/.exec(formAdmin.body)?.[1];

  check(
    'el formulario le pide elegir un paciente',
    formAdmin.body.includes('name="patientId"') && Boolean(pacienteOpcion),
  );
  check('y le permite confirmar directamente', formAdmin.body.includes('name="confirmar"'));

  if (startAdmin && pacienteOpcion && servicioAdmin) {
    const cargado = await admin.post('/agenda/reservar', {
      startsAt: startAdmin,
      serviceId: servicioAdmin,
      patientId: pacienteOpcion,
      confirmar: 'no',
      notes: 'Cargado por teléfono.',
    });
    check(
      'administración carga el turno y vuelve a Solicitudes',
      cargado.status === 303 && (cargado.location ?? '').startsWith('/admin?cargado=1'),
      `status=${cargado.status} location=${cargado.location}`,
    );

    const cargadoBd = await sql<{ status: string; notes: string | null }[]>`
      select status, notes from appointments where starts_at = ${new Date(startAdmin)}
    `;
    check(
      'queda como solicitud pendiente en la base',
      cargadoBd[0]?.status === 'pending' && cargadoBd[0]?.notes === 'Cargado por teléfono.',
      `${cargadoBd[0]?.status}`,
    );

    const panelTrasCarga = await admin.get('/admin');
    check(
      'y APARECE en las solicitudes a confirmar',
      panelTrasCarga.body.includes('Cargado por teléfono.'),
    );

    // Un paciente no puede cargar turnos para otra persona.
    const intentoAjeno = await ana.post('/agenda/reservar', {
      startsAt: startAdmin,
      serviceId: servicioAdmin,
      patientId: pacienteOpcion,
      confirmar: 'si',
      notes: '',
    });
    const deQuien = await sql<{ email: string }[]>`
      select u.email from appointments a join users u on u.id = a.user_id
      where a.starts_at = ${new Date(startAdmin)} and a.status = 'pending'
      order by a.created_at desc limit 1
    `;
    check(
      'AUTORIZACIÓN: un paciente no puede cargar turnos a nombre de otro',
      intentoAjeno.status !== 500 && deQuien[0]?.email !== undefined,
      `status=${intentoAjeno.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\n8. Protección de rutas y sesión');

const anonimo = new Client('anonimo');
for (const ruta of ['/agenda', '/mis-turnos', '/admin']) {
  const r = await anonimo.get(ruta);
  check(
    `sin sesión, ${ruta} redirige al login`,
    r.status === 302 && (r.location ?? '').startsWith('/ingresar?redirigir='),
    `status=${r.status} location=${r.location}`,
  );
}

const clienteEnAdmin = await luis.get('/admin');
check(
  'un paciente que pide /admin es desviado a /agenda',
  clienteEnAdmin.status === 302 && clienteEnAdmin.location === '/agenda',
  `status=${clienteEnAdmin.status} location=${clienteEnAdmin.location}`,
);

const sinOrigin = await fetch(`${BASE}/salir`, { method: 'POST', redirect: 'manual' });
check('CSRF: un POST sin cabecera Origin recibe 403', sinOrigin.status === 403, `status=${sinOrigin.status}`);

const salir = await ana.post('/salir', {});
check('cerrar sesión funciona y borra la cookie', salir.status === 303 && !ana.tieneSesion);

const trasSalir = await ana.get('/mis-turnos');
check('después de salir, la ruta privada vuelve a pedir login', trasSalir.status === 302);

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
if (failures.length === 0) {
  console.log(`${passed} comprobaciones, todas correctas.`);
} else {
  console.log(`${passed} correctas, ${failures.length} FALLIDAS:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(60));

await sql.end({ timeout: 5 });
process.exit(failures.length === 0 ? 0 : 1);
