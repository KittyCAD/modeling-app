import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  createSelectionFromArtifacts,
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import type RustContext from '@src/lib/rustContext'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'
import type { KclManager } from '@src/lang/KclManager'
import { artifactToEntityRef } from '@src/lang/queryAst'
import { addFlipSurface, addJoinSurfaces } from '@src/lang/modifyAst/surfaces'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('surfaces', () => {
  describe('Testing addFlipSurface', () => {
    it('should add a simple flipSurface call on surface selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1, bodyType = SURFACE)`
      const expectedNewLine = `surface001 = flipSurface(extrude001)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifact = [...artifactGraph.values()].find(
        (n) => n.type === 'path'
      )
      const surface: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef(artifact!.type, artifact!.id),
            codeRef: artifact!.codeRef,
          },
        ],
        otherSelections: [],
      }

      const result = addFlipSurface({
        ast,
        artifactGraph,
        surface,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should resolve selected joinSurfaces result instead of a child blend surface', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 5.2mm, var 0mm], end = [var 7.61mm, var 0mm])
  line2 = line(start = [var 7.61mm, var 0mm], end = [var 7.61mm, var 2.28mm])
  line3 = line(start = [var 7.61mm, var 2.28mm], end = [var 5.2mm, var 2.28mm])
  line4 = line(start = [var 5.2mm, var 2.28mm], end = [var 5.2mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  horizontal([line1.start, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [6.405mm, 0.0025mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = YZ) {
  line1 = line(start = [var 0.24mm, var 7.22mm], end = [var 2.22mm, var 7.22mm])
  line2 = line(start = [var 2.22mm, var 7.22mm], end = [var 2.22mm, var 9mm])
  line3 = line(start = [var 2.22mm, var 9mm], end = [var 0.24mm, var 9mm])
  line4 = line(start = [var 0.24mm, var 9mm], end = [var 0.24mm, var 7.22mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden002 = hide(sketch002)
region002 = region(point = [1.23mm, 7.2225mm], sketch = sketch002)
extrude002 = extrude(region002, length = -5, bodyType = SURFACE)
blend001 = blend([
  getBoundedEdge(extrude002, edge = region002.tags.line1),
  getBoundedEdge(extrude001, edge = getOppositeEdge(region001.tags.line2))
])
blend002 = blend([
  getBoundedEdge(extrude002, edge = region002.tags.line2),
  getBoundedEdge(extrude001, edge = getOppositeEdge(region001.tags.line1))
])
surface001 = joinSurfaces([blend001, blend002])`
      const expectedNewLine = `surface002 = flipSurface(surface001)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const selectedSurface = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'compositeSolid'
      )
      if (!selectedSurface) {
        throw new Error('compositeSolid artifact not found in graph')
      }

      const surface = createSelectionFromArtifacts(
        [selectedSurface],
        artifactGraph
      )
      const result = addFlipSurface({
        ast,
        artifactGraph,
        surface,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addJoinSurfaces', () => {
    it('should add a simple join call on body selections', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [-0.2, 0], radius = 0.1)
profile002 = circle(sketch001, center = [0.2, 0], radius = 0.1)
extrude001 = extrude(profile001, length = 1, bodyType = SURFACE)
extrude002 = extrude(profile002, length = 1, bodyType = SURFACE)`
      const expectedNewLine = `surface001 = joinSurfaces([extrude001, extrude002])`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const pathArtifacts = [...artifactGraph.values()].filter(
        (n) => n.type === 'path'
      )
      const selection = createSelectionFromPathArtifact(
        pathArtifacts,
        artifactGraph
      )
      const result = addJoinSurfaces({
        ast,
        artifactGraph,
        selection,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })
})
