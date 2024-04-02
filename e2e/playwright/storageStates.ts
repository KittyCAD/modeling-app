import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { secrets } from './secrets'
import * as TOML from '@iarna/toml'
import { Themes } from 'lib/theme'

export const basicSettings = {
  app: {
    theme: Themes.Dark,
    onboardingStatus: 'dismissed',
    projectDirectory: '',
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

export const basicStorageState = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:3000',
      localStorage: [
        { name: 'TOKEN_PERSIST_KEY', value: secrets.token },
        { name: 'persistCode', value: '' },
        {
          name: '/user.toml',
          value: TOML.stringify({ settings: basicSettings }),
        },
      ],
    },
  ],
}
