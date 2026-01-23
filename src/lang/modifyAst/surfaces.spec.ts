import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import type RustContext from '@src/lib/rustContext'
import type { ConnectionManager } from '@src/network/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'
import type { KclManager } from '@src/lang/KclManager'
import { addFlipSurface } from '@src/lang/modifyAst/surfaces'

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
  })
})
