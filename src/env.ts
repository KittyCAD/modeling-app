// env vars were centralised so they could be mocked in jest
// but isn't needed anymore with vite, so is now just a convention

export const VITE_KC_API_WS_MODELING_URL = import.meta.env
  .VITE_KC_API_WS_MODELING_URL
export const VITE_KC_API_BASE_URL = import.meta.env.VITE_KC_API_BASE_URL
export const VITE_KC_SITE_BASE_URL = import.meta.env.VITE_KC_SITE_BASE_URL
export const VITE_KC_CONNECTION_TIMEOUT_MS = import.meta.env
  .VITE_KC_CONNECTION_TIMEOUT_MS
export const TEST = import.meta.env.TEST
export const DEV = import.meta.env.DEV
