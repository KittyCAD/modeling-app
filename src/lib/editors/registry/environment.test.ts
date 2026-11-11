import { provideWasmPromise } from '@src/registry/contracts/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { modelingToolsService } from '@src/lib/modelingTools/registry/contract'
import kclExtension from '@src/lib/kcl/registry'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorsService,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import savingExtension, { SAVE_EDITOR_COMMAND } from '@src/lib/save/registry'
import {
  editorSaveService,
  editorOnSaveValueSpec,
} from '@src/lib/save/registry/contract'
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
import pngExtension from '@src/lib/png/registry'
import {
  editorTabIndicatorValueSpec,
  editorViewValueSpec,
  codeEditorExtensionValueSpec,
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
  provides: [provideWasmPromise(new Promise<ModuleType>(() => {}))],
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
        kclExtension,
        executorsExtension,
        savingExtension,
        markdownExtension,
        pngExtension,
      ])
      registry.get(userFeaturesService)
      await Promise.resolve()
      expect(registry.optional(editorSaveService) !== undefined).toBe(enabled)
      expect(
        registry
          .get(editorOnSaveValueSpec)
          .some(({ id }) => id === 'save.persistToDisk')
      ).toBe(enabled)
      expect(registry.get(editorViewValueSpec).length > 0).toBe(enabled)
      expect(
        registry.get(editorViewValueSpec).some(({ id }) => id === 'png.image')
      ).toBe(enabled)
      expect(registry.get(editorTabIndicatorValueSpec).length > 0).toBe(enabled)
      expect(
        registry
          .get(commandsValueSpec)
          .some(({ id }) => id === SAVE_EDITOR_COMMAND.id)
      ).toBe(enabled)
      expect(registry.optional(editorsService) !== undefined).toBe(enabled)
      expect(registry.get(codeEditorExtensionValueSpec).length > 0).toBe(
        enabled
      )
      expect(registry.optional(executorsService) !== undefined).toBe(enabled)
      expect(registry.optional(modelingToolsService) !== undefined).toBe(
        enabled
      )
      expect(registry.get(executorCapabilityValueSpec).length > 0).toBe(enabled)
      expect(registry.get(editorCapabilityValueSpec).length > 0).toBe(enabled)
      for (const command of [OPEN_EDITOR_COMMAND, NEW_EDITOR_COMMAND]) {
        expect(
          registry.get(commandsValueSpec).some(({ id }) => id === command.id)
        ).toBe(enabled)
      }
    }
  )
})
