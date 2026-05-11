import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  type FeatureTreeVisibilityState,
  getOperationForArtifact,
  resolveFeatureTreeVisibility,
} from '@src/lib/featureTree'
import { describe, expect, it } from 'vitest'

function range(start: number, end: number): SourceRange {
  return [start, end, 0]
}

function sketchSolveOperation(sourceRange: SourceRange): Operation {
  return {
    type: 'SketchSolve',
    sketchId: 1,
    nodePath: defaultNodePath(),
    sourceRange,
  }
}

function helixOperation(sourceRange: SourceRange): Operation {
  return {
    type: 'StdLibCall',
    name: 'helix',
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange,
    isError: false,
  }
}

function gdtOperation(
  sourceRange: SourceRange,
  stdlibEntrySourceRange?: SourceRange
): Operation {
  const operation: Operation = {
    type: 'StdLibCall',
    name: 'gdt::flatness',
    unlabeledArg: null,
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange,
    isError: false,
  }
  if (stdlibEntrySourceRange) {
    operation.stdlibEntrySourceRange = stdlibEntrySourceRange
  }
  return operation
}

function hideOperation(sourceRange: SourceRange, value: OpKclValue): Operation {
  return {
    type: 'StdLibCall',
    name: 'hide',
    unlabeledArg: {
      sourceRange,
      value,
    },
    labeledArgs: {},
    nodePath: defaultNodePath(),
    sourceRange,
    isError: false,
  }
}

function gdtAnnotationArtifact(id: string, sourceRange: SourceRange): Artifact {
  return {
    type: 'gdtAnnotation',
    id,
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
  }
}

function sketchBlockArtifact(id: string, sourceRange: SourceRange): Artifact {
  return {
    type: 'sketchBlock',
    id,
    planeId: null,
    sketchId: 1,
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
  }
}

function helixArtifact(id: string, sourceRange: SourceRange): Artifact {
  return {
    type: 'helix',
    id,
    axisId: null,
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
    trajectorySweepId: null,
    consumed: false,
  }
}

function pathArtifact(id: string, sourceRange: SourceRange): Artifact {
  return {
    type: 'path',
    subType: 'sketch',
    id,
    planeId: 'plane-artifact',
    segIds: [],
    consumed: false,
    trajectorySweepId: null,
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
  }
}

function toArtifactGraph(artifacts: Artifact[]): ArtifactGraph {
  const graph: ArtifactGraph = new Map()
  for (const artifact of artifacts) {
    graph.set(artifact.id, artifact)
  }
  return graph
}

function expectHidden(
  visibilityState: FeatureTreeVisibilityState
): asserts visibilityState is FeatureTreeVisibilityState & {
  hideOperation: NonNullable<FeatureTreeVisibilityState['hideOperation']>
  targetArtifact: NonNullable<FeatureTreeVisibilityState['targetArtifact']>
} {
  expect(visibilityState.hideOperation).toBeDefined()
  expect(visibilityState.targetArtifact).toBeDefined()
}

describe('getOperationForArtifact', () => {
  it('resolves a GD&T annotation artifact to its source operation', () => {
    const gdtRange = range(10, 80)
    const operation = gdtOperation(gdtRange)
    const artifact = gdtAnnotationArtifact('gdt-artifact', gdtRange)

    expect(
      getOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBe(operation)
  })

  it('resolves a GD&T annotation artifact via stdlib entry range', () => {
    const declarationRange = range(0, 90)
    const gdtRange = range(12, 89)
    const operation = gdtOperation(declarationRange, gdtRange)
    const artifact = gdtAnnotationArtifact('gdt-artifact', gdtRange)

    expect(
      getOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBe(operation)
  })

  it('does not resolve artifacts that do not point at an operation range', () => {
    const operation = gdtOperation(range(10, 80))
    const artifact = gdtAnnotationArtifact('gdt-artifact', range(90, 120))

    expect(
      getOperationForArtifact({
        artifact,
        operations: [operation],
      })
    ).toBeUndefined()
  })
})

describe('resolveFeatureTreeVisibility', () => {
  it('resolves sketch visibility via artifact-id hide matching', () => {
    const sketchDeclaration = 'sketch001 = sketch(on = XY) {}'
    const code = `${sketchDeclaration}\nhide(sketch001)`
    const sketchRange = range(0, sketchDeclaration.length)
    const hideRange = range(code.indexOf('hide('), code.length)

    const item = sketchSolveOperation(sketchRange)
    const hideOp = hideOperation(hideRange, {
      type: 'Sketch',
      value: { artifactId: 'sketch-artifact' },
    })
    const artifact = sketchBlockArtifact('sketch-artifact', sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact]),
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expectHidden(visibilityState)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact.id).toBe('sketch-artifact')
  })

  it('resolves sketch visibility when hide references a sibling path artifact id', () => {
    const sketchDeclaration = 'sketch001 = sketch(on = XY) {}'
    const code = `${sketchDeclaration}\nhide(sketch001)`
    const sketchRange = range(0, sketchDeclaration.length)
    const hideRange = range(code.indexOf('hide('), code.length)

    const item = sketchSolveOperation(sketchRange)
    const hideOp = hideOperation(hideRange, {
      type: 'Sketch',
      value: { artifactId: 'path-artifact' },
    })
    const artifact = sketchBlockArtifact('sketch-artifact', sketchRange)
    const path = pathArtifact('path-artifact', sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact, path]),
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact?.id).toBe('sketch-artifact')
  })

  it('disables sketch visibility toggle when no sketchBlock artifact is found', () => {
    const sketchRange = range(0, 20)
    const item = sketchSolveOperation(sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [],
      artifactGraph: new Map(),
    })

    expect(visibilityState.canToggleVisibility).toBe(false)
    expect(visibilityState.hideOperation).toBeUndefined()
    expect(visibilityState.targetArtifact).toBeUndefined()
  })

  it('resolves helix visibility using artifact-id hide matching', () => {
    const code = 'helix001 = helix()'
    const helixRange = range(0, code.length)
    const item = helixOperation(helixRange)
    const artifact = helixArtifact('helix-artifact', helixRange)
    const hideOp = hideOperation(range(0, 12), {
      type: 'Helix',
      value: { artifactId: 'helix-artifact' },
    })

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact]),
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expectHidden(visibilityState)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact.id).toBe('helix-artifact')
  })

  it('does not resolve when hide targets a different sketch artifact', () => {
    const sketchDeclaration = 'sketch001 = sketch(on = XY) {}'
    const code = `${sketchDeclaration}\nhide(sketch999)`
    const sketchRange = range(0, sketchDeclaration.length)
    const hideRange = range(code.indexOf('hide('), code.length)

    const item = sketchSolveOperation(sketchRange)
    const hideOp = hideOperation(hideRange, {
      type: 'Sketch',
      value: { artifactId: 'different-artifact' },
    })
    const artifact = sketchBlockArtifact('sketch-artifact', sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact]),
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expect(visibilityState.hideOperation).toBeUndefined()
    expect(visibilityState.targetArtifact?.id).toBe('sketch-artifact')
  })
})
