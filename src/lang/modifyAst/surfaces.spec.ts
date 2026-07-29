import type { KclManager } from '@src/lang/KclManager'
import { addFlipSurface, addJoinSurfaces } from '@src/lang/modifyAst/surfaces'
import { type Artifact, recast } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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
            artifact: artifact,
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
      const selection = createSelectionFromPathArtifact(pathArtifacts)
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

    it('should join selected blend sweep surfaces directly', async () => {
      const code = `beamLeftRotationAngle = 20deg
beamRightTranslationX = -22
beamRightTranslationY = 134

beamLeftChannelDepth = 35
beamLeftProfileWidth = 113
beamLeftFlange = 23
beamLeftChannelWidth = 55
beamLeftLength = 100

beamRightChannelDepth = 54
beamRightProfileWidth = 110
beamRightFlange = 25
beamRightChannelWidth = 49
beamRightLength = 300

beamLeftWallProfileSketch = sketch(on = XZ) {
  line1 = line(start = [var -0.49mm, var 56.62mm], end = [var -0.51mm, var 33.5mm])
  line2 = line(start = [var 0mm, var 32.66mm], end = [var 34.51mm, var 27.62mm])
  line3 = line(start = [var 34.51mm, var 27.62mm], end = [var 35.31mm, var -28.31mm])
  line4 = line(start = [var 36.86mm, var -30.1mm], end = [var 0.68mm, var -33.39mm])
  line5 = line(start = [var 0mm, var -32.24mm], end = [var -0.49mm, var -56.38mm])
  verticalDistance([line5.end, line1.start]) == beamLeftProfileWidth
  verticalDistance([ORIGIN, line1.start]) == beamLeftProfileWidth / 2
  horizontalDistance([line2.start, line2.end]) == beamLeftChannelDepth
  verticalDistance([line3.end, line3.start]) == beamLeftChannelWidth
  verticalDistance([line5.end, line5.start]) == beamLeftFlange
  coincident([line2.start, line1.end])
  coincident([line3.start, line2.end])
  coincident([line4.start, line3.end])
  coincident([line4.end, line5.start])
  equalLength([line5, line1])
  equalLength([line4, line2])
  vertical(line5)
  vertical(line1)
  vertical([line5.start, ORIGIN])
  vertical([line2.start, ORIGIN])
  vertical(line3)
}

beamRightWallProfileSketch = sketch(on = XZ) {
  line1 = line(start = [var -0.49mm, var 56.62mm], end = [var -0.51mm, var 33.5mm])
  line2 = line(start = [var 0mm, var 32.66mm], end = [var 34.51mm, var 27.62mm])
  line3 = line(start = [var 34.51mm, var 27.62mm], end = [var 35.31mm, var -28.31mm])
  line4 = line(start = [var 36.86mm, var -30.1mm], end = [var 0.68mm, var -33.39mm])
  line5 = line(start = [var 0mm, var -32.24mm], end = [var -0.49mm, var -56.38mm])
  verticalDistance([line5.end, line1.start]) == beamRightProfileWidth
  verticalDistance([ORIGIN, line1.start]) == beamRightProfileWidth / 2
  horizontalDistance([line2.start, line2.end]) == beamRightChannelDepth
  verticalDistance([line3.end, line3.start]) == beamRightChannelWidth
  verticalDistance([line5.end, line5.start]) == beamRightFlange
  coincident([line2.start, line1.end])
  coincident([line3.start, line2.end])
  coincident([line4.start, line3.end])
  coincident([line4.end, line5.start])
  equalLength([line5, line1])
  equalLength([line4, line2])
  vertical(line5)
  vertical(line1)
  vertical([line5.start, ORIGIN])
  vertical([line2.start, ORIGIN])
  vertical(line3)
}

beamLeftWallBaseSurface = extrude(
  [
    beamLeftWallProfileSketch.line1,
    beamLeftWallProfileSketch.line2,
    beamLeftWallProfileSketch.line3,
    beamLeftWallProfileSketch.line4,
    beamLeftWallProfileSketch.line5
  ],
  length = beamLeftLength,
  bodyType = SURFACE,
)
hide(beamLeftWallProfileSketch)
beamLeftWallPlacedSurface = rotate(
  beamLeftWallBaseSurface,
  axis = Z,
  angle = beamLeftRotationAngle,
  global = true,
)

beamRightWallBaseSurface = extrude(
  [
    beamRightWallProfileSketch.line1,
    beamRightWallProfileSketch.line2,
    beamRightWallProfileSketch.line3,
    beamRightWallProfileSketch.line4,
    beamRightWallProfileSketch.line5
  ],
  length = -beamRightLength,
  bodyType = SURFACE,
)
hide(beamRightWallProfileSketch)
beamRightWallPlacedSurface = translate(
  beamRightWallBaseSurface,
  x = beamRightTranslationX,
  y = beamRightTranslationY,
  global = true,
)

blend001 = blend([
  getBoundedEdge(beamLeftWallBaseSurface, edge = beamLeftWallBaseSurface.sketch.tags.line1),
  getBoundedEdge(beamRightWallBaseSurface, edge = beamRightWallBaseSurface.sketch.tags.line1)
])
blend002 = blend([
  getBoundedEdge(beamLeftWallBaseSurface, edge = beamLeftWallBaseSurface.sketch.tags.line2),
  getBoundedEdge(beamRightWallBaseSurface, edge = beamRightWallBaseSurface.sketch.tags.line2)
])
blend003 = blend([
  getBoundedEdge(beamLeftWallBaseSurface, edge = beamLeftWallBaseSurface.sketch.tags.line3),
  getBoundedEdge(beamRightWallBaseSurface, edge = beamRightWallBaseSurface.sketch.tags.line3)
])
blend004 = blend([
  getBoundedEdge(beamLeftWallBaseSurface, edge = beamLeftWallBaseSurface.sketch.tags.line4),
  getBoundedEdge(beamRightWallBaseSurface, edge = beamRightWallBaseSurface.sketch.tags.line4)
])
blend005 = blend([
  getBoundedEdge(beamLeftWallBaseSurface, edge = beamLeftWallBaseSurface.sketch.tags.line5),
  getBoundedEdge(beamRightWallBaseSurface, edge = beamRightWallBaseSurface.sketch.tags.line5)
])`
      const expectedNewLine = `surface001 = joinSurfaces([
  blend001,
  blend002,
  blend003,
  blend004,
  blend005
])`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )

      const blendArtifacts = [...artifactGraph.values()]
        .filter(
          (artifact): artifact is Extract<Artifact, { type: 'sweep' }> =>
            artifact.type === 'sweep' && artifact.subType === 'blend'
        )
        .sort((a, b) => a.codeRef.range[0] - b.codeRef.range[0])
      expect(blendArtifacts).toHaveLength(5)

      const selection = createSelectionFromArtifacts(
        blendArtifacts,
        artifactGraph
      )
      const result = addJoinSurfaces({
        ast,
        artifactGraph,
        selection,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })
})
