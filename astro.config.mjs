// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

/**
 * Carga .env en `process.env`.
 *
 * Vite lo carga en `import.meta.env`, pero NO en `process.env`, y la capa de
 * base de datos lee de `process.env` (tambien la usan los scripts de Node, que
 * corren fuera de Vite). Sin esto, `astro dev` levanta pero toda ruta que
 * consulte la base falla con "Falta DATABASE_URL".
 *
 * En Vercel no existe el archivo: el catch lo ignora y las variables ya vienen
 * puestas por la plataforma.
 */
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se asume que las variables ya estan en el entorno.
}

export default defineConfig({
  // Dominio publico del sitio: de aqui salen el enlace canonico, og:url y el JSON-LD.
  // Al conectar un dominio propio en Vercel, actualizar esta URL y redesplegar.
  site: 'https://dentaclinica.vercel.app',

  // Modelo hibrido: la landing se prerenderiza (sigue siendo HTML estatico),
  // y solo las rutas que declaran `prerender = false` corren en servidor.
  output: 'static',
  adapter: vercel(),

  security: {
    // Valida la cabecera Origin en peticiones no-GET: defensa CSRF de base,
    // que se suma a las cookies SameSite=Lax de la sesion.
    checkOrigin: true,
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
