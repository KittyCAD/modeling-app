// env vars were centralised so they could be mocked in jest
// but isn't needed anymore with vite, so is now just a convention

// Even though we transpile to a module system that supports import, the
// typescript checker doesn't know that, so it's causing problems
// to properly type check anything with "import.meta". I've tried for a good
// hour to fix this but nothing has worked. This is the pain the JS ecosystem
// gets for like 6 different module systems.

const envElec = window.electron?.process?.env
const envVite = import.meta.env

export const NODE_ENV = (envElec ? envElec.NODE_ENV() : envVite.NODE_ENV) as
  | string
  | undefined
export const VITE_KC_API_WS_MODELING_URL = (
  envElec
    ? envElec.VITE_KC_API_WS_MODELING_URL()
    : envVite.VITE_KC_API_WS_MODELING_URL
) as string | undefined
export const VITE_KC_API_BASE_URL = (
  envElec ? envElec.VITE_KC_API_BASE_URL() : envVite.VITE_KC_API_BASE_URL
) as string | undefined
export const VITE_KC_SITE_BASE_URL = (
  envElec ? envElec.VITE_KC_SITE_BASE_URL() : envVite.VITE_KC_SITE_BASE_URL
) as string | undefined
export const VITE_KC_SKIP_AUTH = (
  envElec ? envElec.VITE_KC_SKIP_AUTH() : envVite.VITE_KC_SKIP_AUTH
) as string | undefined
export const VITE_KC_CONNECTION_TIMEOUT_MS = (
  envElec
    ? envElec.VITE_KC_CONNECTION_TIMEOUT_MS()
    : envVite.VITE_KC_CONNECTION_TIMEOUT_MS
) as string | undefined
export const VITE_KC_DEV_TOKEN = (
  envElec ? envElec.VITE_KC_DEV_TOKEN() : envVite.VITE_KC_DEV_TOKEN
) as string | undefined

export const PROD = (envElec ? envElec.PROD() : envVite.PROD) as
  | string
  | undefined
export const TEST = (envElec ? envElec.TEST() : envVite.TEST) as
  | string
  | undefined
export const DEV = (envElec ? envElec.DEV() : envVite.DEV) as string | undefined
export const CI = (envElec ? envElec.CI() : envVite.CI) as string | undefined
