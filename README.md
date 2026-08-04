# DentaClinic — Landing page

Landing page minimalista para un consultorio odontológico. Construida con **Astro 5+** y
**Tailwind CSS v4**: HTML estático, cero JavaScript de framework y solo dos scripts propios
(menú móvil y validación del formulario).

## Comandos

```bash
npm install
```

```bash
npm run dev
```

| Comando           | Descripción                                            |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Servidor de desarrollo en `http://localhost:4321`      |
| `npm run build`   | Verifica tipos (`astro check`) y compila a `dist/`     |
| `npm run preview` | Sirve la build de producción localmente                |
| `npm run check`   | Solo diagnóstico de tipos y plantillas                 |

## Estructura

```
src/
├── data/site.ts            ← Todo el contenido editable (textos, horarios, contacto, FAQ)
├── styles/global.css       ← Tokens de diseño (@theme), base y utilidades
├── components/
│   ├── icons.ts            ← Set de iconos de línea + glifos de marca
│   ├── Icon.astro          ← Iconos de trazo (24×24, stroke 1.5)
│   ├── BrandIcon.astro     ← Iconos rellenos de redes sociales
│   ├── Logo.astro
│   ├── Navbar.astro        ← Sticky + menú móvil accesible
│   ├── Hero.astro
│   ├── Services.astro
│   ├── Trust.astro         ← Texto de confianza + indicadores numéricos
│   ├── Faq.astro           ← Acordeones con <details> nativo
│   ├── Contact.astro       ← Formulario de cita
│   └── Footer.astro
├── layouts/Layout.astro    ← <head>, SEO, Open Graph, JSON-LD (schema.org/Dentist)
└── pages/index.astro
```

## Editar el contenido

Casi todo el texto vive en [`src/data/site.ts`](src/data/site.ts): datos de contacto, enlaces
de navegación, servicios, indicadores, preguntas frecuentes, especialidades del formulario,
horarios y redes sociales. No hace falta tocar el markup para actualizar la información.

## Sistema de diseño

Los tokens se definen con `@theme` en [`src/styles/global.css`](src/styles/global.css) y
generan las utilidades de Tailwind (`bg-brand-600`, `text-ink-500`, etc.).

| Token       | Uso                                                      |
| ----------- | -------------------------------------------------------- |
| `brand-*`   | Azul clínico suave — acento principal, CTAs, iconos      |
| `mint-*`    | Verde menta — confirmaciones y detalles secundarios      |
| `ink-*`     | Texto y bordes (`ink-900` títulos, `ink-500` cuerpo)     |
| `page`      | Fondo gris muy claro (`#f7fafb`)                         |

Tipografía: **Inter Variable** auto-hospedada vía `@fontsource-variable/inter`, sin peticiones
a servidores externos.

## Accesibilidad

- HTML semántico: `header`, `nav`, `main`, `section[aria-labelledby]`, `footer`.
- Enlace «Saltar al contenido principal» y anillos de foco visibles en todos los interactivos.
- Menú móvil con `aria-expanded`, `aria-controls`, cierre con `Escape` y etiqueta que cambia.
- FAQ con `<details>/<summary>` nativos: operables por teclado sin JavaScript.
- Formulario con `<label>` asociado a cada campo, `aria-invalid`, mensajes en `role="alert"`
  y foco gestionado al enviar.
- Contraste verificado: todas las combinaciones de texto superan 5:1 (AA pide 4.5:1).
- Objetivos táctiles de al menos 24×24 px (WCAG 2.5.8).
- Se respeta `prefers-reduced-motion`.

## Despliegue en Vercel

El proyecto ya está configurado en [`vercel.json`](vercel.json): framework `astro`, salida en
`dist/`, `cleanUrls`, caché inmutable de un año para los assets con hash de `/_astro/` y
cabeceras de seguridad básicas. **No hace falta el adaptador `@astrojs/vercel`**: el sitio es
100 % estático y Vercel sirve el HTML directamente, sin funciones serverless.

### Opción A — CLI (despliegue directo desde esta carpeta)

Los dos primeros comandos son interactivos (abren el navegador para autenticarte), así que hay
que ejecutarlos en una terminal propia:

```bash
npx vercel@latest login
```

```bash
npx vercel@latest link
```

```bash
npx vercel@latest --prod
```

`link` crea la carpeta `.vercel/` con el id del proyecto (ya está en `.gitignore`). Sin `--prod`
el despliegue es una preview con URL propia, útil para revisar antes de publicar.

### Opción B — GitHub con despliegue automático

1. Creá un repositorio vacío en GitHub (sin README ni `.gitignore`, ya los tiene este proyecto).
2. Conectá el remoto y subí la rama `main`:

```bash
git remote add origin https://github.com/<usuario>/<repo>.git
```

```bash
git push -u origin main
```

3. En [vercel.com/new](https://vercel.com/new) elegí **Import Git Repository** y seleccioná el
   repo. Vercel detecta Astro y lee `vercel.json` automáticamente; no hay que configurar nada.

A partir de ahí, cada push a `main` publica en producción y cada pull request genera una preview.

> El build de Vercel corre `npm run build`, que incluye `astro check`. Un error de tipos aborta
> el despliegue antes de publicar. Si preferís que no bloquee, cambiá el script a solo
> `astro build`.

## Pendiente antes de publicar

El formulario valida en el cliente y muestra un estado de éxito, **pero todavía no envía los
datos a ningún servidor**. Hay que conectar el `TODO` marcado en el `<script>` de
[`src/components/Contact.astro`](src/components/Contact.astro) a un endpoint real (API propia,
CRM o un servicio de formularios).

También conviene reemplazar los datos de ejemplo en `src/data/site.ts` (dirección, teléfonos,
correo, redes y número de registro profesional del footer) por los reales, y ajustar
`site` en [`astro.config.mjs`](astro.config.mjs) al dominio definitivo para que el enlace
canónico y el JSON-LD sean correctos.
