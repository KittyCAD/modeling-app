import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  resolveFeatureTreeVisibility,
  type FeatureTreeVisibilityState,
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

describe('resolveFeatureTreeVisibility', () => {
  it('resolves hidden sketch visibility from hide(sketch###) source text', () => {
    const sketchDeclaration = 'sketch001 = sketch(on = XY) {}'
    const code = `${sketchDeclaration}\nhide(sketch001)`
    const sketchRange = range(0, sketchDeclaration.length)
    const hideArgStart = code.indexOf('sketch001)')
    const hideArgRange = range(hideArgStart, hideArgStart + 'sketch001'.length)

    const item = sketchSolveOperation(sketchRange)
    const hideOp = hideOperation(hideArgRange, {
      type: 'String',
      value: 'sketch001',
    })
    const artifact = sketchBlockArtifact('sketch-artifact', sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      variableName: 'sketch001',
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact]),
      code,
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expectHidden(visibilityState)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact.id).toBe('sketch-artifact')
  })

  it('falls back to artifact-id matching for sketch visibility', () => {
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
      code,
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expectHidden(visibilityState)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact.id).toBe('sketch-artifact')
  })

  it('disables sketch visibility toggle when no sketchBlock artifact is found', () => {
    const sketchRange = range(0, 20)
    const item = sketchSolveOperation(sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      operations: [],
      artifactGraph: new Map(),
      code: 'sketch001 = sketch(on = XY) {}',
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
      code,
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expectHidden(visibilityState)
    expect(visibilityState.hideOperation).toBe(hideOp)
    expect(visibilityState.targetArtifact.id).toBe('helix-artifact')
  })

  it('uses whole-word variable matching for hide(sketch###)', () => {
    const sketchDeclaration = 'sketch1 = sketch(on = XY) {}'
    const code = `${sketchDeclaration}\nhide(sketch10)`
    const sketchRange = range(0, sketchDeclaration.length)
    const hideArgStart = code.indexOf('sketch10)')
    const hideArgRange = range(hideArgStart, hideArgStart + 'sketch10'.length)

    const item = sketchSolveOperation(sketchRange)
    const hideOp = hideOperation(hideArgRange, {
      type: 'String',
      value: 'sketch10',
    })
    const artifact = sketchBlockArtifact('sketch-artifact', sketchRange)

    const visibilityState = resolveFeatureTreeVisibility({
      item,
      variableName: 'sketch1',
      operations: [hideOp],
      artifactGraph: toArtifactGraph([artifact]),
      code,
    })

    expect(visibilityState.canToggleVisibility).toBe(true)
    expect(visibilityState.hideOperation).toBeUndefined()
    expect(visibilityState.targetArtifact?.id).toBe('sketch-artifact')
  })
})
