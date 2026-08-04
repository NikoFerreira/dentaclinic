// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://dentaclinic.com.py',
  vite: {
    plugins: [tailwindcss()],
  },
});
