#[cfg(test)]
mod tests {
    use crate::frontend::api::ObjectId;
    use crate::frontend::trim::{Coords2d, execute_trim_flow};

    #[tokio::test]
    async fn test_trim_line2_left_side() {
        // This test mirrors: "Case 1: trim line2 from [-2, -2] to [-2, 2] - should trim left side (start)"
        // from the TypeScript test file


/*

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
  arc1 = sketch2::arc(start = [var -0.41mm, var -0.17mm], end = [var 0mm, var -5mm], center = [var 30mm, var -0mm])
  line1 = sketch2::line(start = [var -5mm, var -2mm], end = [var -0.41mm, var -0.17mm])
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
  line3 = sketch2::line(start = [var 1.98mm, var 0mm], end = [var 5mm, var 0mm])
  sketch2::coincident([line1.end, line2])
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

  // Return error if one occurred, or if no operations were executed
  if (hadError) {
    return hadError
  }

  if (!lastResult) {
    return new Error('No trim operations were executed')
  }

  return lastResult
}

*/


        let base_kcl_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm])
}
"#;

        let trim_points = vec![Coords2d { x: -2.0, y: -2.0 }, Coords2d { x: -2.0, y: 2.0 }];

        let sketch_id = ObjectId(0);

        let result = execute_trim_flow(base_kcl_code, &trim_points, sketch_id).await;

        match result {
            Ok(kcl_code) => {
                let expected_code = r#"@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var 0mm, var 5mm], end = [var 0mm, var -5mm])
  line2 = sketch2::line(start = [var 5mm, var 0mm], end = [var 0mm, var 0mm])
  sketch2::coincident([line2.end, line1])
}
"#;

                // Normalize both strings for comparison (trim whitespace)
                let result_normalized = kcl_code.trim();
                let expected_normalized = expected_code.trim();

                if result_normalized != expected_normalized {
                    eprintln!("Actual result:\n{}", result_normalized);
                    eprintln!("Expected result:\n{}", expected_normalized);
                }

                assert_eq!(
                    result_normalized, expected_normalized,
                    "Trim result should match expected KCL code"
                );
            }
            Err(e) => {
                panic!("trim flow failed: {}", e);
            }
        }
    }
}

