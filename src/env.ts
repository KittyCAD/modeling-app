// env vars were centralised so they could be mocked in jest
// but isn't needed anymore with vite, so is now just a convention

// @ts-ignore: TS1343
const env = window.electron?.process.env ?? import.meta.env

export const NODE_ENV = env.NODE_ENV as string | undefined
export const VITE_KC_API_WS_MODELING_URL = env.VITE_KC_API_WS_MODELING_URL as
  | string
  | undefined
export const VITE_KC_API_BASE_URL = env.VITE_KC_API_BASE_URL as string
export const VITE_KC_SITE_BASE_URL = env.VITE_KC_SITE_BASE_URL as string
export const VITE_KC_SITE_APP_URL = env.VITE_KC_SITE_APP_URL as string
export const VITE_KC_SKIP_AUTH = env.VITE_KC_SKIP_AUTH as string | undefined
export const VITE_KC_CONNECTION_TIMEOUT_MS =
  env.VITE_KC_CONNECTION_TIMEOUT_MS as string | undefined
export const VITE_KC_DEV_TOKEN = env.VITE_KC_DEV_TOKEN as string | undefined
export const VITE_KC_KCL_SAMPLES_REF = env.VITE_KC_KCL_SAMPLES_REF as string | undefined
export const PROD = env.PROD as string | undefined
export const TEST = env.TEST as string | undefined
export const DEV = env.DEV as string | undefined
export const CI = env.CI as string | undefined
