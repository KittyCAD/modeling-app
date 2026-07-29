import { join } from 'path'

import { createLiteral } from '@src/lang/create'
import { addTranslate } from '@src/lang/modifyAst/transforms'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { assertParse, recast } from '@src/lang/wasm'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { createSelectionFromArtifacts } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { expect, it } from 'vitest'

const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

it('adds a standalone translate call on helix selection', async () => {
  const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
  const code = `helix001 = helix(
  axis = Z,
  radius = 5,
  length = 10,
  revolutions = 5,
  angleStart = 0,
)`
  const ast = assertParse(code, instance)
  const sourceRange: [number, number, number] = [0, code.length, 0]
  const helix: Artifact = {
    type: 'helix',
    id: 'helix-id',
    axisId: null,
    codeRef: {
      range: sourceRange,
      pathToNode: getNodePathFromSourceRange(ast, sourceRange),
      nodePath: { steps: [] },
    },
    trajectorySweepId: null,
    consumed: false,
  }
  const artifactGraph: ArtifactGraph = new Map([[helix.id, helix]])
  const result = addTranslate({
    ast,
    artifactGraph,
    objects: createSelectionFromArtifacts([helix], artifactGraph),
    x: {
      valueAst: createLiteral(20, instance),
      valueText: '20',
      valueCalculated: '20',
    },
    wasmInstance: instance,
  })
  if (err(result)) throw result

  expect(recast(result.modifiedAst, instance)).toContain(
    `${code}\ntranslate(helix001, x = 20)`
  )
})
