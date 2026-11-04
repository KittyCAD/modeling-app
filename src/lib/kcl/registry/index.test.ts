import { Registry } from '@kittycad/registry'
import kclExtension from '@src/lib/kcl/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { afterEach, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ enabled: true }))
vi.mock('@src/routes/utils', () => ({
  get IS_STAGING_OR_DEBUG() {
    return environment.enabled
  },
}))
const registry = new Registry()
afterEach(() => registry[Symbol.dispose]())

it.each([false, true])(
  'gates KCL editor contributions to dev/staging: %s',
  (enabled) => {
    environment.enabled = enabled
    registry.configure([kclExtension])
    expect(registry.get(editorCapabilityValueSpec).length > 0).toBe(enabled)
  }
)
