# Agenda de turnos — rama `agenda`

Esta rama agrega un backend con base de datos, cuentas de usuario con roles y un
calendario de turnos. **La landing no se modificó**: `src/pages/index.astro` y
todos sus componentes son idénticos a `main`, y siguen generándose como HTML
estático.

| | `main` | `agenda` |
| --- | --- | --- |
| Enfoque | Landing pública | Landing + aplicación de turnos |
| Renderizado | 100 % estático | Híbrido: landing estática, app en servidor |
| Base de datos | ninguna | Postgres (Supabase) |
| Adaptador | ninguno | `@astrojs/vercel` |

---

## Puesta en marcha

### 1. Crear la base en Supabase

En [supabase.com](https://supabase.com) → **New project**. Anotá la contraseña de
la base: se muestra una sola vez.

Después, con el botón **Connect**, copiá dos cadenas en formato URI:

- **Transaction pooler** (puerto `6543`) → va en `DATABASE_URL`
- **Session pooler** (puerto `5432`) → va en `DIRECT_URL`

Hacen falta las dos: el pooler en modo *transaction* es el adecuado para
funciones serverless, pero no mantiene la sesión y por eso no admite las
sentencias DDL de las migraciones.

> Usá el **Session pooler**, no la **Direct connection**. En el plan gratuito la
> conexión directa es solo IPv6, y si tu red no tiene IPv6 falla con un timeout
> que no explica la causa. El session pooler es compatible con IPv4 y se comporta
> igual para migraciones.

### 2. Configurar el entorno local

```bash
cp .env.example .env
```

Completá `.env` con las dos cadenas y elegí una contraseña para el usuario
administrador (mínimo 10 caracteres).

> `.env` está en `.gitignore` y nunca debe subirse: **este repositorio es público**.

### 3. Crear las tablas y los datos iniciales

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

El seed carga las seis especialidades, los horarios de atención y el usuario
administrador definido en `.env`. Se puede volver a ejecutar sin duplicar datos
(si el admin ya existe, le actualiza la contraseña, útil si perdiste el acceso).

### 4. Cerrar el acceso público a las tablas

```bash
npm run db:harden
```

**Este paso no es opcional en Supabase.** Supabase expone automáticamente el
esquema `public` como API REST y otorga permisos al rol `anon`, cuya clave viaja
en el navegador. Las tablas creadas por migración **no** tienen activado el
aislamiento por filas, así que sin esto una petición como

```
GET https://<proyecto>.supabase.co/rest/v1/users?select=*
```

devolvería nombres, teléfonos, correos y motivos de consulta de los pacientes.

El script activa `row level security` en todas las tablas del esquema (sin
definir políticas, lo que equivale a denegar todo) y revoca los permisos de
`anon` y `authenticated`. La aplicación no se ve afectada: se conecta como
`postgres`, dueño de las tablas, y el dueño no queda sujeto a RLS.

Toma los nombres del esquema, así que una tabla nueva queda cubierta sin editar
el script. Es idempotente y verifica el estado real al terminar.

### 5. Levantar el proyecto

```bash
npm run dev
```

- `/` → landing pública
- `/registro` → crear cuenta de paciente
- `/ingresar` → acceso
- `/agenda` → calendario semanal
- `/mis-turnos` → turnos del paciente
- `/admin` → panel de administración

### 6. Desplegar en Vercel

En **Project Settings → Environment Variables** cargá `DATABASE_URL` y
`DIRECT_URL`. Sin eso el build funciona (la landing es estática) pero las rutas
de la aplicación devuelven error 500.

---

## Cómo funciona

### Flujo de reserva

```
Paciente elige un hueco libre  →  PENDIENTE   (ámbar)
Administración confirma        →  CONFIRMADO  (turquesa)
Administración rechaza         →  el horario vuelve a quedar libre
Paciente cancela               →  el horario vuelve a quedar libre
```

### Estados del calendario

Cada estado se distingue por **color, etiqueta de texto e icono**. El color solo
no alcanza: quien no percibe diferencias cromáticas necesita otro canal
(WCAG 1.4.1). Los horarios cerrados llevan además un rayado diagonal.

| Estado | Color | Significado |
| --- | --- | --- |
| Libre | blanco | Disponible; es un enlace para reservar |
| Pendiente | ámbar | Solicitado, esperando confirmación |
| Reservado | turquesa | Turno confirmado |
| Cerrado | gris rayado | Feriado o bloqueo |
| Pasado | gris claro | Horario ya transcurrido |

### Roles

- **`client`** — reserva turnos, ve y cancela **solo los propios**. En el
  calendario ve que un horario está ocupado, pero **no de quién es**.
- **`admin`** — ve la agenda completa con datos de contacto, confirma, rechaza,
  cancela y marca turnos como atendidos.

El rol nunca se lee del formulario de registro: todo el que se registra es
`client`. Los administradores se crean con el seed o cambiando el campo `role`
directamente en la base.

### Horarios

Se configuran en la tabla `availability_rules`, en minutos desde medianoche y
hora local. El seed carga lunes a viernes 08:00–12:00 y 14:00–20:00, y sábados
08:00–13:00, con turnos de 60 minutos. Para cambiarlos, editá esa tabla (podés
usar `npm run db:studio`).

Los feriados y cierres van en `blackouts`, con un rango de fechas y un motivo.

---

## Decisiones de seguridad

**Contraseñas** — Argon2id con los parámetros recomendados por OWASP (19 MiB de
memoria, 2 iteraciones). La contraseña en claro nunca se guarda ni se registra.

**Sesiones** — token aleatorio de 32 bytes en una cookie `httpOnly`, `secure` y
`SameSite=Lax`. En la base se guarda **solo el SHA-256 del token**: si la base se
filtra, los hashes no sirven para suplantar a nadie. Renovación deslizante a los
30 días.

**Fuerza bruta** — 5 intentos fallidos bloquean la cuenta 15 minutos. Cuando el
correo no existe igualmente se calcula un hash, para que el tiempo de respuesta
no revele qué cuentas están registradas.

**CSRF** — `security.checkOrigin` valida la cabecera `Origin` en toda petición no
GET, sumado a las cookies `SameSite`. El cierre de sesión es POST, no GET, para
que no lo dispare un precargador o una imagen incrustada en otro sitio.

**Autorización** — se resuelve siempre en el servidor, en el middleware y de
nuevo en cada endpoint. Ocultar botones en la interfaz no protege nada: cualquiera
puede enviar el POST a mano.

**Reservas duplicadas** — la garantía vive en la base, no en el código: un índice
único parcial sobre `starts_at` (limitado a los estados que ocupan el horario)
impide que dos peticiones simultáneas reserven el mismo hueco. La comprobación
previa en el código solo existe para dar un mensaje más claro.

**Horarios manipulados** — `isValidSlotStart` verifica que el instante recibido
caiga exactamente en un hueco de la grilla, en el futuro, sin bloqueos y libre.
Sin eso, alterar el parámetro `inicio` permitiría reservar a cualquier hora.

**Redirecciones** — `safeRedirect` solo acepta rutas internas, para que
`?redirigir=https://sitio-falso.com` no pueda usarse para phishing.

**Zona horaria** — en la base todo son instantes UTC (`timestamptz`). La
conversión a hora de Asunción usa `Intl`, no un desplazamiento fijo de −3, así
que sigue siendo correcta si Paraguay vuelve a aplicar horario de verano.

---

## Verificación

```bash
npm run check
```

```bash
npm run check:schedule
```

```bash
npm run check:agenda
```

`check:schedule` ejecuta 37 comprobaciones sobre la lógica de horarios sin
necesitar base de datos: conversión de zona horaria, ida y vuelta de instantes,
cruces de mes y año bisiesto, armado de la grilla, liberación de horarios
cancelados, ocultamiento del nombre en turnos ajenos y rechazo de horas fuera de
grilla.

`check:agenda` ejecuta 33 comprobaciones **contra Postgres real** usando PGlite
(Postgres compilado a WebAssembly, en memoria, dentro del propio proceso). No
necesita instalar Postgres ni conectarse a Supabase: aplica la misma migración
que producción y verifica la estructura, el hasheo Argon2id, la reserva, la
garantía anti-duplicados con dos peticiones simultáneas, la liberación de
horarios al cancelar y el ocultamiento de nombres ajenos.

Importa las funciones de producción, no copias: si una se rompe, estas
comprobaciones fallan. Así se detectó que `isUniqueViolation` no reconocía las
violaciones de unicidad envueltas por Drizzle, lo que convertía dos mensajes de
error en un 500.

---

## Pendiente

- **Notificaciones.** Al confirmar o rechazar no se avisa al paciente; hay que
  llamarlo. Requiere un proveedor de email (Resend) o la API de WhatsApp Business.
- **Recuperación de contraseña.** No hay «olvidé mi contraseña»; depende también
  de un proveedor de email. Mientras tanto, el admin se recupera reejecutando el
  seed.
- **Un solo sillón.** El modelo asume un turno por horario. Para atender en
  paralelo hay que agregar una tabla de profesionales y ampliar el índice único.
- **Panel de horarios.** Los horarios y feriados se editan en la base, todavía no
  desde la interfaz.
- **Formulario de la landing.** La tabla `contact_requests` existe pero el
  formulario público sigue sin conectarse, para no modificar la landing.
- **Datos personales.** La aplicación guarda nombre, teléfono, correo y motivo de
  consulta. Es información sensible: el consultorio necesita una política de
  privacidad y consentimiento explícito.
