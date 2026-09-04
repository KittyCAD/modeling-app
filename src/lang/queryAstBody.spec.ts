import {
  createLiteral,
  createLocalName,
  createMemberExpression,
  createPipeSubstitution,
} from '@src/lang/create'
import { getVariableExprsFromSelection } from '@src/lang/queryAst'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { assertParse, defaultNodePath } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { loadWasm } from '@src/unitTestUtils'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadWasm()
})

function createMergedBodyGraph() {
  const code = `@settings(kclVersion = 2.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 20mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(point = [0mm, 0mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
sketch002 = sketch(on = faceOf(extrude001, face = END)) {
  circle1 = circle(start = [var -7mm, var 0mm], center = [var -10mm, var 0mm])
  circle2 = circle(start = [var 13mm, var 0mm], center = [var 10mm, var 0mm])
}
region002 = region(point = [-10mm, 0mm], sketch = sketch002)
region003 = region(point = [10mm, 0mm], sketch = sketch002)
extrude002 = extrude([region002, region003], length = 2)
parts = subtract(extrude001, tools = extrude002)`
  const ast = assertParse(code, wasmInstance)
  const ref = (name: string) => {
    const start = code.indexOf(`${name} =`) + `${name} = `.length
    const end = code.indexOf('\n', start)
    return {
      ...codeRefFromRange([start, end === -1 ? code.length : end, 0], ast),
      nodePath: defaultNodePath(),
    }
  }
  const root: Extract<Artifact, { type: 'sweep' }> = {
    type: 'sweep',
    id: 'root',
    pathId: 'root-path',
    subType: 'extrusion',
    surfaceIds: ['cap'],
    edgeIds: [],
    method: 'merge',
    trajectoryId: null,
    consumed: false,
    codeRef: ref('extrude001'),
  }
  const graph: ArtifactGraph = new Map([[root.id, root]])
  graph.set('root-path', {
    type: 'path',
    id: 'root-path',
    subType: 'region',
    planeId: 'xy',
    segIds: [],
    sweepId: root.id,
    trajectorySweepId: null,
    consumed: true,
    codeRef: ref('region001'),
  })
  graph.set('cap', {
    type: 'cap',
    id: 'cap',
    subType: 'end',
    sweepId: root.id,
    pathIds: ['first-path', 'second-path'],
    edgeCutEdgeIds: [],
    cmdId: 'cap',
    faceCodeRef: ref('sketch002'),
  })
  const children = ['first', 'second'].map((id, index) => {
    const child: Extract<Artifact, { type: 'sweep' }> = {
      ...root,
      id,
      pathId: `${id}-path`,
      surfaceIds: [],
      codeRef: ref('extrude002'),
    }
    graph.set(child.id, child)
    graph.set(child.pathId, {
      type: 'path',
      id: child.pathId,
      subType: 'region',
      planeId: 'cap',
      segIds: [],
      sweepId: child.id,
      trajectorySweepId: null,
      consumed: true,
      codeRef: ref(`region00${index + 2}`),
    })
    return child
  })
  return { ast, graph, root, children, ref }
}

describe('body output expressions after last-child lookup', () => {
  it('indexes a merged array output and deduplicates repeated body selections', () => {
    const { ast, graph, root } = createMergedBodyGraph()
    const selection = { artifact: root, codeRef: root.codeRef }
    const result = getVariableExprsFromSelection(
      { graphSelections: [selection, selection], otherSelections: [] },
      graph,
      ast,
      wasmInstance,
      undefined,
      { lastChildLookup: true, artifactTypeFilter: ['sweep', 'compositeSolid'] }
    )
    if (result instanceof Error) throw result

    expect(result.exprs).toEqual([
      createMemberExpression(
        'extrude002',
        createLiteral(0, wasmInstance),
        true
      ),
    ])
    expect(result.pathIfPipe).toBeUndefined()
  })

  it('does not select the array-producing call being edited', () => {
    const { ast, graph, root, ref } = createMergedBodyGraph()
    const result = getVariableExprsFromSelection(
      {
        graphSelections: [{ artifact: root, codeRef: root.codeRef }],
        otherSelections: [],
      },
      graph,
      ast,
      wasmInstance,
      ref('extrude002').pathToNode,
      { lastChildLookup: true, artifactTypeFilter: ['sweep', 'compositeSolid'] }
    )
    if (result instanceof Error) throw result

    expect(result.exprs).toEqual([createLocalName('extrude001')])
  })

  it('preserves the output index of a downstream composite body', () => {
    const { ast, graph, root, ref } = createMergedBodyGraph()
    const composite: Artifact = {
      type: 'compositeSolid',
      id: 'part',
      subType: 'subtract',
      outputIndex: 1,
      solidIds: [root.id],
      toolIds: [],
      consumed: false,
      codeRef: ref('parts'),
    }
    graph.set(composite.id, composite)
    const path = graph.get(root.pathId)
    if (path?.type !== 'path') throw new Error('Missing root path')
    path.compositeSolidId = composite.id
    const result = getVariableExprsFromSelection(
      {
        graphSelections: [{ artifact: root, codeRef: root.codeRef }],
        otherSelections: [],
      },
      graph,
      ast,
      wasmInstance,
      undefined,
      { lastChildLookup: true, artifactTypeFilter: ['sweep', 'compositeSolid'] }
    )
    if (result instanceof Error) throw result

    expect(result.exprs).toEqual([
      createMemberExpression('parts', createLiteral(1, wasmInstance), true),
    ])
  })

  it('preserves pipe substitution when editing the selected output variable', () => {
    const { ast, graph, root, ref } = createMergedBodyGraph()
    const nodeToEdit = ref('extrude002').pathToNode.slice(0, 2)
    const result = getVariableExprsFromSelection(
      {
        graphSelections: [{ artifact: root, codeRef: root.codeRef }],
        otherSelections: [],
      },
      graph,
      ast,
      wasmInstance,
      nodeToEdit,
      { lastChildLookup: true, artifactTypeFilter: ['sweep', 'compositeSolid'] }
    )
    if (result instanceof Error) throw result

    expect(result.exprs).toEqual([createPipeSubstitution()])
    expect(result.pathIfPipe).toEqual(nodeToEdit)
  })
})
