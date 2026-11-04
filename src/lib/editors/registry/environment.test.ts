import { Registry } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import markdownExtension from '@src/lib/markdown/registry'
import {
  editorCapabilityValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ isStagingOrDebug: false }))
vi.mock('@src/routes/utils', () => ({
  get IS_STAGING_OR_DEBUG() {
    return environment.isStagingOrDebug
  },
}))

describe('experimental editor registration', () => {
  let registry: Registry | undefined
  afterEach(() => {
    registry?.[Symbol.dispose]()
  })

  it.each([false, true])(
    'registers experimental services and commands only in dev/staging: %s',
    (enabled) => {
      environment.isStagingOrDebug = enabled
      registry = new Registry()
      registry.configure([editorsExtension, markdownExtension])
      expect(registry.optional(editorsService) !== undefined).toBe(enabled)
      expect(registry.get(editorCapabilityValueSpec).length > 0).toBe(enabled)
      expect(
        registry
          .get(commandsValueSpec)
          .some(({ id }) => id === OPEN_EDITOR_COMMAND.id)
      ).toBe(enabled)
    }
  )
})