/*/

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
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var -0mm, var -5mm], center = [var 30mm, var -0mm])
  arc2 = sketch2::arc(start = [var 5mm, var -0mm], end = [var -0.41mm, var 0.41mm], center = [var 0mm, var -30mm])
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
  arc1 = sketch2::arc(start = [var 0mm, var 5mm], end = [var -0mm, var -5mm], center = [var 30mm, var -0mm])
  arc2 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var -5mm, var -0mm], center = [var -0mm, var -30mm])
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
  arc1 = sketch2::arc(start = [var -0.41mm, var 0.41mm], end = [var 0mm, var -5mm], center = [var 30mm, var -0mm])
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var -0mm], center = [var 0mm, var -30mm])
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
  arc2 = sketch2::arc(start = [var 5mm, var 0mm], end = [var -5mm, var -0mm], center = [var 0mm, var -30mm])
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
  line2 = sketch2::line(start = [var 0mm, var 2mm], end = [var 3mm, var 2mm])
  line3 = sketch2::line(start = [var 3mm, var 2mm], end = [var 5mm, var 5mm])
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
  arc9 = sketch2::arc(start = [var -5.65mm, var 6.91mm], end = [var -6.44mm, var 5.46mm], center = [var -0.29mm, var 3.06mm])
  arc2 = sketch2::arc(start = [var -7.46mm, var 5.88mm], end = [var -4.37mm, var 6.8mm], center = [var -6.24mm, var 7.42mm])
  line5 = sketch2::line(start = [var -7.81mm, var 3.77mm], end = [var -6.84mm, var 3.83mm])
  line6 = sketch2::line(start = [var -7.47mm, var 2.46mm], end = [var -6.1mm, var 2.49mm])
  arc1 = sketch2::arc(start = [var -6.84mm, var 3.83mm], end = [var -6.86mm, var 2.47mm], center = [var -0.29mm, var 3.06mm])
  sketch2::coincident([arc9.end, arc2])
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
  line1 = sketch2::line(start = [var -3.86mm, var 5.53mm], end = [var -4.35mm, var 2.3mm])
  line2 = sketch2::line(start = [var -6.13mm, var 1.67mm], end = [var -3.01mm, var 2.78mm])
  arc4 = sketch2::arc(start = [var 3.09mm, var 4.94mm], end = [var 2.69mm, var 6.42mm], center = [var -7.39mm, var 2.91mm])
  sketch2::coincident([line1.end, line2])
  arc3 = sketch2::arc(start = [var -2.42mm, var 5.38mm], end = [var -0.69mm, var -0.66mm], center = [var 1.29mm, var 3.17mm])
  line3 = sketch2::line(start = [var 3.09mm, var 4.94mm], end = [var 4.25mm, var 5.35mm])
  sketch2::coincident([line2.end, arc3])
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
  arc1 = sketch2::arc(start = [var -3.2mm, var 6.2mm], end = [var -5.12mm, var 2.3mm], center = [var 1.8mm, var 1.3mm])
  arc2 = sketch2::arc(start = [var -4.58mm, var -1.62mm], end = [var -6.51mm, var -1.97mm], center = [var -4.39mm, var -8.2mm])
  line1 = sketch2::line(start = [var -7.5mm, var 2.5mm], end = [var -5.12mm, var 2.3mm])
  arc3 = sketch2::arc(start = [var -4.58mm, var -1.62mm], end = [var -1.81mm, var -4.72mm], center = [var 1.8mm, var 1.3mm])
  sketch2::coincident([arc1.end, line1.end])
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
  arc2 = sketch2::arc(start = [var 2.54mm, var -5.65mm], end = [var 1.98mm, var 6.83mm], center = [var -7.28mm, var 0.16mm])
  arc1 = sketch2::arc(start = [var 5.69mm, var 4.56mm], end = [var 3.31mm, var 4.4mm], center = [var 5.1mm, var -4.68mm])
  line1 = sketch2::line(start = [var -4.28mm, var 4.29mm], end = [var 1.34mm, var -4.76mm])
  line4 = sketch2::line(start = [var -1.03mm, var 2.26mm], end = [var -2.01mm, var -6.62mm])
  arc3 = sketch2::arc(start = [var -1.03mm, var 2.26mm], end = [var -4.01mm, var -3.04mm], center = [var 5.1mm, var -4.68mm])
  sketch2::coincident([arc1.end, arc2])
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
  line1 = sketch2::line(start = [var 2mm, var 0mm], end = [var 6mm, var 0mm])
  sketch2::coincident([
    segmentToBeTrimmedAndSplit.end,
    startSideIntersectionTrimTermination
  ])
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

  it('trim with distance constraints should preserve constraints correctly', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  simpleDeleteLineDisContraintDeletedAsWell = sketch2::line(start = [var -3mm, var 5mm], end = [var 3.5mm, var 4.5mm])
  sketch2::coincident([
    line1.end,
    simpleDeleteLineDisContraintDeletedAsWell.start
  ])
  simpleDeleteLineDisContraintDeletedAsWell2 = sketch2::line(start = [var -3.5mm, var 3.5mm], end = [var 3.5mm, var 3.5mm])
  line4 = sketch2::line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = sketch2::line(start = [var -3.5mm, var 2mm], end = [var 3mm, var 2mm])
  sketch2::coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = sketch2::line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsDeleteDisConstraint = sketch2::line(start = [var -3.22mm, var -0.64mm], end = [var 3.02mm, var -0.75mm])
  line3 = sketch2::line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  sketch2::coincident([
    startTrimmedAlsDeleteDisConstraint.end,
    line3.start
  ])
  line5 = sketch2::line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = sketch2::line(start = [var -2.67mm, var -3.46mm], end = [var 2.87mm, var -3.54mm])
  line8 = sketch2::line(start = [var 2.87mm, var -3.54mm], end = [var 5.42mm, var -1.72mm])
  sketch2::coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line8.start
  ])
  line9 = sketch2::line(start = [var 1.1mm, var -3.98mm], end = [var 1.28mm, var -5.69mm])
  line10 = sketch2::line(start = [var 1.98mm, var -4.06mm], end = [var 2.57mm, var -5.65mm])
  line11 = sketch2::line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  sketch2::coincident([
    line9.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  sketch2::coincident([
    line10.start,
    splitTrimLineDistanceConstraintMigrated
  ])
  sketch2::distance([
    simpleDeleteLineDisContraintDeletedAsWell.start,
    simpleDeleteLineDisContraintDeletedAsWell.end
  ]) == 6.52mm
  sketch2::distance([
    simpleDeleteLineDisContraintDeletedAsWell2.start,
    simpleDeleteLineDisContraintDeletedAsWell2.end
  ]) == 7mm
  sketch2::distance([
    endTrimmedShouldDeleteDisConstraint.start,
    endTrimmedShouldDeleteDisConstraint.end
  ]) == 6.5mm
  sketch2::distance([
    startTrimmedAlsDeleteDisConstraint.start,
    startTrimmedAlsDeleteDisConstraint.end
  ]) == 6.24mm
  sketch2::distance([
    splitTrimLineDistanceConstraintMigrated.start,
    splitTrimLineDistanceConstraintMigrated.end
  ]) == 5.54mm
}
`

    const trimPoints: Coords2d[] = [
      // sketch2::point(at = [var -0.56mm, var 5.56mm])
      // sketch2::point(at = [var -0.97mm, var 4.11mm])
      // sketch2::point(at = [var -0.97mm, var 2.77mm])
      // sketch2::point(at = [var -0.93mm, var 0.77mm])
      // sketch2::point(at = [var -0.56mm, var -2.61mm])
      // sketch2::point(at = [var 0.14mm, var -4.8mm])
      [-0.56, 5.56],
      [-0.97, 4.11],
      [-0.97, 2.77],
      [-0.93, 0.77],
      [-0.56, -2.61],
      [0.14, -4.8],
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
  line1 = sketch2::line(start = [var -5.5mm, var 7mm], end = [var -3mm, var 5mm])
  line4 = sketch2::line(start = [var -6mm, var 4mm], end = [var -3.5mm, var 2mm])
  endTrimmedShouldDeleteDisConstraint = sketch2::line(start = [var -3.5mm, var 2mm], end = [var -2.33mm, var 2mm])
  sketch2::coincident([
    line4.end,
    endTrimmedShouldDeleteDisConstraint.start
  ])
  line6 = sketch2::line(start = [var -3mm, var 1mm], end = [var -2mm, var 2.5mm])
  startTrimmedAlsDeleteDisConstraint = sketch2::line(start = [var 1.63mm, var -0.73mm], end = [var 3.02mm, var -0.75mm])
  line3 = sketch2::line(start = [var 3.02mm, var -0.75mm], end = [var 5.38mm, var 1.14mm])
  sketch2::coincident([
    startTrimmedAlsDeleteDisConstraint.end,
    line3.start
  ])
  line5 = sketch2::line(start = [var 1.24mm, var 0.92mm], end = [var 1.84mm, var -1.64mm])
  splitTrimLineDistanceConstraintMigrated = sketch2::line(start = [var -2.67mm, var -3.46mm], end = [var -1.78mm, var -3.62mm])
  line8 = sketch2::line(start = [var 2.87mm, var -3.72mm], end = [var 5.42mm, var -1.72mm])
  line9 = sketch2::line(start = [var 1.1mm, var -3.91mm], end = [var 1.28mm, var -5.69mm])
  line10 = sketch2::line(start = [var 1.99mm, var -3.81mm], end = [var 2.57mm, var -5.65mm])
  line11 = sketch2::line(start = [var -1.93mm, var -2.2mm], end = [var -1.6mm, var -5.43mm])
  sketch2::coincident([
    endTrimmedShouldDeleteDisConstraint.end,
    line6
  ])
  sketch2::coincident([
    startTrimmedAlsDeleteDisConstraint.start,
    line5
  ])
  line2 = sketch2::line(start = [var 1.1mm, var -3.91mm], end = [var 2.87mm, var -3.72mm])
  sketch2::coincident([
    splitTrimLineDistanceConstraintMigrated.end,
    line11
  ])
  sketch2::coincident([line2.start, line9.start])
  sketch2::coincident([line2.end, line8.start])
  sketch2::coincident([line10.start, line2])
sketch2::distance([
  splitTrimLineDistanceConstraintMigrated.start,
  line2.end
]) == 5.54mm
}
`
    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split trim should migrate angle constraints to new segment', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -2.01mm, var 6.12mm], end = [var 0.23mm, var 4.55mm])
  line2 = sketch2::line(start = [var -4.15mm, var -0mm], end = [var 0.79mm, var -3.47mm])
  sketch2::parallel([line1, line2])
  line3 = sketch2::line(start = [var -3.1mm, var 1.3mm], end = [var -2.96mm, var -3.08mm])
  line4 = sketch2::line(start = [var -0.58mm, var -0.81mm], end = [var -1.13mm, var -4.94mm])
  line5 = sketch2::line(start = [var -0.11mm, var -3.3mm], end = [var -0.11mm, var -5.63mm])
  line6 = sketch2::line(start = [var 1.49mm, var -3.48mm], end = [var 3.5mm, var -1.84mm])
  sketch2::coincident([line6.start, line2.end])
  sketch2::coincident([line5.start, line2])
}
`

    const trimPoints: Coords2d[] = [
      [-1.75, -0.56],
      [-1.75, -2.93],
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
  line1 = sketch2::line(start = [var -2.05mm, var 6.06mm], end = [var 0.27mm, var 4.61mm])
  line2 = sketch2::line(start = [var -4.18mm, var -0.05mm], end = [var -3.02mm, var -0.78mm])
  sketch2::parallel([line1, line2])
  line3 = sketch2::line(start = [var -3.09mm, var 1.3mm], end = [var -2.95mm, var -3.08mm])
  line4 = sketch2::line(start = [var -0.59mm, var -0.81mm], end = [var -1.14mm, var -4.94mm])
  line5 = sketch2::line(start = [var 0.1mm, var -2.99mm], end = [var -0.11mm, var -5.63mm])
  line6 = sketch2::line(start = [var 1.18mm, var -3.67mm], end = [var 3.5mm, var -1.84mm])
  line7 = sketch2::line(start = [var -0.81mm, var -2.42mm], end = [var 1.18mm, var -3.67mm])
  sketch2::coincident([line2.end, line3])
  sketch2::coincident([line7.start, line4])
  sketch2::coincident([line7.end, line6.start])
  sketch2::coincident([line5.start, line7])
  sketch2::parallel([line1, line7])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split trim should migrate horizontal constraint to new segment', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -3.64mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::horizontal(line1)
}
`

    const trimPoints: Coords2d[] = [
      [0.73, 1.85],
      [-0.8, 0.25],
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
  line1 = sketch2::line(start = [var -3.64mm, var 1.26mm], end = [var -1.7mm, var 1.26mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::horizontal(line1)
  line4 = sketch2::line(start = [var 2.12mm, var 1.26mm], end = [var 3.8mm, var 1.26mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line4.start, line3])
  sketch2::horizontal(line4)
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split trim should migrate vertical constraint to new segment', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var -2.66mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::vertical(line1)
}
`

    const trimPoints: Coords2d[] = [
      [0.47, 1.45],
      [-1.72, 0.1],
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
  line1 = sketch2::line(start = [var -0.36mm, var 3.66mm], end = [var -0.36mm, var 2.34mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::vertical(line1)
  line4 = sketch2::line(start = [var -0.36mm, var -0.87mm], end = [var -0.36mm, var -2.66mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line4.start, line3])
  sketch2::vertical(line4)
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split trim should migrate perpendicular constraint to new segment', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  line4 = sketch2::line(start = [var -0.91mm, var 5.79mm], end = [var 1.86mm, var 7.22mm])
  line1 = sketch2::line(start = [var -1.97mm, var 3.24mm], end = [var 0.55mm, var -2.31mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::perpendicular([line4, line1])
}
`

    const trimPoints: Coords2d[] = [
      [0.95, 1.67],
      [-2.3, -0.08],
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
  line4 = sketch2::line(start = [var -0.92mm, var 5.82mm], end = [var 1.87mm, var 7.19mm])
  line1 = sketch2::line(start = [var -2mm, var 3.22mm], end = [var -1.22mm, var 1.64mm])
  line2 = sketch2::line(start = [var 3.32mm, var 5.32mm], end = [var -4.67mm, var -1.14mm])
  line3 = sketch2::line(start = [var 4.34mm, var 3.17mm], end = [var -3.94mm, var -3.95mm])
  sketch2::perpendicular([line4, line1])
  line5 = sketch2::line(start = [var -0.18mm, var -0.71mm], end = [var 0.6mm, var -2.29mm])
  sketch2::coincident([line1.end, line2])
  sketch2::coincident([line5.start, line3])
  sketch2::perpendicular([line4, line5])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('split arc should duplicate center point constraints to new arc', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arcToSplit = sketch2::arc(start = [var 10.5mm, var 1mm], end = [var -10.5mm, var 0.5mm], center = [var 0.5mm, var -8.5mm])
  line1 = sketch2::line(start = [var -6mm, var 8mm], end = [var -5.5mm, var 0mm])
  line2 = sketch2::line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = sketch2::line(start = [var 1.5mm, var -9mm], end = [var 11.5mm, var -7.5mm])
  line4 = sketch2::line(start = [var 11.5mm, var 1mm], end = [var 13mm, var 6.5mm])
  line5 = sketch2::line(start = [var 7.5mm, var 4mm], end = [var 10mm, var 8mm])
  sketch2::coincident([line5.start, arcToSplit])
  sketch2::coincident([line4.start, arcToSplit.start])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
  sketch2::distance([arcToSplit.center, line4.end]) == 20mm
  line3 = sketch2::line(start = [var -0.9mm, var -6.9mm], end = [var 2.9mm, var -11.2mm])
  sketch2::coincident([arcToSplit.center, line3])
}
`

    const trimPoints: Coords2d[] = [
      [-1.66, 7.54],
      [-1.81, 2.11],
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
  arcToSplit = sketch2::arc(start = [var 11.03mm, var 1.02mm], end = [var 3.52mm, var 5.17mm], center = [var 0.75mm, var -8.72mm])
  line1 = sketch2::line(start = [var -6mm, var 8mm], end = [var -5.5mm, var -0mm])
  line2 = sketch2::line(start = [var 4mm, var 8.5mm], end = [var 3mm, var 1.5mm])
  lineCoincidentWithArcCen = sketch2::line(start = [var 0.75mm, var -8.72mm], end = [var 11.5mm, var -7.5mm])
  line4 = sketch2::line(start = [var 11.03mm, var 1.02mm], end = [var 13.3mm, var 6.85mm])
  line5 = sketch2::line(start = [var 7.38mm, var 3.8mm], end = [var 10mm, var 8mm])
  sketch2::coincident([line5.start, arcToSplit])
  sketch2::coincident([line4.start, arcToSplit.start])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arcToSplit.center
  ])
sketch2::distance([arcToSplit.center, line4.end]) == 20mm
  line3 = sketch2::line(start = [var -0.87mm, var -6.87mm], end = [var 2.91mm, var -11.19mm])
  sketch2::coincident([arcToSplit.center, line3])
  arc1 = sketch2::arc(start = [var -5.75mm, var 3.97mm], end = [var -10.28mm, var 0.32mm], center = [var 0.75mm, var -8.72mm])
  sketch2::coincident([arcToSplit.end, line2])
  sketch2::coincident([arc1.start, line1])
  sketch2::coincident([
    lineCoincidentWithArcCen.start,
    arc1.center
  ])
sketch2::distance([arc1.center, line4.end]) == 20mm
  sketch2::coincident([arc1.center, line3])
}
`

    expect(result.kclSource.text).toBe(expectedCode)
  })

  it('Trimming arcs should preserve distance constraints that reference other segments', async () => {
    const baseKclCode = `@settings(experimentalFeatures = allow)

sketch(on = YZ) {
  arc1 = sketch2::arc(start = [var 0.87mm, var 2.9mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = sketch2::line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = sketch2::line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
sketch2::distance([arc1.center, line2.start]) == 3.87mm
  line3 = sketch2::line(start = [var -5.61mm, var 5.38mm], end = [var 1.03mm, var 5.53mm])
  line4 = sketch2::line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  sketch2::coincident([line3.end, line4.start])
  line5 = sketch2::line(start = [var -1.05mm, var 6.42mm], end = [var -0.77mm, var 4.73mm])
sketch2::distance([line4.end, line3.start]) == 11.98mm
}
`

    const trimPoints: Coords2d[] = [
      [0.24, 6.57],
      [-1.66, 3.78],
      [-1.57, 1.03],
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
  arc1 = sketch2::arc(start = [var -3.89mm, var 1.85mm], end = [var -5.31mm, var -1.34mm], center = [var -0.65mm, var -1.5mm])
  line1 = sketch2::line(start = [var -4.72mm, var 3.54mm], end = [var -2.24mm, var -1.48mm])
  line2 = sketch2::line(start = [var 2.27mm, var -4.04mm], end = [var 4.65mm, var -1.26mm])
sketch2::distance([arc1.center, line2.start]) == 3.87mm
  line3 = sketch2::line(start = [var -5.61mm, var 5.38mm], end = [var -0.9mm, var 5.49mm])
  line4 = sketch2::line(start = [var 1.03mm, var 5.53mm], end = [var 6.15mm, var 3.11mm])
  line5 = sketch2::line(start = [var -1.05mm, var 6.42mm], end = [var -0.77mm, var 4.73mm])
sketch2::distance([line4.end, line3.start]) == 11.98mm
  sketch2::coincident([line3.end, line5])
  sketch2::coincident([arc1.start, line1])
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
      expect(durationMs).toBeLessThan(7_000)
    }
  )
})

*/