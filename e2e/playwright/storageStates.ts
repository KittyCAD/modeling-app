import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { Themes } from 'lib/theme'

export const TEST_SETTINGS_KEY = '/settings.toml'
export const TEST_SETTINGS = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: '',
    enableSSAO: false,
  },
  modeling: {
    defaultUnit: 'in',
    mouseControls: 'KittyCAD',
    showDebugPanel: true,
  },
  projects: {
    defaultProjectName: 'project-$nnn',
  },
  textEditor: {
    textWrapping: true,
  },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_ONBOARDING = {
  ...TEST_SETTINGS,
  app: { ...TEST_SETTINGS.app, onboardingStatus: '/export ' },
} satisfies Partial<SaveSettingsPayload>

export const TEST_SETTINGS_CORRUPTED = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: 123 as any,
  },
  modeling: {
    defaultUnit: 'invalid' as any,
    mouseControls: `() => alert('hack the planet')` as any,
    showDebugPanel: true,
  },
  projects: {
    defaultProjectName: false as any,
  },
  textEditor: {
    textWrapping: true,
  },
} satisfies Partial<SaveSettingsPayload>
