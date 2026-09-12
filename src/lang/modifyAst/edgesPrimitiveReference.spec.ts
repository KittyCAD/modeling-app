import { createLiteral } from '@src/lang/create'
import { addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import { addStraightnessGdt } from '@src/lang/modifyAst/gdt'
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
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = (await buildTheWorldAndNoEngineConnection()).instance
})

const edgeCall = 'edgeId(body001, index = 4)'
const sources = [
  {
    label: 'standalone reference',
    source: `edge001 = ${edgeCall}`,
    expected: 'edge001',
  },
  {
    label: 'inline annotation argument',
    source: `gdt::straightness(edges = [${edgeCall}], tolerance = 0.1mm)`,
    expected: edgeCall,
  },
  {
    label: 'inline named annotation argument',
    source: `annotation001 = gdt::straightness(edges = [${edgeCall}], tolerance = 0.1mm)`,
    expected: edgeCall,
  },
  {
    label: 'inline array element',
    source: `edges001 = [${edgeCall}]`,
    expected: edgeCall,
  },
]

function setup(source: string) {
  const code = `@settings(kclVersion = 2.0)
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
  const body: Artifact = {
    type: 'importedGeometry',
    id: 'body',
    consumed: false,
    codeRef: codeRefFor('bodyOf(importedPart, path = [0])'),
  }
  const edge: Artifact = {
    type: 'primitiveEdge',
    id: 'edge',
    solidId: body.id,
    codeRef: codeRefFor(edgeCall),
  }
  const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
    [body.id, body],
    [edge.id, edge],
  ])
  return {
    code,
    ast,
    artifactGraph,
    selection: {
      graphSelections: [{ artifact: edge, codeRef: edge.codeRef }],
      otherSelections: [],
    },
    size: {
      valueAst: createLiteral(0.2, wasmInstance),
      valueText: '0.2',
      valueCalculated: '0.2',
    },
  }
}

describe.each(sources)('primitive edge from $label', ({ source, expected }) => {
  it.each(['fillet', 'chamfer'] as const)(
    'adds %s using the selected edge and body',
    (command) => {
      const { ast, code, artifactGraph, selection, size } = setup(source)
      const args = { ast, artifactGraph, selection, wasmInstance }
      const result =
        command === 'fillet'
          ? addFillet({ ...args, radius: size })
          : addChamfer({ ...args, length: size })
      if (isErr(result)) throw result

      const expectedCode = `${code}${command}001 = ${command}(body001, tags = ${expected}, ${command === 'fillet' ? 'radius' : 'length'} = 0.2)`
      expect(recast(result.modifiedAst, wasmInstance)).toEqual(
        recast(assertParse(expectedCode, wasmInstance), wasmInstance)
      )
      expect(recast(ast, wasmInstance)).toEqual(
        recast(assertParse(code, wasmInstance), wasmInstance)
      )
    }
  )

  it('adds GD&T using the selected edge without substituting an enclosing variable', () => {
    const { ast, code, artifactGraph, selection, size } = setup(source)
    const result = addStraightnessGdt({
      ast,
      artifactGraph,
      objects: selection,
      tolerance: size,
      wasmInstance,
    })
    if (isErr(result)) throw result
    expect(recast(result.modifiedAst, wasmInstance)).toEqual(
      recast(
        assertParse(
          `${code}gdt::straightness(edges = [${expected}], tolerance = 0.2)`,
          wasmInstance
        ),
        wasmInstance
      )
    )
  })
})
