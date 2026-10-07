import { createLiteral } from '@src/lang/create'
import { addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import { addStraightnessGdt } from '@src/lang/modifyAst/gdt'
import { artifactToEntityRef } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  type Artifact,
  type ArtifactGraph,
  type CodeRef,
  type SourceRange,
  assertParse,
  defaultNodePath,
  recast,
} from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { loadWasm } from '@src/unitTestUtils'
import { beforeAll, expect, it } from 'vitest'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadWasm()
})

const edgeCall = 'edgeId(body001, index = 4)'
const cases = [
  {
    label: 'fillet on a named edge',
    command: 'fillet',
    source: `edge001 = ${edgeCall}`,
    expected: 'edge001',
    selectionSource: 'artifact',
  },
  {
    label: 'chamfer on an edge selected by entity reference',
    command: 'chamfer',
    source: `edge001 = ${edgeCall}`,
    expected: 'edge001',
    selectionSource: 'entityRef',
  },
  {
    label: 'GD&T reuses a named edge selected by entity reference',
    command: 'straightness',
    source: `edge001 = ${edgeCall}`,
    expected: 'edge001',
    selectionSource: 'entityRef',
  },
  {
    label: 'fillet on an inline edge in a named annotation selected by code',
    command: 'fillet',
    source: `annotation001 = gdt::straightness(edges = [${edgeCall}], tolerance = 0.1mm)`,
    expected: edgeCall,
    selectionSource: 'codeRef',
  },
  {
    label: 'GD&T on an inline annotation edge',
    command: 'straightness',
    source: `gdt::straightness(edges = [${edgeCall}], tolerance = 0.1mm)`,
    expected: edgeCall,
    selectionSource: 'artifact',
  },
  {
    label: 'GD&T on an inline array edge selected by code',
    command: 'straightness',
    source: `edges001 = [${edgeCall}]`,
    expected: edgeCall,
    selectionSource: 'codeRef',
  },
  {
    label: 'fillet groups two edges on the same module-qualified body',
    command: 'fillet',
    source: `edge001 = edgeId(parts::body, index = 4)
edge002 = edgeId(parts::body, index = 5)`,
    expected: '[edge001, edge002]',
    indices: [4, 5],
    selectionSource: 'artifact',
    body: 'parts::body',
  },
] as const

it.each(cases)('$label', (testCase) => {
  const { source, command, expected, selectionSource } = testCase
  const body = 'body' in testCase ? testCase.body : 'body001'
  const indices = 'indices' in testCase ? testCase.indices : [4]
  const code = `@settings(kclVersion = 3.0)
import "part.step" as importedPart
body001 = bodyOf(importedPart, path = [0])
${source}
`
  const ast = assertParse(code, wasmInstance)
  const codeRefFor = (text: string): CodeRef => {
    const start = code.indexOf(text)
    const range: SourceRange = [start, start + text.length, 0]
    return {
      range,
      nodePath: defaultNodePath(),
      pathToNode: getNodePathFromSourceRange(ast, range),
    }
  }
  const bodyArtifact: Artifact = {
    type: 'importedGeometry',
    id: 'body',
    consumed: false,
    codeRef: codeRefFor('bodyOf(importedPart, path = [0])'),
  }
  const edges = indices.map((index) => ({
    type: 'primitiveEdge' as const,
    id: `edge-${index}`,
    solidId: bodyArtifact.id,
    codeRef: codeRefFor(`edgeId(${body}, index = ${index})`),
  }))
  const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
    [bodyArtifact.id, bodyArtifact],
    ...edges.map((edge) => [edge.id, edge] as const),
  ])
  const selection = {
    graphSelections: edges.map((edge) =>
      selectionSource === 'entityRef'
        ? { entityRef: artifactToEntityRef(edge.type, edge.id) }
        : {
            ...(selectionSource === 'artifact' ? { artifact: edge } : {}),
            codeRef: edge.codeRef,
          }
    ),
    otherSelections: [],
  }
  const size = {
    valueAst: createLiteral(0.2, wasmInstance),
    valueText: '0.2',
    valueCalculated: '0.2',
  }
  const args = { ast, artifactGraph, wasmInstance }
  const result =
    command === 'fillet'
      ? addFillet({ ...args, selection, radius: size })
      : command === 'chamfer'
        ? addChamfer({ ...args, selection, length: size })
        : addStraightnessGdt({ ...args, objects: selection, tolerance: size })
  if (isErr(result)) throw result

  const addedCall =
    command === 'straightness'
      ? `gdt::straightness(edges = [${expected}], tolerance = 0.2)`
      : `${command}001 = ${command}(${body}, tags = ${expected}, ${command === 'fillet' ? 'radius' : 'length'} = 0.2)`
  expect(recast(result.modifiedAst, wasmInstance)).toEqual(
    recast(assertParse(`${code}${addedCall}`, wasmInstance), wasmInstance)
  )
  expect(recast(ast, wasmInstance)).toEqual(
    recast(assertParse(code, wasmInstance), wasmInstance)
  )
})
