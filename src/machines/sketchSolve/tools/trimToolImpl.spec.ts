import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type {
  ApiObject,
  SceneGraph,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { assertParse } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import {
  createOnAreaSelectEndCallback,
  executeTrimStrategy,
  getTrimSpawnTerminations,
} from '@src/machines/sketchSolve/tools/trimToolImpl'
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

describe('Arc-line trim with existing point-segment coincident', () => {
  it('replaces point-segment coincident with point-point when trimming at coincident endpoint', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
  sketch2::coincident([line1.end, arc1])
}
`

    const trimPoints: Coords2d[] = [
      [-2, 2],
      [2, 2],
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
  arc1 = sketch2::arc(start = [var -0.411mm, var -0.17mm], end = [var 0.002mm, var -5mm], center = [var 30mm, var -0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.411mm, var -0.17mm])
  sketch2::coincident([arc1.start, line1.end])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
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
  sketch2::coincident([line1.end, line2])
  line3 = sketch2::line(start = [var 1.98mm, var 0mm], end = [var 5mm, var 0mm])
  sketch2::coincident([line3.start, arc1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

/**
 * Helper function to execute KCL code and get the sceneGraphDelta
 * This ensures test data comes from actual KCL execution rather than manual mocks
 */
async function getSceneGraphDeltaFromKcl(kclCode: string): Promise<SceneGraph> {
  // Parse the KCL code to get AST
  const ast = assertParse(kclCode, instanceInThisFile)

  // Execute the code to get the scene graph
  const { sceneGraph } = await rustContextInThisFile.hackSetProgram(
    ast,
    await jsAppSettings(rustContextInThisFile.settingsActor)
  )
  return sceneGraph
}

function findFirstArcId(objects: ApiObject[]): number {
  for (const obj of objects) {
    if (obj.kind.type === 'Segment' && obj.kind.segment.type === 'Arc') {
      return obj.id
    }
  }
  return -1
}
function findFirstLineId(objects: ApiObject[]): number {
  for (const obj of objects) {
    if (obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line') {
      return obj.id
    }
  }
  return -1
}

describe('getTrimSpawnTerminations', () => {
  describe('termination types with lines segment as trimSpawn', () => {
    it('finds terminations correctly when a line and arc intersect', async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.05mm, var 2.44mm], end = [var 2.88mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.77mm, var 1mm], end = [var -1.91mm, var 4.06mm])
  arc1 = sketch2::arc(start = [var 2.4mm, var 4.48mm], end = [var 3.4mm, var 5.41mm], center = [var 3.99mm, var 3.07mm])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.3, 4.62],
        [-2.46, 0.1],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstLineId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection for both sides
      expect(result.leftSide.type).toBe('intersection')
      expect(result.rightSide.type).toBe('intersection')
      expect(result.leftSide).toEqual({
        type: 'intersection',
        trimTerminationCoords: [-2.3530729879512666, 2.4834844847315396],
        intersectingSegId: 6,
      })
      expect(result.rightSide).toEqual({
        type: 'intersection',
        trimTerminationCoords: [1.8273063333627224, 2.7443175958421935],
        intersectingSegId: 10,
      })
    })
    it('finds "segEndPoint" terminations when other segments ends have coincident constraints with our trim segments endpoints', async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = sketch2::arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  sketch2::coincident([line2.start, line1.start])
  sketch2::coincident([arc1.end, line1.end])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstLineId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe('segEndPoint')
      expect(result.rightSide.type).toBe('segEndPoint')
      expect(result.leftSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [-2.810000000215, 2.469999999985],
      })
      expect(result.rightSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [2.0716435933183504, 2.7918829774915763],
      })
    })

    it(`finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations when there's other segments who have ends coincident with our segment line`, async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.44mm], end = [var 2.6mm, var 2.81mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.5mm], end = [var -4.22mm, var -0.41mm])
  arc1 = sketch2::arc(start = [var 2.24mm, var 5.64mm], end = [var 1.65mm, var 2.83mm], center = [var 3.6mm, var 3.89mm])
  sketch2::coincident([arc1.end, line1])
  sketch2::coincident([line2.start, line1])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstLineId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe(
        'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
      )
      expect(result.rightSide.type).toBe(
        'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
      )
      expect(result.leftSide).toEqual({
        type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint',
        trimTerminationCoords: [-2.380259288059525, 2.5040925592307945],
        intersectingSegId: 6,
        trimSpawnSegmentCoincidentWithAnotherSegmentPointId: 4,
      })
      expect(result.rightSide).toEqual({
        type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint',
        trimTerminationCoords: [1.6587744607636377, 2.784726710328238],
        intersectingSegId: 10,
        trimSpawnSegmentCoincidentWithAnotherSegmentPointId: 8,
      })
    })
    it("finds 'segEndPoint' terminations when there's other segments who have ends on our segment line, but there not actually a coincident constraint", async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.24mm, var 2.46mm], end = [var 2.6mm, var 2.9mm])
  line2 = sketch2::line(start = [var -2.38mm, var 2.47mm], end = [var -3.94mm, var -0.64mm])
  arc1 = sketch2::arc(start = [var 2.239mm, var 5.641mm], end = [var 1.651mm, var 2.85mm], center = [var 3.6mm, var 3.889mm])
}`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstLineId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe('segEndPoint')
      expect(result.rightSide.type).toBe('segEndPoint')
      expect(result.leftSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [-3.24, 2.46],
      })
      expect(result.rightSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [2.6, 2.9],
      })
    })
  })
  describe('termination types with arc segment as trimSpawn', () => {
    it('finds terminations correctly when a line and arc intersect', async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  sketch2::arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  sketch2::arc(start = [var -0.072mm, var 4.051mm], end = [var -0.128mm, var -0.439mm], center = [var 5.32mm, var 1.738mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.3, 4.62],
        [-2.46, 0.1],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstArcId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection for both sides
      expect(result.leftSide.type).toBe('intersection')
      expect(result.rightSide.type).toBe('intersection')
      expect(result.leftSide).toEqual({
        type: 'intersection',
        trimTerminationCoords: [-0.44459011806535265, 2.8295671172502757],
        intersectingSegId: 8,
      })
      expect(result.rightSide).toEqual({
        type: 'intersection',
        trimTerminationCoords: [-4.728585883881671, 2.3133661338085765],
        intersectingSegId: 11,
      })
    })
    it('finds "segEndPoint" terminations when other segments ends have coincident constraints with our trim segments endpoints', async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.79mm, var 2.4mm], end = [var -5.61mm, var 1.77mm], center = [var -1.88mm, var -3.29mm])
  arc2 = sketch2::arc(start = [var -0.07mm, var 4.05mm], end = [var -0.13mm, var -0.44mm], center = [var 5.32mm, var 1.74mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.02mm, var -0.47mm])
  sketch2::coincident([line1.end, arc1.end])
  sketch2::coincident([arc1.start, arc2.start])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstArcId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe('segEndPoint')
      expect(result.rightSide.type).toBe('segEndPoint')
      expect(result.leftSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [0.008837118620591083, 2.809080419697051],
      })
      expect(result.rightSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [-5.1310115335133135, 1.0662359198714615],
      })
    })

    it(`finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations when there's other segments who have ends coincident with our segment line`, async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = sketch2::arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
  sketch2::coincident([line1.end, arc1])
  sketch2::coincident([arc1, arc2.start])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstArcId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe(
        'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
      )
      expect(result.rightSide.type).toBe(
        'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
      )
      expect(result.leftSide).toEqual({
        type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint',
        trimTerminationCoords: [-0.36700307305406205, 2.966675365647721],
        intersectingSegId: 8,
        trimSpawnSegmentCoincidentWithAnotherSegmentPointId: 5,
      })
      expect(result.rightSide).toEqual({
        type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint',
        trimTerminationCoords: [-4.178878101257838, 2.447749604872991],
        intersectingSegId: 11,
        trimSpawnSegmentCoincidentWithAnotherSegmentPointId: 10,
      })
    })
    it('finds "segEndPoint" terminations when there\'s other segments who have ends on our segment line, but there not actually a coincident constraint', async () => {
      const kclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.882mm, var 2.596mm], end = [var -5.481mm, var 1.595mm], center = [var -1.484mm, var -3.088mm])
  arc2 = sketch2::arc(start = [var -0.367mm, var 2.967mm], end = [var -0.099mm, var -0.427mm], center = [var 5.317mm, var 1.708mm])
  line1 = sketch2::line(start = [var -5.41mm, var 4.99mm], end = [var -4.179mm, var 2.448mm])
}
`

      const sceneGraphDelta = await getSceneGraphDeltaFromKcl(kclCode)
      const objects = sceneGraphDelta.objects

      const trimPoints: Coords2d[] = [
        [-1.9, 0.5],
        [-1.9, 4],
      ]

      const result = getTrimSpawnTerminations({
        trimSpawnSegId: findFirstArcId(objects),
        trimSpawnCoords: trimPoints,
        objects,
      })

      if (result instanceof Error) {
        throw result
      }

      // should assert a type:intersection with line id:2 and arc id:3
      expect(result.leftSide.type).toBe('segEndPoint')
      expect(result.rightSide.type).toBe('segEndPoint')
      expect(result.leftSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [0.8820069182524407, 2.596016620488862],
      })
      expect(result.rightSide).toEqual({
        type: 'segEndPoint',
        trimTerminationCoords: [-5.480988312959221, 1.5949863061464085],
      })
    })
  })
})

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
    executeTrimStrategy: async ({
      strategy,
      rustContext,
      sketchId,
      objects,
    }) => {
      if (strategy instanceof Error) {
        return strategy
      }
      return executeTrimStrategy({
        strategy,
        rustContext,
        sketchId,
        objects,
      })
    },
    onNewSketchOutcome: (outcome) => {
      lastResult = outcome
    },
    getJsAppSettings: async () => {
      return await jsAppSettings(rustContextInThisFile.settingsActor)
    },
  })

  // Execute the trim flow
  try {
    await onAreaSelectEndHandler(trimPoints)
  } catch (error) {
    hadError = error instanceof Error ? error : new Error(String(error))
  }

  // Return error if one occurred, or if no operations were executed
  if (hadError) {
    return hadError
  }

  if (!lastResult) {
    return new Error('No trim operations were executed')
  }

  return lastResult
}

describe('All 4 trims on a basic line line intersection', () => {
  const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
`

  it('Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, -2],
      [-2, 2],
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
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var 0mm, var 0mm])
  sketch2::coincident([line2.end, line1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 2: trim line2 from [2, -2] to [2, 2] - should trim right side (end)', async () => {
    const trimPoints: Coords2d[] = [
      [2, -2],
      [2, 2],
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
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 0mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line2.start, line1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 3: trim line1 from [-2, 2] to [2, 2] - should trim bottom (end)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, 2],
      [2, 2],
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
  line1 = sketch2::line(start = [var 0mm, var 0mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line1.start, line2])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 4: trim line1 from [-2, -2] to [2, -2] - should trim top (start)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, -2],
      [2, -2],
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
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
  sketch2::coincident([line1.end, line2])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
})

