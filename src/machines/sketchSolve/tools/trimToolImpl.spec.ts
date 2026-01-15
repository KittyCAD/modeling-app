import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { assertParse } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { createOnAreaSelectEndCallback } from '@src/machines/sketchSolve/tools/trimToolImpl'
import type { Coords2d } from '@src/lang/util'

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

describe('Split trim - line trimmed between two intersections', () => {
  it('splits line1 into two segments when trimmed between two intersections', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -4mm, var 0mm], end = [var 5mm, var 0mm])
  line2 = sketch2::line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
}
`

    const trimPoints: Coords2d[] = [
      [0, 2],
      [0, -2],
    ]

    const result = await executeTrimFlow({
      kclCode: baseKclCode,
      trimPoints,
      sketchId: 0,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) {
      throw result
    }

    const expectedCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -4mm, var 0mm], end = [var -2mm, var 0mm])
  line2 = sketch2::line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
  line3 = sketch2::line(start = [var 1.98mm, var 0mm], end = [var 5mm, var 0mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line3.start, arc1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
})

describe('Trim line that does not intersect anything', () => {
  it('should be a no-op when trim line does not intersect any segments', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -4mm, var 0mm], end = [var 5mm, var 0mm])
  line2 = sketch2::line(start = [var -2mm, var 4mm], end = [var -2mm, var -4mm])
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 2mm, var -4mm], center = [var 500mm, var 0mm])
}
`

    // Trim line far away from all segments - should not intersect anything
    const trimPoints: Coords2d[] = [
      [10, 10],
      [15, 10],
    ]

    const result = await executeTrimFlow({
      kclCode: baseKclCode,
      trimPoints,
      sketchId: 0,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) {
      throw result
    }

    // Should be unchanged (no-op)
    expect(result.kclSource.text).toBe(baseKclCode)
  })
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

// Removed helper functions - no longer used after migrating getTrimSpawnTerminations tests to Rust

/**
 * Helper function to execute the full trim flow and return the resulting KCL code
 * Now uses createOnAreaSelectEndCallback internally
 */
async function executeTrimFlow({
  kclCode,
  trimPoints,
  sketchId,
}: {
  kclCode: string
  trimPoints: Coords2d[]
  sketchId: number
}): Promise<{ kclSource: { text: string } } | Error> {
  // Parse and execute initial KCL code
  const ast = assertParse(kclCode, instanceInThisFile)
  const { sceneGraph, execOutcome } =
    await rustContextInThisFile.hackSetProgram(
      ast,
      await jsAppSettings(rustContextInThisFile.settingsActor)
    )

  const initialSceneGraphDelta: SceneGraphDelta = {
    new_graph: sceneGraph,
    new_objects: [],
    invalidates_ids: false,
    exec_outcome: execOutcome,
  }

  // Track the last result to return it
  let lastResult: { kclSource: { text: string } } | null = null
  let hadError: Error | null = null

  // Use the new createOnAreaSelectEndCallback function
  const onAreaSelectEndHandler = createOnAreaSelectEndCallback({
    getContextData: () => ({
      sceneGraphDelta: initialSceneGraphDelta,
      sketchId,
      rustContext: rustContextInThisFile,
    }),
    onNewSketchOutcome: (outcome) => {
      lastResult = outcome
    },
  })

  // Execute the trim flow
  try {
    await onAreaSelectEndHandler(trimPoints)
  } catch (error) {
    hadError = error instanceof Error ? error : new Error(String(error))
  }

  // Return error if one occurred
  if (hadError) {
    return hadError
  }

  // If no operations were executed (no-op case), return the original KCL code
  if (!lastResult) {
    return { kclSource: { text: kclCode } }
  }

  return lastResult
}

