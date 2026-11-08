import kclExtension from '@src/lib/kcl/registry'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import { PROJECT_SHELL_FEATURE } from '@src/lib/projectSession/next/feature'
import editorsExtension from '@src/lib/editors/registry'
import markdownExtension from '@src/lib/markdown/registry'
import {
  editorViewValueSpec,
  editorCapabilityValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import {
  OPEN_EDITOR_COMMAND,
  NEW_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { afterEach, describe, expect, it } from 'vitest'

const granted = signal(false)
const featureFlags = defineRegistryItem({
  providesServices: [
    provideService(userFeaturesService, {
      has: (flag: string, fallback: boolean) =>
        flag === PROJECT_SHELL_FEATURE ? granted.value : fallback,
    } as UserFeaturesRegistryService),
  ],
})

describe('experimental editor registration', () => {
  let registry: Registry | undefined
  afterEach(() => {
    registry?.[Symbol.dispose]()
  })

  it.each([false, true])(
    'registers experimental services and commands only with the project-shell flag: %s',
    async (enabled) => {
      granted.value = enabled
      registry = new Registry()
      registry.configure([
        featureFlags,
        editorsExtension,
        markdownExtension,
        kclExtension,
      ])
      registry.get(userFeaturesService)
      await Promise.resolve()
      expect(registry.get(editorViewValueSpec).length > 0).toBe(enabled)
      expect(registry.optional(editorsService) !== undefined).toBe(enabled)
      expect(registry.get(editorCapabilityValueSpec).length > 0).toBe(enabled)
      for (const command of [OPEN_EDITOR_COMMAND, NEW_EDITOR_COMMAND]) {
        expect(
          registry.get(commandsValueSpec).some(({ id }) => id === command.id)
        ).toBe(enabled)
      }
    }
  )
})
