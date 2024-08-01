// env vars were centralised so they could be mocked in jest
// but isn't needed anymore with vite, so is now just a convention

// Even though we transpile to a module system that supports import, the
// typescript checker doesn't know that, so it's causing problems
// to properly type check anything with "import.meta". I've tried for a good
// hour to fix this but nothing has worked. This is the pain the JS ecosystem
// gets for like 6 different module systems.

// @ts-ignore
export const VITE_KC_API_WS_MODELING_URL = import.meta.env
  .VITE_KC_API_WS_MODELING_URL
// @ts-ignore
export const VITE_KC_API_BASE_URL = import.meta.env.VITE_KC_API_BASE_URL
// @ts-ignore
export const VITE_KC_SITE_BASE_URL = import.meta.env.VITE_KC_SITE_BASE_URL
// @ts-ignore
export const VITE_KC_CONNECTION_TIMEOUT_MS = import.meta.env
  .VITE_KC_CONNECTION_TIMEOUT_MS
// @ts-ignore
export const VITE_KC_DEV_TOKEN = import.meta.env.VITE_KC_DEV_TOKEN as
  | string
  | undefined
// @ts-ignore
export const TEST = import.meta.env.TEST
// @ts-ignore
export const DEV = import.meta.env.DEV
export const CI = import.meta.env.CI
