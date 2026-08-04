// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Dominio publico del sitio: de aqui salen el enlace canonico, og:url y el JSON-LD.
  // Al conectar un dominio propio en Vercel, actualizar esta URL y redesplegar.
  site: 'https://dentaclinic.vercel.app',
  vite: {
    plugins: [tailwindcss()],
  },
});
