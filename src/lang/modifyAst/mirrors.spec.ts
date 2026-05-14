import { addMirror3D } from '@src/lang/modifyAst/mirrors'
import { getNodeFromPath } from '@src/lang/queryAst'
import { assertParse, recast } from '@src/lang/wasm'
import type { Artifact, VariableDeclaration } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  NonCodeSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType | undefined
let engineCommandManagerInThisFile: ConnectionManager | undefined
let rustContextInThisFile: RustContext | undefined

beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile?.tearDown()
})

function getTestWorld() {
  if (!instanceInThisFile || !rustContextInThisFile) {
    throw new Error('Test world not initialized')
  }

  return {
    instance: instanceInThisFile,
    rustContext: rustContextInThisFile,
  }
}

async function getBodiesAndAcross({
  code,
  bodyIds,
  acrossId,
  acrossType,
  bodyType = 'path',
}: {
  code: string
  bodyIds: number[]
  acrossId: number
  acrossType: 'plane' | 'segment' | 'wall'
  bodyType?: 'path' | 'sweep'
}) {
  const { instance, rustContext } = getTestWorld()
  const ast = assertParse(code, instance)
  const { artifactGraph, variables } = await enginelessExecutor(
    ast,
    rustContext
  )
  const bodyArtifacts = artifactGraph
    .values()
    .filter((artifact) => artifact.type === bodyType)
    .toArray()
  const acrossArtifacts = artifactGraph
    .values()
    .filter((artifact) => artifact.type === acrossType)
    .filter((artifact) => {
      if (artifact.type !== 'plane') {
        return true
      }

      const variable = getNodeFromPath<VariableDeclaration>(
        ast,
        artifact.codeRef.pathToNode,
        instance,
        'VariableDeclaration'
      )
      return (
        !err(variable) &&
        variable.node.declaration?.init?.type === 'CallExpressionKw' &&
        variable.node.declaration.init.callee.name.name === 'offsetPlane'
      )
    })
    .toArray()

  const bodies: Selections = {
    graphSelections: bodyIds.map((id) => {
      const artifact = bodyArtifacts[id]
      if (!artifact || !('codeRef' in artifact)) {
        throw new Error('Body artifact not found')
      }

      return {
        artifact,
        codeRef: artifact.codeRef,
      }
    }),
    otherSelections: [],
  }
  const across = createSelectionFromArtifacts(
    [acrossArtifacts[acrossId]],
    artifactGraph
  )

  return { ast, artifactGraph, variables, bodies, across }
}

describe('mirror', () => {
  describe('Testing addMirror', () => {
    async function runAddMirrorTest({
      code,
      bodyIds,
      acrossId = 0,
      acrossType = 'plane',
      bodyType,
    }: {
      code: string
      bodyIds: number[]
      acrossId?: number
      acrossType?: 'plane' | 'segment' | 'wall'
      bodyType?: 'path' | 'sweep'
    }) {
      const { ast, artifactGraph, variables, bodies, across } =
        await getBodiesAndAcross({
          code,
          bodyIds,
          acrossId,
          acrossType,
          bodyType,
        })
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies,
        across,
        wasmInstance: getTestWorld().instance,
      })
      if (err(result)) {
        throw result
      }

      const { instance, rustContext } = getTestWorld()
      await enginelessExecutor(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone mirror3d call on standalone sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(YZ, offset = 1)`
      const expectedNewLine =
        'solid001 = mirror3d(extrude001, across = plane001)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })

    it('should push a mirror3d call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0.2, 0.2], radius = 0.1)
  |> extrude(length = 1)
plane001 = offsetPlane(YZ, offset = 1)`
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
      })

      expect(newCode).toContain(`startSketchOn(XY)
  |> circle(center = [0.2, 0.2], radius = 0.1)
  |> extrude(length = 1)
  |> mirror3d(across = plane001)
plane001 = offsetPlane(YZ, offset = 1)`)
    })

    it('should support multi-solid selection for mirror3d', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 1)
extrude002 = extrude(profile002, length = 1)
plane002 = offsetPlane(YZ, offset = 1)`
      const expectedNewLine =
        'solid001 = mirror3d([extrude001, extrude002], across = plane002)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0, 1],
        acrossId: 1,
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })

    it('should support a default plane as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)`
      const { instance, rustContext } = getTestWorld()
      const ast = assertParse(code, instance)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContext
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [],
          otherSelections: [{ name: 'YZ', id: 'default-yz' }],
        },
        wasmInstance: instance,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(
        `${code}\nsolid001 = mirror3d(extrude001, across = YZ)`
      )
    })

    it('should support a body face as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`
      const { instance, rustContext } = getTestWorld()
      const ast = assertParse(code, instance)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContext
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const capArtifact: Artifact = {
        type: 'cap',
        id: 'cap-end-test',
        subType: 'end',
        sweepId: bodyArtifact.id,
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: bodyArtifact.codeRef,
        cmdId: '',
      }
      artifactGraph.set(capArtifact.id, capArtifact)
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [
            {
              artifact: capArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        wasmInstance: instance,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(
        `plane001 = planeOf(extrude001, face = capEnd001)
solid001 = mirror3d(extrude001, across = plane001)`
      )
    })

    it('should support an engine primitive face as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0deg, length = 30, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 30)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 30)
shell001 = shell(extrude001, faces = rectangleSegmentA001, thickness = 1)`
      const { instance, rustContext } = getTestWorld()
      const ast = assertParse(code, instance)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContext
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const primitiveFace: NonCodeSelection = {
        entityId: 'irrelevant-for-this-test',
        parentEntityId: bodyArtifact.id,
        primitiveIndex: 6,
        primitiveType: 'face',
        type: 'enginePrimitive',
      }
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [],
          otherSelections: [primitiveFace],
        },
        wasmInstance: instance,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(`${code}
face001 = faceId(extrude001, index = 6)
plane001 = planeOf(extrude001, face = face001)
solid001 = mirror3d(extrude001, across = plane001)`)
    })

    it('should support a sketch segment as the mirror reference', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -1mm, var -1mm], end = [var 1mm, var -1mm])
  line2 = line(start = [var 1mm, var -1mm], end = [var 1mm, var 1mm])
  line3 = line(start = [var 1mm, var 1mm], end = [var -1mm, var 1mm])
  line4 = line(start = [var -1mm, var 1mm], end = [var -1mm, var -1mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  line5 = line(start = [var 0mm, var -2mm], end = [var 0mm, var 2mm])
}
region001 = region(point = [0mm, 0mm], sketch = sketch001)
extrude001 = extrude(region001, length = 1)`
      const expectedNewLine =
        'solid001 = mirror3d(extrude001, across = sketch001.line5)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
        acrossId: 4,
        acrossType: 'segment',
        bodyType: 'sweep',
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })
  })
})
