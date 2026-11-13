import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact, ArtifactGraph, CodeRef } from '@src/lang/wasm'
import {
  buildBodyOperationTree,
  type BodyArtifact,
} from '@src/lib/featureTree/featureTreeBodyTree'
import { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'
import { describe, expect, it } from 'vitest'

function codeRef(start: number, moduleId = 0): CodeRef {
  return {
    range: [start, start + 10, moduleId],
    nodePath: { steps: [] },
    pathToNode: [],
  }
}

function call(
  start: number,
  bodyId?: string
): Extract<Operation, { type: 'StdLibCall' }> {
  return {
    type: 'StdLibCall',
    name: bodyId ? 'fillet' : 'extrude',
    sourceRange: codeRef(start).range,
    nodePath: { steps: [] },
    labeledArgs: {},
    unlabeledArg: bodyId
      ? {
          value: { type: 'Solid', value: { artifactId: bodyId } },
          sourceRange: codeRef(start).range,
        }
      : null,
  }
}

function sweep(
  id: string,
  start: number,
  pathId?: string
): Extract<BodyArtifact, { type: 'sweep' }> {
  return {
    type: 'sweep',
    id,
    subType: 'extrusion',
    pathId,
    surfaceIds: [],
    edgeIds: [],
    codeRef: codeRef(start),
    trajectoryId: null,
    method: 'new',
    consumed: false,
  }
}

function graph(...artifacts: Artifact[]): ArtifactGraph {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

function bodies(...artifacts: BodyArtifact[]) {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

describe('body feature hierarchy', () => {
  it('does not include later edits to the source in a clone history', () => {
    const a = sweep('a', 10)
    const copy: BodyArtifact = { ...sweep('copy', 30), sourceSweepId: 'a' }
    const nodes = [
      call(10),
      call(20, 'a'),
      call(30),
      call(40, 'a'),
      call(50, 'copy'),
    ]
    const tree = buildBodyOperationTree(nodes, bodies(a, copy), graph(a, copy))
    expect(tree.branches[0].operations).toEqual([nodes[0], nodes[1], nodes[3]])
    expect(tree.branches[1].operations).toEqual([
      nodes[0],
      nodes[1],
      nodes[2],
      nodes[4],
    ])
  })

  it('puts each body creation and its edits below that body, in execution order', () => {
    const a = sweep('a', 10)
    const b = sweep('b', 20)
    const nodes = [call(10), call(20), call(30, 'a')]
    const tree = buildBodyOperationTree(nodes, bodies(a, b), graph(a, b))
    expect(tree.operations).toEqual([])
    expect(tree.branches.map((branch) => branch.operations)).toEqual([
      [nodes[0], nodes[2]],
      [nodes[1]],
    ])
  })

  it('keeps parameters and unresolved features at the root without dropping them', () => {
    const a = sweep('a', 10)
    const nodes = [call(0), call(10), call(20)]
    expect(
      buildBodyOperationTree(nodes, bodies(a), graph(a)).operations
    ).toEqual([nodes[0], nodes[2]])
    expect(
      buildBodyOperationTree(nodes, new Map(), graph()).operations
    ).toEqual(nodes)
  })

  it('keeps a shared sketch accessible from both bodies without pulling in the other extrusion', () => {
    const a = sweep('a', 20, 'path')
    const b = sweep('b', 30, 'path')
    const path: Artifact = {
      type: 'path',
      id: 'path',
      subType: 'sketch',
      planeId: 'xy',
      segIds: [],
      consumed: false,
      trajectorySweepId: null,
      sweepId: 'b',
      codeRef: codeRef(10),
    }
    const nodes = [call(10), call(20), call(30)]
    const tree = buildBodyOperationTree(nodes, bodies(a, b), graph(a, b, path))
    expect(tree.branches.map((branch) => branch.operations)).toEqual([
      [nodes[0], nodes[1]],
      [nodes[0], nodes[2]],
    ])
  })

  it('includes consumed input histories under a Boolean result', () => {
    const a = sweep('a', 10)
    const b = sweep('b', 20)
    const result: BodyArtifact = {
      type: 'compositeSolid',
      id: 'result',
      subType: 'subtract',
      consumed: false,
      solidIds: ['a'],
      toolIds: ['b'],
      codeRef: codeRef(40),
    }
    const nodes = [call(10), call(20), call(30, 'a'), call(40)]
    const tree = buildBodyOperationTree(
      nodes,
      bodies(result),
      graph({ ...a, consumed: true }, { ...b, consumed: true }, result)
    )
    expect(tree.branches).toHaveLength(1)
    expect(tree.branches[0].operations).toEqual(nodes)
  })

  it('keeps pattern copies and their edits in the source body history', () => {
    const a = sweep('a', 10, 'path')
    const pattern: BodyArtifact = {
      type: 'pattern',
      id: 'pattern',
      sourceId: 'a',
      copyIds: ['copy1', 'copy2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      subType: 'linear',
      codeRef: codeRef(20),
    }
    const nodes = [call(10), call(20), call(30, 'copy1')]
    const tree = buildBodyOperationTree(
      nodes,
      new Map([
        ['a', pattern],
        ['copy1', pattern],
        ['copy2', pattern],
      ]),
      graph(a, pattern)
    )
    expect(tree.branches.map((branch) => branch.id)).toEqual(['a'])
    expect(tree.branches[0].artifact).toBe(a)
    expect(tree.branches[0].operations).toEqual(nodes)
    expect(tree.operations).toEqual([])
  })

  it('groups nested 3D patterns without combining unrelated source bodies', () => {
    const a = { ...sweep('a', 10, 'path'), patternIds: ['first'] }
    const b = sweep('b', 40)
    const path: Artifact = {
      type: 'path',
      id: 'path',
      subType: 'sketch',
      planeId: 'xy',
      segIds: [],
      consumed: false,
      trajectorySweepId: null,
      codeRef: codeRef(0),
    }
    const first: Extract<BodyArtifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'first',
      sourceId: 'path',
      copyIds: ['copy1'],
      copyFaceIds: [],
      copyEdgeIds: [],
      subType: 'linear',
      codeRef: codeRef(20),
    }
    const second: Extract<BodyArtifact, { type: 'pattern' }> = {
      ...first,
      id: 'second',
      sourceId: 'copy1',
      copyIds: ['copy2'],
      subType: 'circular',
      codeRef: codeRef(30),
    }
    const nodes = [call(10), call(20), call(30), call(40)]
    const tree = buildBodyOperationTree(
      nodes,
      new Map<string, BodyArtifact>([
        ['a', first],
        ['copy1', first],
        ['copy2', second],
        ['b', b],
      ]),
      graph(a, b, path, first, second)
    )
    expect(tree.branches.map((branch) => branch.id)).toEqual(['a', 'b'])
    expect(tree.branches[0].operations).toEqual(nodes.slice(0, 3))
    expect(tree.branches[1].operations).toEqual([nodes[3]])
  })

  it('places imported bodies inside their part with unrelated module features alongside them', () => {
    const a = { ...sweep('a', 10), codeRef: codeRef(10, 1) }
    const feature: Operation = {
      ...call(10),
      sourceRange: codeRef(10, 1).range,
    }
    const other: Operation = { ...call(20), sourceRange: codeRef(20, 1).range }
    const parent: Extract<Operation, { type: 'ModuleInstance' }> = {
      type: 'ModuleInstance',
      name: 'part',
      moduleId: 1,
      sourceRange: [0, 10, 0],
      nodePath: { steps: [] },
    }
    const tree = buildBodyOperationTree(
      [{ parent, children: [feature, other] }],
      bodies(a),
      graph(a)
    )
    expect(tree.branches[0].operations).toEqual([
      { parent, children: [feature] },
    ])
    expect(tree.operations).toEqual([{ parent, children: [other] }])
    expect(tree.nodes).toEqual([
      {
        parent,
        children: [other, { body: tree.branches[0], children: [feature] }],
      },
    ])
  })

  it('keeps assembly bodies at the root and places part bodies under the matching imports', () => {
    const parts = ['fanHousing', 'motor', 'fan'].map((name, index) => {
      const parent: Extract<Operation, { type: 'ModuleInstance' }> = {
        type: 'ModuleInstance',
        name,
        moduleId: index + 1,
        sourceRange: codeRef(index * 10).range,
        nodePath: { steps: [] },
      }
      return {
        parent,
        children: [{ ...call(10), sourceRange: codeRef(10, index + 1).range }],
      }
    })
    const partBodies = parts.map(({ parent }, index) => ({
      ...sweep(parent.name, 10),
      codeRef: codeRef(10, index + 1),
    }))
    const local = sweep('assemblyBody', 100)
    const assemblyEdit = call(50, 'fan')
    const tree = buildBodyOperationTree(
      [...parts, assemblyEdit, call(100)],
      bodies(...partBodies, local),
      graph(...partBodies, local)
    )
    expect(tree.nodes).toHaveLength(4)
    for (let index = 0; index < parts.length; index++) {
      expect(tree.nodes[index]).toEqual({
        parent: parts[index].parent,
        children: [
          {
            body: tree.branches[index],
            children:
              index === 2
                ? [...parts[index].children, assemblyEdit]
                : parts[index].children,
          },
        ],
      })
    }
    expect(tree.nodes[3]).toEqual({
      body: tree.branches[3],
      children: [call(100)],
    })
  })

  it('owns imported bodies by the import statement when KCL remaps their code references', () => {
    const names = ['fanHousing', 'motor', 'fan']
    const parts = names.map((name, index) => {
      const parent: Extract<Operation, { type: 'ModuleInstance' }> = {
        type: 'ModuleInstance',
        name,
        moduleId: index + 1,
        sourceRange: codeRef(index * 20).range,
        nodePath: { steps: [] },
      }
      const appearance = {
        ...call(100, name),
        name: 'appearance',
        sourceRange: codeRef(100, index + 1).range,
      }
      return { parent, children: [appearance] }
    })
    // KCL's code_ref_for_range replaces the producing file's range with its
    // import statement range so scene/code selection navigates to main.kcl.
    const importedBodies = names.map((name, index) => ({
      ...sweep(name, 100),
      codeRef: codeRef(index * 20),
    }))
    const operations = buildOperationTree(
      {
        map: {
          0: parts.map((part) => part.parent),
          1: parts[0].children,
          2: parts[1].children,
          3: parts[2].children,
        },
      },
      0
    )
    const tree = buildBodyOperationTree(
      operations,
      bodies(...importedBodies),
      graph(...importedBodies)
    )
    expect(tree.nodes).toHaveLength(3)
    for (let index = 0; index < parts.length; index++) {
      expect(tree.nodes[index]).toEqual({
        parent: parts[index].parent,
        children: [
          { body: tree.branches[index], children: parts[index].children },
        ],
      })
      expect(tree.branches[index].ownerModuleId).toBe(index + 1)
    }
  })

  it('nests bodies at the correct depth in imported subassemblies', () => {
    const outer: Extract<Operation, { type: 'ModuleInstance' }> = {
      type: 'ModuleInstance',
      name: 'subassembly',
      moduleId: 1,
      sourceRange: [0, 10, 0],
      nodePath: { steps: [] },
    }
    const inner: Extract<Operation, { type: 'ModuleInstance' }> = {
      ...outer,
      name: 'part',
      moduleId: 2,
      sourceRange: [0, 10, 1],
    }
    const feature = { ...call(10), sourceRange: codeRef(10, 2).range }
    const body = { ...sweep('partBody', 10), codeRef: codeRef(10, 2) }
    const tree = buildBodyOperationTree(
      [{ parent: outer, children: [{ parent: inner, children: [feature] }] }],
      bodies(body),
      graph(body)
    )
    expect(tree.nodes).toEqual([
      {
        parent: outer,
        children: [
          {
            parent: inner,
            children: [{ body: tree.branches[0], children: [feature] }],
          },
        ],
      },
    ])
  })

  it('keeps sketch groups intact and terminates on cyclic provenance', () => {
    const a = sweep('a', 10, 'path')
    const path: Artifact = {
      type: 'path',
      id: 'path',
      subType: 'sketch',
      planeId: 'xy',
      segIds: [],
      consumed: false,
      trajectorySweepId: null,
      originPathId: 'path',
      codeRef: codeRef(0),
    }
    const group: Operation[] = [
      {
        type: 'GroupBegin',
        group: { type: 'SketchBlock', sketchId: 1 },
        nodePath: { steps: [] },
        sourceRange: [0, 10, 0],
      },
      { type: 'GroupEnd' },
    ]
    const tree = buildBodyOperationTree(
      [group, call(10)],
      bodies(a),
      graph(a, path)
    )
    expect(tree.branches[0].operations[0]).toBe(group)
  })
})
