export interface MasqueradeStatus {
  user_id: string
  display_name: string
  expires_at: string | null
  expired: boolean
  environment: string
}

// This is a display hint. The API checks a separate HTTP-only credential.
export function hasMasqueradeHint(apiBase: string): boolean {
  if (typeof document === 'undefined') return false
  const domain = new URL(apiBase).hostname.replace(/^api\./, '')
  return document.cookie
    .split(';')
    .some((value) => value.trim() === `__Secure-masquerade-${domain}=1`)
}

export function readSessionIdentity(): string {
  if (typeof document === 'undefined') return ''
  return document.cookie
    .split(';')
    .map((value) => value.trim())
    .filter(
      (value) =>
        value.startsWith('__Secure-next-auth.session-token=') ||
        value.startsWith('__Secure-session-token-')
    )
    .sort()
    .join(';')
}

// Cookies are shared across Zoo origins. Reload before another interaction can
// submit an old account's state using the new account's credentials.
export function watchSessionIdentity(
  onChange: () => void,
  paused: () => boolean = () => false,
  read: () => string = readSessionIdentity
): () => void {
  const initial = read()
  let changed = false
  const check = (event?: Event) => {
    if (paused()) return
    if (!changed && read() === initial) return
    event?.preventDefault()
    event?.stopImmediatePropagation()
    if (changed) return
    changed = true
    onChange()
  }
  const events = [
    'focus',
    'pageshow',
    'pointerdown',
    'click',
    'keydown',
  ] as const
  for (const event of events) window.addEventListener(event, check, true)
  const timer = window.setInterval(check, 250)
  return () => {
    window.clearInterval(timer)
    for (const event of events) window.removeEventListener(event, check, true)
  }
}
