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
} from '@src/machines/sketchSolve/tools/trimUtils'
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
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 3mm, var -4mm], center = [var 500mm, var 0mm])
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
  arc1 = sketch2::arc(start = [var 2mm, var 4mm], end = [var 3mm, var -4mm], center = [var 500mm, var 0mm])
  sketch2::coincident([line1.end, line2])
  line3 = sketch2::line(start = [var 2.48mm, var 0mm], end = [var 5mm, var 0mm])
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

    it('finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations when there\'s other segments who have ends coincident with our segment line', async () => {
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

    it('finds "trimSpawnSegmentCoincidentWithAnotherSegmentPoint" terminations when there\'s other segments who have ends coincident with our segment line', async () => {
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
})
