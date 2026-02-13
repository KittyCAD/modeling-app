import { processMemory } from '@src/components/layout/areas/MemoryPane'
import { assertParse } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
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

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('processMemory', () => {
  it('should grab the values and remove and geo data', async () => {
    // Enable rotations #152
    const code = `
  myVar = 5
  fn myFn(@a) {
    return a - 2
  }
  otherVar = myFn(5)
  nFeet = 2ft
  nInches = 2in
  nMm = 2mm
  nDegrees = 2deg
  nRadians = 2rad
  nCount = 2_
  nUnknown = 1rad * PI

  theExtrude = startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(endAbsolute = [-2.4, myVar])
    |> line(endAbsolute = [-0.76, otherVar])
    |> line(endAbsolute = profileStart())
    |> extrude(length = 4)

  theSketch = startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> line(endAbsolute = [-3.35, 0.17])
    |> line(endAbsolute = [0.98, 5.16])
    |> line(endAbsolute = [2.15, 4.32])
    // |> rx(90)`
    const ast = assertParse(code, instanceInThisFile)
    const execState = await enginelessExecutor(ast, rustContextInThisFile)
    const output = processMemory(execState.variables, instanceInThisFile)
    expect(output.nFeet).toEqual('2: number(ft)')
    expect(output.nInches).toEqual('2: number(in)')
    expect(output.nMm).toEqual('2: number(mm)')
    expect(output.nDegrees).toEqual('2: number(deg)')
    expect(output.nRadians).toEqual('2: number(rad)')
    expect(output.nCount).toEqual('2: number(Count)')
    expect(output.nUnknown).toEqual(
      '3.141592653589793 (number with unknown units)'
    )
    expect(output.myVar).toEqual('5 (no units, defaulting to mm or deg)')
    expect(output.otherVar).toEqual('3 (no units, defaulting to mm or deg)')
    expect(output.myFn).toEqual('__function__')
    expect(output.theExtrude).toEqual([
      {
        type: 'extrudePlane',
        tag: null,
        id: expect.any(String),
        faceId: expect.any(String),
        sourceRange: [expect.any(Number), expect.any(Number), 0],
      },
      {
        type: 'extrudePlane',
        tag: null,
        id: expect.any(String),
        faceId: expect.any(String),
        sourceRange: [expect.any(Number), expect.any(Number), 0],
      },
      {
        type: 'extrudePlane',
        tag: null,
        id: expect.any(String),
        faceId: expect.any(String),
        sourceRange: [expect.any(Number), expect.any(Number), 0],
      },
    ])
    expect(output.theSketch).toEqual([
      {
        type: 'ToPoint',
        to: [-3.35, 0.17],
        from: [0, 0],
        units: 'mm',
        tag: null,
      },
      {
        type: 'ToPoint',
        to: [0.98, 5.16],
        from: [-3.35, 0.17],
        units: 'mm',
        tag: null,
      },
      {
        type: 'ToPoint',
        to: [2.15, 4.32],
        from: [0.98, 5.16],
        units: 'mm',
        tag: null,
      },
    ])
  })
})
