/**
 * Where a token is kept between sessions.
 *
 * Browser storage on both platforms. The existing app keeps the desktop token in
 * a per-environment config file, which survives a cleared browser profile and
 * supports switching environments; that is a real difference and this is
 * knowingly the simpler version.
 *
 * A token is a bearer credential, so it is never logged and never included in
 * an error message.
 */

const STORAGE_KEY = 'zds.auth.token'
const SOURCE_KEY = 'zds.auth.source'

export interface StoredToken {
  token: string
  source: string
}

export function readStoredToken(): StoredToken | null {
  try {
    const token = localStorage.getItem(STORAGE_KEY)
    if (!token?.trim()) return null
    return {
      token: token.trim(),
      source: localStorage.getItem(SOURCE_KEY) ?? 'stored',
    }
  } catch {
    // Private browsing and locked-down profiles both refuse storage. Signing in
    // again is a smaller cost than failing to start.
    return null
  }
}

export function writeStoredToken(stored: StoredToken): void {
  try {
    localStorage.setItem(STORAGE_KEY, stored.token)
    localStorage.setItem(SOURCE_KEY, stored.source)
  } catch (error) {
    console.warn('auth: could not persist the token', error)
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(SOURCE_KEY)
  } catch {
    // Nothing to do: the token is already gone from memory.
  }
}

/**
 * Environment variables a development token may arrive in.
 *
 * Checked only when nothing is stored, so signing out of an env-provided token
 * does not immediately restore it.
 */
const ENV_TOKEN_VARIABLES = [
  'VITE_KC_DEV_TOKEN',
  'VITE_KITTYCAD_TOKEN',
  'VITE_ZOO_API_TOKEN',
] as const

export function readEnvironmentToken(): StoredToken | null {
  for (const name of ENV_TOKEN_VARIABLES) {
    const value = import.meta.env?.[name] as string | undefined
    if (value?.trim()) return { token: value.trim(), source: name }
  }
  return null
}