describe('Multi-segment trim - trim line through multiple segments', () => {
  it(
    'stress test: complex trim line through many segments',
    { timeout: 15_000 },
    async () => {
      const startTime = performance.now()
      const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.17mm, var 4.96mm], end = [var 4.84mm, var 6.49mm])
  line2 = sketch2::line(start = [var 4.84mm, var 6.49mm], end = [var -3.92mm, var 2.05mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -3.92mm, var 2.05mm], end = [var 6.02mm, var 3.98mm])
  sketch2::coincident([line2.end, line3.start])
  line4 = sketch2::line(start = [var 6.02mm, var 3.98mm], end = [var -7.23mm, var -1.81mm])
  sketch2::coincident([line3.end, line4.start])
  line5 = sketch2::line(start = [var -7.23mm, var -1.81mm], end = [var 6.5mm, var -1.47mm])
  sketch2::coincident([line4.end, line5.start])
  line6 = sketch2::line(start = [var 6.5mm, var -1.47mm], end = [var -6.69mm, var -4.73mm])
  sketch2::coincident([line5.end, line6.start])
  line7 = sketch2::line(start = [var -6.69mm, var -4.73mm], end = [var 6.77mm, var -4.86mm])
  sketch2::coincident([line6.end, line7.start])
  line10 = sketch2::line(start = [var -1.08mm, var -10.86mm], end = [var -4.36mm, var 7.64mm])
  line11 = sketch2::line(start = [var -4.36mm, var 7.64mm], end = [var 5.28mm, var -8.62mm])
  sketch2::coincident([line10.end, line11.start])
  line12 = sketch2::line(start = [var 5.28mm, var -8.62mm], end = [var 6.9mm, var 0.39mm])
  sketch2::coincident([line11.end, line12.start])
  line13 = sketch2::line(start = [var 6.9mm, var 0.39mm], end = [var -7.84mm, var 4.45mm])
  sketch2::coincident([line12.end, line13.start])
  line14 = sketch2::line(start = [var -7.84mm, var 4.45mm], end = [var 3.05mm, var 7.98mm])
  sketch2::coincident([line13.end, line14.start])
  line15 = sketch2::line(start = [var 3.05mm, var 7.98mm], end = [var 0.71mm, var -10.01mm])
  sketch2::coincident([line14.end, line15.start])
  line18 = sketch2::line(start = [var 5.24mm, var 2.08mm], end = [var -6.76mm, var 0.49mm])
  line19 = sketch2::line(start = [var -6.76mm, var 0.49mm], end = [var -1.86mm, var 8.22mm])
  sketch2::coincident([line18.end, line19.start])
  line20 = sketch2::line(start = [var -1.86mm, var 8.22mm], end = [var 3.11mm, var -9.16mm])
  sketch2::coincident([line19.end, line20.start])
  line21 = sketch2::line(start = [var 3.11mm, var -9.16mm], end = [var 6.97mm, var 7.91mm])
  sketch2::coincident([line20.end, line21.start])
  line22 = sketch2::line(start = [var -6.96mm, var 3.03mm], end = [var 7mm, var -3.78mm])
  line23 = sketch2::line(start = [var -1.99mm, var -2.39mm], end = [var 4.2mm, var 4.73mm])
  line24 = sketch2::line(start = [var 1.42mm, var 6.72mm], end = [var -4.46mm, var 2.86mm])
  line25 = sketch2::line(start = [var -6.18mm, var -3.61mm], end = [var -0.4mm, var -8.25mm])
  line27 = sketch2::line(start = [var 5.45mm, var 7.3mm], end = [var -7.06mm, var 6.28mm])
  sketch2::arc(start = [var 2.71mm, var -9.71mm], end = [var -3.98mm, var 8.12mm], center = [var -6.86mm, var -3.13mm])
  sketch2::arc(start = [var -2.95mm, var 1.9mm], end = [var 1.73mm, var -6.79mm], center = [var 7.68mm, var 2.02mm])
  sketch2::arc(start = [var -6.149mm, var 5.57mm], end = [var 6.911mm, var 3.169mm], center = [var 1.118mm, var 8.38mm])
  sketch2::arc(start = [var 5.55mm, var 7.909mm], end = [var -7.641mm, var -6.45mm], center = [var 7.51mm, var -7.13mm])
  sketch2::arc(start = [var 3.69mm, var -3.61mm], end = [var -5.68mm, var -5.96mm], center = [var 0.58mm, var -11.06mm])
  sketch2::arc(start = [var -1.311mm, var -0.729mm], end = [var -0.609mm, var -8.789mm], center = [var 3.72mm, var -4.352mm])
  sketch2::arc(start = [var -4.9mm, var 0.12mm], end = [var -5.32mm, var -3.75mm], center = [var -0.74mm, var -2.29mm])
  line8 = sketch2::line(start = [var -6.79mm, var -6.46mm], end = [var -3.45mm, var -6.7mm])
  line9 = sketch2::line(start = [var -4.8mm, var -6.07mm], end = [var -4.59mm, var -6.91mm])
  line16 = sketch2::line(start = [var -7.78mm, var -7.36mm], end = [var -5.25mm, var -7.36mm])
  line17 = sketch2::line(start = [var -5.25mm, var -7.36mm], end = [var -3.69mm, var -7.72mm])
  sketch2::coincident([line16.end, line17.start])
  line26 = sketch2::line(start = [var -3.69mm, var -7.72mm], end = [var -2.49mm, var -7.33mm])
  sketch2::coincident([line17.end, line26.start])
  line28 = sketch2::line(start = [var -5.4mm, var -7.99mm], end = [var -3.75mm, var -8.33mm])
  line29 = sketch2::line(start = [var -4.89mm, var -5.47mm], end = [var -3.84mm, var -6.04mm])
  line30 = sketch2::line(start = [var -7.42mm, var -8.27mm], end = [var -5.55mm, var -8.51mm])
  line31 = sketch2::line(start = [var -5.55mm, var -8.51mm], end = [var -3.45mm, var -8.87mm])
  sketch2::coincident([line30.end, line31.start])
  line32 = sketch2::line(start = [var -7.54mm, var -9.14mm], end = [var -2.91mm, var -9.29mm])
  line33 = sketch2::line(start = [var -2.91mm, var -9.92mm], end = [var -7.33mm, var -8.78mm])
  line34 = sketch2::line(start = [var -5.07mm, var -2.3mm], end = [var -2.79mm, var -3mm])
  line35 = sketch2::line(start = [var -5.04mm, var -3.12mm], end = [var -2.91mm, var -2.48mm])
}
`

      const trimPoints: Coords2d[] = [
        [-0.20484096959875361, 7.75406075078318],
        [0.36613122302493517, 7.723947893498586],
        [0.9371034156486249, 7.723947893498586],
        [1.5080756082723146, 7.723947893498586],
        [2.0790478008960025, 7.723947893498586],
        [2.5598664894212146, 7.4228193206526365],
        [2.5598664894212146, 6.850675032245334],
        [2.0790478008960025, 6.519433602114789],
        [1.5381267763051405, 6.338756458407221],
        [0.9671545836814508, 6.3086436011226255],
        [0.4262335590905869, 6.4592078875456],
        [-0.14473863353310187, 6.368869315691816],
        [-0.7157108261567917, 6.248417886553436],
        [-1.2566318507476546, 6.067740742845867],
        [-1.7975528753385184, 5.917176456422893],
        [-2.188218059765253, 5.495596454438564],
        [-1.8877063794369962, 5.0137907378850475],
        [-1.3167341868133065, 4.953565023315857],
        [-0.7457619941896175, 4.923452166031262],
        [-0.17478980156592777, 4.833113594177478],
        [0.15577304679515594, 4.3513078776239595],
        [0.4262335590905869, 3.839389303785847],
        [0.4562847271234128, 3.267245015378544],
        [0.30602888695928343, 2.725213584255836],
        [-0.024533961401799326, 2.2735207249869136],
        [-0.5955061540254881, 2.122956438563939],
        [-1.136427178616352, 1.9723921521409638],
        [-1.6773482032072158, 1.82182786571799],
        [-2.158166891732427, 2.122956438563939],
        [-2.638985580257639, 2.424085011409887],
        [-3.1799066048485027, 2.6047621551174567],
        [-3.750878797472192, 2.5746492978328623],
        [-4.171595149931753, 2.1530692958485336],
        [-4.502157998292836, 1.6712635792950152],
        [-4.892823182719571, 1.2496835773106867],
        [-4.381953326161533, 1.0087807190339289],
        [-4.351902158128707, 0.4366364306266254],
        [-4.141543981898927, -0.10539500049608215],
        [-3.991288141734798, -0.6474264316187898],
        [-3.8109811335378434, -1.1894578627414973],
        [-3.8109811335378434, -1.7616021511488007],
        [-3.4804182851767607, -2.213295010417723],
        [-3.149855436815677, -2.6649878696866476],
        [-3.2400089409141546, -3.2371321580939485],
        [-3.750878797472192, -3.4780350163707086],
        [-4.26174865403023, -3.7490507319320625],
        [-4.021339309767624, -4.260969305770174],
        [-3.5405206212424116, -4.562097878616124],
        [-3.5405206212424116, -5.134242167023425],
        [-3.991288141734798, -5.495596454438564],
        [-4.111492813866102, -6.037627885561271],
        [-4.0513904778004495, -6.609772173968575],
        [-3.991288141734798, -7.181916462375878],
        [-4.231697485997404, -7.69383503621399],
        [-4.412004494194359, -8.265979324621293],
        [-4.412004494194359, -8.838123613028595],
        [-4.562260334358488, -9.380155044151303],
        [-4.862772014686745, -9.861960760704822],
      ]

      const result = await executeTrimFlow({
        kclCode: baseKclCode,
        trimPoints,
        sketchId: 0,
      })

      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) {
        throw result
      }

      // Just assert that it doesn't error - the output code can be whatever the solver produces
      expect(result.kclSource.text).toBeTruthy()

      const endTime = performance.now()
      const durationMs = endTime - startTime
      const durationSeconds = durationMs / 1000

      console.log(
        `[Stress Test] Execution time: ${durationSeconds.toFixed(2)}s (${durationMs.toFixed(0)}ms)`
      )

      // Assert that the test completes within a reasonable time
      // Note: This test can take 7-9 seconds depending on system load
      expect(durationMs).toBeLessThan(8_500)
    }
  )
})
