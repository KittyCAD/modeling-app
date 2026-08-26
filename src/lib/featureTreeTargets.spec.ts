import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath, type ArtifactGraph } from '@src/lang/wasm'
import {
  getFeatureTreeCapabilities,
  resolveFeatureTreeTarget,
} from '@src/lib/featureTreeTargets'
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

describe('feature-tree targets', () => {
  it('resolves imported geometry semantically and attaches its artifact', () => {
    const operation = importedGeometry()
    const artifactGraph: ArtifactGraph = new Map([
      [
        'imported-geometry',
        {
          type: 'importedGeometry',
          id: 'imported-geometry',
          codeRef: {
            range: operation.sourceRange,
            nodePath: defaultNodePath(),
            pathToNode: [],
          },
        },
      ],
    ])

    expect(resolveFeatureTreeTarget(operation, artifactGraph)).toMatchObject({
      kind: 'geometry',
      geometryType: 'importedGeometry',
      ownerModuleId: 0,
      artifact: { id: 'imported-geometry' },
    })
  })

  it('does not attach an artifact from another source module', () => {
    const operation = importedGeometry()
    const artifactGraph: ArtifactGraph = new Map([
      [
        'other-module-geometry',
        {
          type: 'importedGeometry',
          id: 'other-module-geometry',
          codeRef: {
            range: [10, 30, 2],
            nodePath: defaultNodePath(),
            pathToNode: [],
          },
        },
      ],
    ])

    expect(
      resolveFeatureTreeTarget(operation, artifactGraph).artifact
    ).toBeUndefined()
  })

  it('navigates KCL modules without treating them as editable geometry', () => {
    const target = resolveFeatureTreeTarget(kclModule(), new Map())

    expect(getFeatureTreeCapabilities(target, 0)).toMatchObject({
      canSelect: false,
      sourceNavigation: { kind: 'module', moduleId: 2 },
      translate: 'hidden',
      clone: 'hidden',
    })
  })

  it('enables imported-geometry actions in the editable module', () => {
    const target = resolveFeatureTreeTarget(importedGeometry(), new Map())

    expect(getFeatureTreeCapabilities(target, 0)).toMatchObject({
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
    const target = resolveFeatureTreeTarget(importedGeometry(7), new Map())

    expect(getFeatureTreeCapabilities(target, 0)).toMatchObject({
      canSelect: false,
      sourceNavigation: { kind: 'source', moduleId: 7 },
      appearance: 'hidden',
      translate: 'hidden',
      clone: 'hidden',
      remove: 'hidden',
    })

    expect(getFeatureTreeCapabilities(target, 7)).toMatchObject({
      canSelect: true,
      translate: 'enabled',
      clone: 'enabled',
    })
  })
})
