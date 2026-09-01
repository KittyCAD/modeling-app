import { addDeleteFace } from '@src/lang/modifyAst/faces'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  type Artifact,
  assertParse,
  recast,
  type SourceRange,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { NonCodeSelection } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, test } from 'vitest'

test('adds faceId and deleteFace calls for an imported BREP face', async () => {
  const { instance } = await buildTheWorldAndNoEngineConnection()
  const code = 'import "part.step" as importedPart\n'
  const ast = assertParse(code, instance)
  const range = [0, code.trimEnd().length, 0] as SourceRange
  const codeRef = {
    range,
    pathToNode: getNodePathFromSourceRange(ast, range),
  }
  const importedGeometry = {
    type: 'importedGeometry',
    id: 'imported-body',
    codeRef,
  } as Artifact
  const artifactGraph = new Map<string, Artifact>([
    [importedGeometry.id, importedGeometry],
  ])
  const primitiveFace: NonCodeSelection = {
    type: 'enginePrimitive',
    entityId: 'imported-face',
    parentEntityId: 'imported-engine-body',
    kclBodyId: importedGeometry.id,
    primitiveIndex: 4,
    primitiveType: 'face',
  }

  const result = addDeleteFace({
    ast,
    artifactGraph,
    faces: {
      graphSelections: [],
      otherSelections: [primitiveFace],
    },
    wasmInstance: instance,
  })
  if (err(result)) {
    throw result
  }

  const newCode = recast(result.modifiedAst, instance)
  expect(newCode).toContain(`${code}face001 = faceId(importedPart, index = 4)
surface001 = deleteFace(importedPart, faces = face001)`)
})
