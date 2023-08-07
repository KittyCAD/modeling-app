// all web app environment variables are defined here, jest doesn't like import.meta.env so centralising them here
// allows us to mock them in one place, see src/setupTests.ts, it pulls the variable names and valuse from .env.development
// note the exported variable name must match the env var name for the jest mocks to work
// i.e. const VITE_MY_VAR = import.meta.env.VITE_MY_VAR
// Maybe this file should be generated in a GHA from .env.development?

// @ts-ignore
export const VITE_KC_API_WS_MODELING_URL = import.meta.env
  .VITE_KC_API_WS_MODELING_URL
// @ts-ignore
export const VITE_KC_API_BASE_URL = import.meta.env.VITE_KC_API_BASE_URL
export const VITE_KC_SITE_BASE_URL = import.meta.env.VITE_KC_SITE_BASE_URL

export const TEST = import.meta.env.TEST
