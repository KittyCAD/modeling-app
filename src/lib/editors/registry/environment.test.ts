import { signal } from '@preact/signals-core'
import {
  NEW_EDITOR_COMMAND,
  OPEN_EDITOR_COMMAND,
} from '@src/lib/editors/commands'
import editorsExtension from '@src/lib/editors/registry'
import {
  codeEditorsExtensionFacet,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import kclExtension from '@src/lib/kcl/registry'
import markdownExtension from '@src/lib/markdown/registry'
import { PROJECT_SHELL_FEATURE } from '@src/lib/projectSession/next/feature'
import { commandsFacet } from '@src/registry/contracts/commands'
import {
  type UserFeaturesRegistryService,
  userFeaturesService,
} from '@src/registry/contracts/userFeatures'
import { provide, Registry } from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'
const granted = signal(false)
const featureFlags = [
  provide(userFeaturesService, {
    has: (flag: string, fallback: boolean) =>
      flag === PROJECT_SHELL_FEATURE ? granted.value : fallback,
  } as UserFeaturesRegistryService),
]
describe('experimental editor registration', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
  })
  it.each([false, true])(
    'registers experimental services and commands only with the project-shell flag: %s',
    async (enabled) => {
      granted.value = enabled
      registry = new Registry()
      await registry.configure([
        featureFlags,
        editorsExtension,
        markdownExtension,
        kclExtension,
      ])
      registry.required(userFeaturesService)
      await Promise.resolve()
      expect(registry.get(editorViewsFacet).length > 0).toBe(enabled)
      expect(registry.optional(editorsService) !== undefined).toBe(enabled)
      expect(registry.get(codeEditorsExtensionFacet).length > 0).toBe(enabled)
      for (const command of [OPEN_EDITOR_COMMAND, NEW_EDITOR_COMMAND]) {
        expect(
          registry.get(commandsFacet).some(({ id }) => id === command.id)
        ).toBe(enabled)
      }
    }
  )
})
