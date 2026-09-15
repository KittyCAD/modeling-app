import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import { kclCommands } from '@src/lib/kclCommands'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('Set experimental features flag command', () => {
  it.each([
    {
      description: 'an empty file',
      initialCode: '',
      existingSettings: '',
      body: '',
    },
    {
      description: 'a settings-only new project',
      initialCode: '@settings(kclVersion = 2.0)\n',
      existingSettings: 'kclVersion = 2.0, ',
      body: '',
    },
    {
      description: 'a file with existing settings and code',
      initialCode:
        '@settings(defaultLengthUnit = cm, kclVersion = 2.0)\n\nx = 1\n',
      existingSettings: 'defaultLengthUnit = cm, kclVersion = 2.0, ',
      body: '\nx = 1\n',
    },
  ])(
    'writes flag changes to $description',
    async ({ initialCode, existingSettings, body }) => {
      const { app, kclManager } = createKclManagerTestHarness(initialCode)
      const writeToFileSpy = vi
        .spyOn(kclManager, 'writeToFile')
        .mockResolvedValue(undefined)
      const command = kclCommands({
        kclManager,
        wasmInstance: await kclManager.wasmInstancePromise,
        systemIOActor: app.systemIOActor,
        projectData: { code: initialCode },
        settings: { defaultUnit: 'mm' },
        specialPropsForInsertCommand: { providedOptions: [] },
      }).find((command) => command.name === 'set-file-experimental-features')

      if (!command) {
        throw new Error('Experimental features command is missing')
      }

      try {
        for (const level of ['Allow', 'Warn', 'Deny'] as const) {
          writeToFileSpy.mockClear()
          command.onSubmit({ level })

          const expectedCode = `@settings(${existingSettings}experimentalFeatures = ${level.toLowerCase()})\n${body}`
          await vi.waitFor(() => {
            expect(kclManager.code).toBe(expectedCode)
            expect(writeToFileSpy.mock.calls.at(-1)?.[0]).toBe(expectedCode)
          })
        }
      } finally {
        app.dispose()
      }
    }
  )
})