describe('All 4 trims on a basic arc arc intersection', () => {
  const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
}
`

  it('Case 1: trim arc2 from [-2, -2] to [-2, 2] - should trim left side (start)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, -2],
      [-2, 2],
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
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -0.41mm, var 0.41mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc2.end, arc1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 2: trim arc2 from [2, -2] to [2, 2] - should trim right side (end)', async () => {
    const trimPoints: Coords2d[] = [
      [2, -2],
      [2, 2],
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
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc2.start, arc1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 3: trim arc1 from [-2, 2] to [2, 2] - should trim bottom (end)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, 2],
      [2, 2],
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
  arc1 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var 0mm, var -5mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc1.start, arc2])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Case 4: trim arc1 from [-2, -2] to [2, -2] - should trim top (start)', async () => {
    const trimPoints: Coords2d[] = [
      [-2, -2],
      [2, -2],
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
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var -0.41mm, var 0.41mm], center = [var 30mm, var 0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var -30mm])
  sketch2::coincident([arc1.end, arc2])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
})

describe('Multi-segment trim - trim line through multiple segments', () => {
  it('should delete both segments when a single section of the trim line intersects two segments (rare but important edge case) ', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line2 = sketch2::line(start = [var 4mm, var 3mm], end = [var 4mm, var -3mm])
  line1 = sketch2::line(start = [var -4mm, var 3mm], end = [var -4mm, var -3mm])
}
`

    const trimPoints: Coords2d[] = [
      [-5, 1],
      [5, 1],
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
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it("Should remove coincident point from the end of a segment's end that is being trimmed", async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = sketch2::line(start = [var -3mm, var 2mm], end = [var 3mm, var 2mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var 3.5mm, var 2mm], end = [var 5mm, var 5mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
}
`

    const trimPoints: Coords2d[] = [
      [-1.5, 5],
      [-1.5, -5],
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
  line1 = sketch2::line(start = [var -5mm, var 5mm], end = [var -3mm, var 2mm])
  line2 = sketch2::line(start = [var 0mm, var 2mm], end = [var 3.25mm, var 2mm])
  line3 = sketch2::line(start = [var 3.25mm, var 2mm], end = [var 5mm, var 5mm])
  sketch2::coincident([line2.end, line3.start])
  arc1 = sketch2::arc(start = [var 1mm, var 5mm], end = [var 1mm, var -1mm], center = [var 5mm, var 2mm])
  sketch2::coincident([line2.start, arc1])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split trim where the end of the trimed segment has a point-line coincident constraint, should move the constraint to the newly created segment', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc9 = sketch2::arc(start = [var -5.648mm, var 6.909mm], end = [var -6.864mm, var 2.472mm], center = [var -0.293mm, var 3.056mm])
  arc2 = sketch2::arc(start = [var -7.463mm, var 5.878mm], end = [var -4.365mm, var 6.798mm], center = [var -6.237mm, var 7.425mm])
  line5 = sketch2::line(start = [var -7.81mm, var 3.77mm], end = [var -6.845mm, var 3.828mm])
  line6 = sketch2::line(start = [var -7.47mm, var 2.459mm], end = [var -6.1mm, var 2.489mm])
  sketch2::coincident([arc9.end, line6])
  sketch2::coincident([line5.end, arc9])
}
`

    // Trim line that intersects arc9 at two points to cause a split trim
    const trimPoints: Coords2d[] = [
      // sketch2::point(at = [var -5.69mm, var 4.67mm])
      // sketch2::point(at = [var -7.65mm, var 4.83mm])
      [-5.69, 4.67],
      [-7.65, 4.83],
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
  arc9 = sketch2::arc(start = [var -5.649mm, var 6.91mm], end = [var -6.438mm, var 5.461mm], center = [var -0.293mm, var 3.056mm])
  arc2 = sketch2::arc(start = [var -7.463mm, var 5.878mm], end = [var -4.365mm, var 6.798mm], center = [var -6.237mm, var 7.424mm])
  line5 = sketch2::line(start = [var -7.81mm, var 3.77mm], end = [var -6.842mm, var 3.829mm])
  line6 = sketch2::line(start = [var -7.47mm, var 2.458mm], end = [var -6.1mm, var 2.488mm])
  sketch2::coincident([arc9.end, arc2])
  arc1 = sketch2::arc(start = [var -6.842mm, var 3.829mm], end = [var -6.861mm, var 2.472mm], center = [var -0.293mm, var 3.056mm])
  sketch2::coincident([arc1.start, line5.end])
  sketch2::coincident([arc1.end, line6])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('another edge case involving split lines and point-segment coincident points', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.301mm])
  line2 = sketch2::line(start = [var -6.13mm, var 1.67mm], end = [var 4.25mm, var 5.351mm])
  arc4 = sketch2::arc(start = [var 3.09mm, var 4.939mm], end = [var 2.691mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  sketch2::coincident([arc4.start, line2])
  sketch2::coincident([line1.end, line2])
  arc3 = sketch2::arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.661mm], center = [var 1.286mm, var 3.174mm])
}
`

    const trimPoints: Coords2d[] = [
      [0, 6],
      [-1.1, 1.6],
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
  line1 = sketch2::line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.302mm])
  line2 = sketch2::line(start = [var -6.13mm, var 1.669mm], end = [var -3.009mm, var 2.779mm])
  arc4 = sketch2::arc(start = [var 3.09mm, var 4.939mm], end = [var 2.691mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  sketch2::coincident([line1.end, line2])
  arc3 = sketch2::arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.661mm], center = [var 1.286mm, var 3.174mm])
  sketch2::coincident([line2.end, arc3])
  line3 = sketch2::line(start = [var 3.09mm, var 4.939mm], end = [var 4.25mm, var 5.35mm])
  sketch2::coincident([line3.start, arc4.start])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Can split arc with point-segment coincident constraints', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -3.2mm, var 6.2mm], end = [var -1.8mm, var -4.7mm], center = [var 1.8mm, var 1.3mm])
  arc2 = sketch2::arc(start = [var -4.6mm, var -1.6mm], end = [var -6.5mm, var -2mm], center = [var -4.4mm, var -8.2mm])
  line1 = sketch2::line(start = [var -7.5mm, var 2.5mm], end = [var -5.1mm, var 2.3mm])
  sketch2::coincident([line1.end, arc1])
  sketch2::coincident([arc2.start, arc1])
}
`

    const trimLines: Array<Array<Coords2d>> = [
      // sketch2::point(at = [var -3.45mm, var -1.3mm])
      // sketch2::point(at = [var -5.53mm, var -1.3mm])
      [
        [-3.45, -1.3],
        [-5.53, -1.3],
      ],
      // sketch2::point(at = [var -3.93mm, var 2.17mm])
      // sketch2::point(at = [var -6.24mm, var 2.14mm])
      [
        [-3.93, 2.17],
        [-6.24, 2.14],
      ],
      // sketch2::point(at = [var -3.77mm, var 0.5mm])
      // sketch2::point(at = [var -6.11mm, var 0.37mm])
      [
        [-3.77, 0.5],
        [-6.11, 0.37],
      ],
    ]

    // Expected code will be updated based on actual output - coordinates may vary slightly
    // The key is that we have the correct constraints:
    // - [arc1.end, line1.end] (point-point, stays on arc1.end)
    // - [arc3.start, arc2.start] (point-point, moved to arc3.start)
    // And we should NOT have:
    // - [arc2.start, arc1] (original constraint should be deleted)
    // - [arc3.start, line1.end] (should not be created)
    // - [arc3.start, arc2] (should be point-point, not point-segment)
    const expectedCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var -3.195mm, var 6.195mm], end = [var -5.119mm, var 2.301mm], center = [var 1.802mm, var 1.304mm])
  arc2 = sketch2::arc(start = [var -4.58mm, var -1.623mm], end = [var -6.51mm, var -1.971mm], center = [var -4.391mm, var -8.198mm])
  line1 = sketch2::line(start = [var -7.5mm, var 2.5mm], end = [var -5.119mm, var 2.301mm])
  sketch2::coincident([arc1.end, line1.end])
  arc3 = sketch2::arc(start = [var -4.58mm, var -1.623mm], end = [var -1.805mm, var -4.718mm], center = [var 1.796mm, var 1.304mm])
  sketch2::coincident([arc3.start, arc2.start])
}
`

    // Test that all trim lines produce the same result
    for (let i = 0; i < trimLines.length; i++) {
      const trimPoints = trimLines[i]
      const result = await executeTrimFlow({
        kclCode: baseKclCode,
        trimPoints,
        sketchId: 0,
      })

      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) {
        throw result
      }

      expect(result.kclSource.text).toBe(
        expectedCode
        // `Trim line ${i + 1} (${JSON.stringify(trimPoints)}) produced different result`
      )
    }
  })

  it('split arc with point-segment coincident on one side and intersection on the other', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc2 = sketch2::arc(start = [var 2.541mm, var -5.65mm], end = [var 1.979mm, var 6.83mm], center = [var -7.28mm, var 0.161mm])
  arc1 = sketch2::arc(start = [var 5.69mm, var 4.559mm], end = [var -4.011mm, var -3.04mm], center = [var 5.1mm, var -4.678mm])
  line1 = sketch2::line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = sketch2::line(start = [var -1.029mm, var 2.259mm], end = [var -2.01mm, var -6.62mm])
  sketch2::coincident([line4.start, arc1])
}
`

    const trimPoints: Coords2d[] = [
      [-0.4, 4.4],
      [1.3, 2.4],
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

    // Expected code - coordinates may vary slightly due to solver precision
    // The key is that:
    // - arc1 is trimmed to the intersection point
    // - arc3 is created from the split point to the original end
    // - The point-segment constraint [line4.start, arc1] is converted to [arc3.start, line4.start]
    const expectedCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc2 = sketch2::arc(start = [var 2.541mm, var -5.65mm], end = [var 1.979mm, var 6.83mm], center = [var -7.283mm, var 0.16mm])
  arc1 = sketch2::arc(start = [var 5.69mm, var 4.558mm], end = [var 3.313mm, var 4.402mm], center = [var 5.1mm, var -4.678mm])
  line1 = sketch2::line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = sketch2::line(start = [var -1.029mm, var 2.259mm], end = [var -2.01mm, var -6.62mm])
  sketch2::coincident([arc1.end, arc2])
  arc3 = sketch2::arc(start = [var -1.029mm, var 2.259mm], end = [var -4.011mm, var -3.04mm], center = [var 5.1mm, var -4.678mm])
  sketch2::coincident([arc3.start, line4.start])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })
  it('split straight segments should migrate other constraints correctly', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = sketch2::line(start = [var -6mm, var 0mm], end = [var 6mm, var 0mm])
  startSideCoincidentWithTrimSegStart = sketch2::line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = sketch2::line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = sketch2::line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = sketch2::line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  sketch2::coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    segmentToBeTrimmedAndSplit
  ])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.end,
    endSideCoincidentWithTrimSegStart
  ])
}
`

    const trimPoints: Coords2d[] = [
      [0, 4],
      [0, -4],
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

    // Expected code - coordinates may vary slightly due to solver precision
    // The key is that:
    // - arc1 is trimmed to the intersection point
    // - arc3 is created from the split point to the original end
    // - The point-segment constraint [line4.start, arc1] is converted to [arc3.start, line4.start]
    const expectedCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  segmentToBeTrimmedAndSplit = sketch2::line(start = [var -6mm, var 0mm], end = [var -2mm, var 0mm])
  startSideCoincidentWithTrimSegStart = sketch2::line(start = [var -6mm, var 3mm], end = [var -6mm, var -3mm])
  startSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var -4mm, var 0mm], end = [var -4mm, var 3mm])
  startSideIntersectionTrimTermination = sketch2::line(start = [var -2mm, var 3mm], end = [var -2mm, var -3mm])
  endSideIntersectionTrimTermination = sketch2::line(start = [var 2mm, var 3mm], end = [var 2mm, var -3mm])
  endSideEndPointCoincidentWithTrimSeg = sketch2::line(start = [var 4mm, var -3mm], end = [var 4mm, var 0mm])
  endSideCoincidentWithTrimSegStart = sketch2::line(start = [var 6mm, var 3mm], end = [var 6mm, var -3mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.start,
    startSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    startSideEndPointCoincidentWithTrimSeg.start,
    segmentToBeTrimmedAndSplit
  ])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.end,
    startSideIntersectionTrimTermination
  ])
  line1 = sketch2::line(start = [var 2mm, var 0mm], end = [var 6mm, var 0mm])
  sketch2::coincident([
    line1.start,
    endSideIntersectionTrimTermination
  ])
  sketch2::coincident([
    line1.end,
    endSideCoincidentWithTrimSegStart
  ])
  sketch2::coincident([
    endSideEndPointCoincidentWithTrimSeg.end,
    line1
  ])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

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
  line8 = sketch2::line(start = [var 6.77mm, var -4.86mm], end = [var -5.81mm, var -7.67mm])
  sketch2::coincident([line7.end, line8.start])
  line9 = sketch2::line(start = [var -5.81mm, var -7.67mm], end = [var -1.08mm, var -10.86mm])
  sketch2::coincident([line8.end, line9.start])
  line10 = sketch2::line(start = [var -1.08mm, var -10.86mm], end = [var -4.36mm, var 7.64mm])
  sketch2::coincident([line9.end, line10.start])
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
  line16 = sketch2::line(start = [var 0.71mm, var -10.01mm], end = [var -6.89mm, var -7.5mm])
  sketch2::coincident([line15.end, line16.start])
  line17 = sketch2::line(start = [var -6.89mm, var -7.5mm], end = [var 5.24mm, var 2.08mm])
  sketch2::coincident([line16.end, line17.start])
  line18 = sketch2::line(start = [var 5.24mm, var 2.08mm], end = [var -6.76mm, var 0.49mm])
  sketch2::coincident([line17.end, line18.start])
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
  line26 = sketch2::line(start = [var -2.87mm, var -8.28mm], end = [var 4.2mm, var -0.32mm])
  line27 = sketch2::line(start = [var 5.45mm, var 7.3mm], end = [var -7.06mm, var 6.28mm])
  sketch2::arc(start = [var 2.71mm, var -9.71mm], end = [var -3.98mm, var 8.12mm], center = [var -6.86mm, var -3.13mm])
  sketch2::arc(start = [var -2.95mm, var 1.9mm], end = [var 1.73mm, var -6.79mm], center = [var 7.68mm, var 2.02mm])
  sketch2::arc(start = [var -6.15mm, var 5.57mm], end = [var 6.91mm, var 3.17mm], center = [var 1.12mm, var 8.38mm])
  sketch2::arc(start = [var 5.55mm, var 7.91mm], end = [var -7.64mm, var -6.45mm], center = [var 7.51mm, var -7.13mm])
  sketch2::arc(start = [var 3.69mm, var -3.61mm], end = [var -5.68mm, var -5.96mm], center = [var 0.58mm, var -11.06mm])
  sketch2::arc(start = [var -1.31mm, var -0.73mm], end = [var -0.61mm, var -8.79mm], center = [var 3.72mm, var -4.35mm])
  sketch2::arc(start = [var -4.9mm, var 0.12mm], end = [var -5.32mm, var -3.75mm], center = [var -0.74mm, var -2.29mm])
}
`

      const trimPoints: Coords2d[] = [
        [0.13869720291315302, 8.011966248135787],
        [0.172512901909122, 7.673193890920741],
        [0.20632860090509095, 7.503807712313219],
        [0.30777569789299786, 7.266667062262689],
        [0.37540709588493576, 7.097280883655166],
        [0.4430384938768737, 6.927894705047644],
        [0.5106698918688116, 6.758508526440123],
        [0.6459326878526855, 6.5891223478326015],
        [0.7473797848405924, 6.453613404946584],
        [0.8488268818284994, 6.318104462060566],
        [0.9502739788164063, 6.182595519174549],
        [1.0517210758043112, 6.047086576288532],
        [1.2207995707841561, 5.945454869124018],
        [1.3560623667680318, 5.843823161959505],
        [1.3898780657640009, 5.674436983351984],
        [1.3898780657640009, 5.505050804744461],
        [1.288430968776094, 5.369541861858444],
        [1.153168172792218, 5.234032918972426],
        [1.0179053768083441, 5.132401211807912],
        [0.7811954838365615, 5.064646740364905],
        [0.6121169888567166, 5.0307695046434],
        [0.4430384938768737, 4.996892268921896],
        [0.2739599988970289, 4.963015033200391],
        [0.10488150391718407, 4.895260561757382],
        [-0.0641969910626598, 4.827506090314373],
        [-0.23327548604250367, 4.759751618871365],
        [-0.40235398102234754, 4.725874383149861],
        [-0.5714324760021924, 4.658119911706852],
        [-0.7066952719860673, 4.522610968820834],
        [-0.8081423689739742, 4.3871020259348175],
        [-0.9095894659618811, 4.251593083048799],
        [-1.0448522619457559, 4.116084140162783],
        [-1.1801150579296318, 4.014452432998269],
        [-1.3153778539135066, 3.9128207258337553],
        [-1.4844563488933507, 3.878943490112251],
        [-1.6535348438731954, 3.811189018669242],
        [-1.7887976398570702, 3.7095573115047293],
        [-1.9578761348369151, 3.607925604340216],
        [-2.09313893082079, 3.5062938971757025],
        [-2.2284017268046656, 3.3707849542896855],
        [-2.160770328812728, 3.0320125970746417],
        [-2.09313893082079, 2.8626264184671193],
        [-1.991691833832883, 2.693240239859598],
        [-1.924060435840946, 2.523854061252077],
        [-1.8564290378490083, 2.354467882644554],
        [-1.7887976398570702, 2.185081704037033],
        [-1.7549819408611014, 2.01569552542951],
        [-1.6873505428691644, 1.8463093468219889],
        [-1.5859034458812575, 1.7108004039359708],
        [-1.4506406498973825, 1.5752914610499542],
        [-1.2815621549175378, 1.4736597538854406],
        [-1.112483659937694, 1.372028046720927],
        [-0.943405164957849, 1.2703963395564135],
        [-0.8081423689739742, 1.1687646323919012],
        [-0.7066952719860673, 1.033255689505883],
        [-0.6390638739941302, 0.8638695108983618],
        [-0.6390638739941302, 0.6944833322908393],
        [-0.7405109709820362, 0.5589743894048226],
        [-0.8081423689739742, 0.38958821079729994],
        [-0.875773766965912, 0.2202020321897787],
        [-0.977220863953818, 0.05081585358225611],
        [-1.0448522619457559, -0.11857032502526647],
        [-1.112483659937694, -0.28795650363278774],
        [-1.112483659937694, -0.457342682240309],
        [-1.112483659937694, -0.6944833322908393],
        [-0.9095894659618811, -0.8977467466198664],
        [-0.7743266699780051, -1.0671329252273876],
        [-0.6390638739941302, -1.1687646323918999],
        [-0.43616968001831646, -1.3381508109994238],
        [-0.09801269005862877, -1.5752914610499542],
        [0.03725010592524613, -1.6769231682144663],
        [0.0710658049212151, -1.8463093468219876],
        [0.10488150391718407, -2.0156955254295115],
        [0.10488150391718407, -2.185081704037033],
        [0.10488150391718407, -2.354467882644554],
        [-0.09801269005862877, -2.5916085326950844],
        [-0.16564408805056574, -2.7609947113026054],
        [-0.23327548604250367, -2.9642581256316327],
        [-0.3009068840344416, -3.1336443042391537],
        [-0.3347225830304106, -3.303030482846678],
        [-0.3685382820263795, -3.472416661454199],
        [-0.40235398102234754, -3.6418028400617204],
        [-0.46998537901428544, -3.811189018669242],
        [-0.5714324760021924, -3.9466979615552598],
        [-0.7405109709820362, -3.980575197276763],
        [-0.9095894659618811, -4.048329668719772],
        [-1.078667960941725, -4.082206904441278],
        [-1.1462993589336627, -4.251593083048799],
        [-1.2139307569255997, -4.420979261656321],
        [-1.2815621549175378, -4.590365440263844],
        [-1.3153778539135066, -4.759751618871365],
        [-1.3153778539135066, -4.96301503320039],
        [-1.3153778539135066, -5.132401211807914],
        [-1.3491935529094756, -5.369541861858444],
        [-1.3830092519054447, -5.538928040465965],
        [-1.4844563488933507, -5.708314219073487],
        [-1.6197191448772263, -5.877700397681008],
        [-1.7549819408611014, -5.979332104845523],
        [-1.924060435840946, -6.013209340567026],
        [-2.160770328812728, -6.080963812010035],
        [-2.3974802217845097, -6.080963812010035],
        [-2.6341901147562914, -6.114841047731541],
        [-2.8032686097361355, -6.114841047731541],
        [-3.006162803711949, -6.148718283453044],
        [-3.209056997687762, -6.148718283453044],
        [-3.3781354926676057, -6.18259551917455],
        [-3.5472139876474507, -6.216472754896053],
        [-3.614845385639388, -6.385858933503575],
        [-3.7162924826272947, -6.521367876389593],
        [-3.8853709776071383, -6.521367876389593],
        [-4.054449472586983, -6.521367876389593],
        [-4.223527967566827, -6.521367876389593],
        [-4.392606462546671, -6.521367876389593],
        [-4.494053559534578, -6.6568768192756105],
        [-4.5616849575265155, -6.8262629978831315],
        [-4.5616849575265155, -6.995649176490653],
        [-4.595500656522485, -7.1650353550981745],
        [-4.595500656522485, -7.334421533705698],
        [-4.595500656522485, -7.503807712313219],
        [-4.595500656522485, -7.673193890920741],
        [-4.595500656522485, -7.842580069528262],
        [-4.595500656522485, -8.113597955300298],
        [-4.595500656522485, -8.350738605350829],
        [-4.595500656522485, -8.52012478395835],
        [-4.595500656522485, -8.75726543400888],
        [-4.595500656522485, -8.926651612616403],
        [-4.595500656522485, -9.231546734109942],
        [-4.595500656522485, -9.434810148438968],
        [-4.595500656522485, -9.604196327046491],
        [-4.595500656522485, -9.841336977097022],
        [-4.595500656522485, -10.010723155704543],
        [-4.595500656522485, -10.21398657003357],
        [-4.595500656522485, -10.383372748641092],
        [-4.595500656522485, -10.552758927248613],
        [-4.595500656522485, -10.722145105856134],
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

      // Assert that the test completes within a reasonable time (25 seconds, leaving 5s buffer before timeout)
      expect(durationMs).toBeLessThan(12_000)
    }
  ) // 30 second timeout for this complex stress test
})
