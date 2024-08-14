import test, { _electron } from '@playwright/test'
import { TEST_SETTINGS_KEY } from './storageStates'
import { _electron as electron } from '@playwright/test'
import * as TOML from '@iarna/toml'
import fs from 'node:fs'
import { secrets } from './secrets'

test('Electron setup', { tag: '@electron' }, async () => {
  // create or otherwise clear the folder ./electron-test-projects-dir
  const fileName = './electron-test-projects-dir'
  try {
    fs.rmSync(fileName, { recursive: true })
  } catch (e) {
    console.error(e)
  }

  fs.mkdirSync(fileName)

  // get full path for ./electron-test-projects-dir
  const fullPath = fs.realpathSync(fileName)

  const electronApp = await electron.launch({
    args: ['.'],
  })

  const page = await electronApp.firstWindow()

  // Set local storage directly using evaluate
  await page.evaluate(
    (token) => localStorage.setItem('TOKEN_PERSIST_KEY', token),
    secrets.token
  )

  // Override settings with electron temporary project directory
  await page.addInitScript(
    async ({ settingsKey, settings }) => {
      localStorage.setItem(settingsKey, settings)
    },
    {
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({
        settings: {
          app: { projectDirectory: fullPath },
        },
      }),
    }
  )
})
