/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth';

declare global {
  namespace App {
    interface Locals {
      /** Usuario de la sesion activa, o `null` si nadie inicio sesion. */
      user: SessionUser | null;
    }
  }
}
