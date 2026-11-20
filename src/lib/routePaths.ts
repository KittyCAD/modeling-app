const SETTINGS = '/settings'
const HOME = '/home'
const LIBRARY = '/library'

export const PATHS = {
  INDEX: '/',
  HOME,
  LIBRARY,
  FILE: '/file',
  // Experimental directory and cloud-project shells use separate namespaces.
  LOCAL: '/local',
  PROJECT: '/project',
  SETTINGS,
  SETTINGS_USER: `${SETTINGS}?tab=user` as const,
  SETTINGS_PROJECT: `${SETTINGS}?tab=project` as const,
  SETTINGS_KEYBINDINGS: `${SETTINGS}?tab=keybindings` as const,
  HOME_SETTINGS: `${HOME}${SETTINGS}` as const,
  SIGN_IN: '/signin',
  ONBOARDING: '/onboarding',
  TELEMETRY: '/telemetry',
} as const
