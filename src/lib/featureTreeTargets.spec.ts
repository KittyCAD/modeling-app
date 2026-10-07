import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import { getFeatureTreeCapabilities } from '@src/lib/featureTreeTargets'
import { describe, expect, it } from 'vitest'

function importedGeometry(
  sourceModuleId = 0
): Extract<Operation, { type: 'ImportedGeometry' }> {
  return {
    type: 'ImportedGeometry',
    name: 'mesh',
    moduleId: 1,
    nodePath: defaultNodePath(),
    sourceRange: [10, 30, sourceModuleId],
  }
}

function kclModule(
  sourceModuleId = 0
): Extract<Operation, { type: 'ModuleInstance' }> {
  return {
    type: 'ModuleInstance',
    name: 'assembly',
    moduleId: 2,
    nodePath: defaultNodePath(),
    sourceRange: [31, 50, sourceModuleId],
  }
}

describe('feature-tree capabilities', () => {
  it('navigates KCL modules without treating them as editable geometry', () => {
    expect(getFeatureTreeCapabilities(kclModule(), 0)).toMatchObject({
      canSelect: false,
      sourceNavigation: { kind: 'module', moduleId: 2 },
      translate: 'hidden',
      clone: 'hidden',
    })
  })

  it('enables imported-geometry actions in the editable module', () => {
    expect(getFeatureTreeCapabilities(importedGeometry(), 0)).toMatchObject({
      canSelect: true,
      sourceNavigation: { kind: 'source', moduleId: 0 },
      appearance: 'enabled',
      translate: 'enabled',
      rotate: 'enabled',
      scale: 'enabled',
      clone: 'enabled',
      remove: 'enabled',
    })
  })

  it('keeps nested geometry read-only based on ownership, at any depth', () => {
    const operation = importedGeometry(7)

    expect(getFeatureTreeCapabilities(operation, 0)).toMatchObject({
      canSelect: false,
      sourceNavigation: { kind: 'source', moduleId: 7 },
      appearance: 'hidden',
      translate: 'hidden',
      clone: 'hidden',
      remove: 'hidden',
    })

    expect(getFeatureTreeCapabilities(operation, 7)).toMatchObject({
      canSelect: true,
      translate: 'enabled',
      clone: 'enabled',
    })
  })
})
