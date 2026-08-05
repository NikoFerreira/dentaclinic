// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  // Dominio publico del sitio: de aqui salen el enlace canonico, og:url y el JSON-LD.
  // Al conectar un dominio propio en Vercel, actualizar esta URL y redesplegar.
  site: 'https://dentaclinic.vercel.app',

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
