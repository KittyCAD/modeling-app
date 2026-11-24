import '@src/lib/projectSession/next/testFeature'
import { Registry } from 'plankton'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => {
  throw new Error('KCL registry discovery must not initialize the legacy app')
})
vi.mock('@src/lib/wasm_lib_wrapper', () => {
  throw new Error('KCL registry discovery must not load generated WASM')
})
vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => {
  throw new Error('KCL registry discovery must not load generated commands')
})

import kclExtension from '@src/lib/kcl/registry'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'

it('discovers KCL Code and Modeling contributions without the legacy app or generated artifacts', async () => {
  const registry = new Registry()
  try {
    await registry.configure(kclExtension)
    expect(registry.get(editorLanguagesFacet)).toContainEqual({
      id: 'kcl',
      matches: '.kcl',
    })
    expect(
      registry
        .get(codeEditorsExtensionFacet)
        .some((extension) => extension.id === 'editors.kcl')
    ).toBe(true)
    expect(
      registry.get(editorViewsFacet).some((view) => view.id === 'kcl.modeling')
    ).toBe(true)
  } finally {
    await registry.dispose()
  }
})
