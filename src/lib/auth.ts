import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { db } from '../db';
import { sessions, users, type User } from '../db/schema';
import { hashPassword, verifyPassword } from './password';

export { hashPassword, verifyPassword };

export const SESSION_COOKIE = 'dc_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Si a la sesion le queda menos que esto, se renueva sola al usarla. */
const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export type SessionUser = Pick<User, 'id' | 'email' | 'fullName' | 'phone' | 'role'>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSession(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);

  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  // Renovacion deslizante: quien usa la app no es expulsado a los 30 dias exactos.
  if (row.expiresAt.getTime() - Date.now() < SESSION_REFRESH_THRESHOLD_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
  }

  const { expiresAt: _ignored, ...user } = row;
  return user;
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Limpieza oportunista de sesiones vencidas. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; minutes: number };

/**
 * Verifica credenciales con bloqueo temporal tras varios fallos.
 *
 * Cuando el correo no existe igualmente se calcula un hash, para que el tiempo
 * de respuesta no revele si la cuenta esta registrada (enumeracion de usuarios).
 */
export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  const found = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  const user = found[0];

  if (!user) {
    await hashPassword(password);
    return { ok: false, reason: 'invalid' };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, reason: 'locked', minutes };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const attempts = user.failedLoginAttempts + 1;
    const reachedLimit = attempts >= MAX_FAILED_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLoginAttempts: reachedLimit ? 0 : attempts,
        lockedUntil: reachedLimit ? new Date(Date.now() + LOCK_MS) : null,
      })
      .where(eq(users.id, user.id));

    if (reachedLimit) return { ok: false, reason: 'locked', minutes: Math.ceil(LOCK_MS / 60000) };
    return { ok: false, reason: 'invalid' };
  }

  if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
    },
  };
}

export function setSessionCookie(cookies: AstroCookies, token: string, expiresAt: Date): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, // inaccesible desde JavaScript: mitiga robo por XSS
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
