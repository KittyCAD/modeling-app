import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

export interface ICookie {
  name: string,
  value: string,
  domain: string,
  secure?: true,
}
export interface Cookie extends ICookie {}
export class Cookie {
  constructor(args: ICookie) {
    this.name = args.name
    this.value = args.value
    this.domain = args.domain
    this.secure = args.secure
  }

  toString(): string {
    return `${this.name}=${this.value}; domain=${this.domain} ${this.secure ? ' ; Secure' : ''}`;
  }
}

// Pass along custom cookies to requests ONLY ON STAGING OR DEBUG BUILDS.
// Cookies can only be deleted by setting their expiry to immediately,
// otherwise they are overridden.
export const initializeCustomCookies = (cookies: ICookie[]) => {
  if (!IS_STAGING_OR_DEBUG) return

  // Each document.cookie assignment has the side-effect of the browser engine
  // entering a cookie row, so it's a bit unorthodox.
  cookies.forEach((cookie: ICookie) => {
    const cookieStr = (!(cookie instanceof Cookie) ? new Cookie(cookie) : cookie).toString()
    document.cookie = cookieStr
  })

  // On window close, clean up the custom cookies.
  window.addEventListener('close', () => {
    document.cookie.split(';').forEach((cookieStr: string) => {
      cookieStr += ` ;expires=`
      document.cookie = cookieStr
    })
  })
}
