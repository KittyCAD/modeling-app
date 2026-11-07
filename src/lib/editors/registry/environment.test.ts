import savingExtension, { SAVE_EDITOR_COMMAND } from '@src/lib/save/registry'
import {
  editorSaveService,
  editorOnSaveValueSpec,
} from '@src/lib/save/registry/contract'
import drawingsPlugin from '@src/lib/drawings/registry/plugin'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorsService,
  executorCapabilityValueSpec,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
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
import pngExtension from '@src/lib/png/registry'
import editorsExtension from '@src/lib/editors/registry'
import markdownExtension from '@src/lib/markdown/registry'
import {
  editorTabIndicatorValueSpec,
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
        savingExtension,
        pngExtension,
        markdownExtension,
        executorsExtension,
        drawingsPlugin,
      ])
      registry.get(userFeaturesService)
      await Promise.resolve()
      expect(registry.optional(editorSaveService) !== undefined).toBe(enabled)
      expect(
        registry
          .get(editorOnSaveValueSpec)
          .some(({ id }) => id === 'save.persistToDisk')
      ).toBe(enabled)
      expect(
        registry.get(editorViewValueSpec).some(({ id }) => id === 'png.image')
      ).toBe(enabled)
      expect(registry.get(editorViewValueSpec).length > 0).toBe(enabled)
      expect(registry.get(editorTabIndicatorValueSpec).length > 0).toBe(enabled)
      expect(
        registry
          .get(commandsValueSpec)
          .some(({ id }) => id === SAVE_EDITOR_COMMAND.id)
      ).toBe(enabled)
      expect(registry.optional(executorsService) !== undefined).toBe(enabled)
      expect(registry.get(executorCapabilityValueSpec).length > 0).toBe(enabled)
      expect(registry.get(executorViewValueSpec).length > 0).toBe(enabled)
      expect(
        registry
          .get(commandsValueSpec)
          .some(({ id }) => id === OPEN_EXECUTOR_COMMAND.id)
      ).toBe(enabled)
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
