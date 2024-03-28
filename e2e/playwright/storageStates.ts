import { secrets } from './secrets'

export const basicStorageState = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:3000',
      localStorage: [
        { name: 'TOKEN_PERSIST_KEY', value: secrets.token },
        { name: 'persistCode', value: '' },
        {
          name: '/settings.json',
          value: JSON.stringify({
            app: {
              theme: 'dark',
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
          }),
        },
      ],
    },
  ],
}
