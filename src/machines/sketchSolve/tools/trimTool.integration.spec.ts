import { describe, it, expect } from 'vitest'
import { processTrimOperations } from '@src/machines/sketchSolve/tools/trimTool'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { assertParse } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { Vector3 } from 'three'

const sketchBlockCode = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.325mm, var 6.223mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.934mm, var -2.413mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.762mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.11mm, var -6.95mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.414mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.762mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.556mm, var 7.366mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.016mm, var 8.382mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.318mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
}
`

describe('processTrimOperations', () => {
  it('should handle basic deletion case', async () => {
    const inputData = {
      points: [
        [-2.51384800194825, -4.214581766012367, 0],
        [-1.126138983414963, -3.761015570302876, 0],
      ],
      sketchId: 0,
    }
    const expectedCodeOutput = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.11mm, var -6.95mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.32mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
}
`
    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )

    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      // Assert the output code matches expected
      expect(result.kclSource.text).toBe(expectedCodeOutput)
      expect(result.kclSource.text).not.toContain('line3')
    }
  })

  it("should handle a case where two segments intersect, and we're looking to trim one of the tails", async () => {
    const inputData = {
      points: [
        [-1.163679889006146, -7.719446800128466, 0],
        [-1.6595876378748984, -7.496341391441752, 0],
      ],
      sketchId: 0,
    }
    const expectedCodeOutput2 = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.96mm, var -8.11mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.32mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
}
`

    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )
    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.kclSource.text).toBe(expectedCodeOutput2)
    }
  })
  it("should handle a case where two segments intersect, and we're trying to trim the tails of both, the end of the segments should become coincident in the process", async () => {
    const inputData = {
      points: [
        [-3.2216970468114705, -7.967341698669259, 0],
        [-1.2628614387798955, -7.570709861003989, 0],
      ],
      sketchId: 0,
      lastPointIndex: 0,
    }

    const expectedCodeOutput2 = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -1.96mm, var -8.11mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.96mm, var -8.11mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.32mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
  sketch2::coincident([line7.start, line6.start])
}
`

    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )
    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.kclSource.text).toBe(expectedCodeOutput2)
      expect(result.kclSource.text).toContain(
        'sketch2::coincident([line7.start, line6.start])'
      )
    }
  })
  it('Should handle the case where segmentA intersects with two separate segments, and we trim segmentA between the two other segment. This should create a new segment because it has to divide the segment in two', async () => {
    const inputData = {
      points: [
        [4.16732841133295, -1.1750214786515234, 0],
        [4.78721309741889, -1.1998109685056033, 0],
      ],
      sketchId: 0,
      lastPointIndex: 0,
    }

    const expectedCodeOutput2 = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 3.65mm, var 1.09mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.11mm, var -6.95mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.32mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
  sketch2::line(start = [var 5.6mm, var -3.41mm], end = [var 6.1mm, var -4.57mm])
}
`

    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )
    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.kclSource.text).toBe(expectedCodeOutput2)
    }
  })
  it('Should handle the case where segmentA intersects with 4 separate segments, and we trim segmentA between the first and second, and then the third and fourth other segments such to divide segmentA into three', async () => {
    const inputData = {
      points: [
        [3.9689653117854484, 5.567719761658053, 0],
        [2.555628227509503, 5.666877721074371, 0],
        [2.8283774893873166, 7.724405378962956, 0],
        [4.78721309741889, 7.6500369094007175, 0],
      ],
      sketchId: 0,
      lastPointIndex: 0,
    }

    const expectedCodeOutput2 = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.11mm, var -6.95mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.318mm], end = [var 2.96mm, var 5.08mm])
  line15 = sketch2::line(start = [var -5.38mm, var 7.85mm], end = [var -0.84mm, var 5.52mm])
  line16 = sketch2::line(start = [var -4.66mm, var 6.44mm], end = [var -0.72mm, var 8.24mm])
  line17 = sketch2::line(start = [var -2.48mm, var 8.49mm], end = [var -1.93mm, var 4.85mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
  sketch2::line(start = [var 3.545mm, var 6.136mm], end = [var 4.23mm, var 7.37mm])
  sketch2::line(start = [var 4.79mm, var 8.38mm], end = [var 5.36mm, var 9.42mm])
}
`

    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )
    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.kclSource.text).toBe(expectedCodeOutput2)
    }
  })
  it('Should handle the case where segmentA intersects with 4 separate segments, and we trim segmentA between the first and second, and then the third and fourth other segments such to divide segmentA into three', async () => {
    const inputData = {
      points: [
        [-1.6595876378748984, 8.195405686190462, 0],
        [-1.4116337634405216, 7.674826399254797, 0],
        [-1.4364291508839597, 6.608878335529386, 0],
        [-1.4116337634405216, 5.617298741366213, 0],
        [-2.924152397490219, 5.815614660198847, 0],
        [-3.7176047956802236, 6.336193947134513, 0],
        [-4.238307931992414, 6.906352213778337, 0],
        [-4.560647968757103, 7.278194561589528, 0],
        [-4.6846249059742915, 7.476510480422163, 0],
        [-4.8581926180783555, 7.6500369094007175, 0],
        [-5.006964942738981, 7.8483528282333515, 0],
        [-4.535852581313666, 7.947510787649669, 0],
        [-4.039944832444913, 7.997089767357829, 0],
        [-3.172106271924595, 7.997089767357829, 0],
        [-2.676198523055842, 8.021879257211907, 0],
        [-2.180290774187089, 8.071458236920066, 0],
      ],
      sketchId: 0,
      lastPointIndex: 0,
    }

    const expectedCodeOutput2 = `@settings(experimentalFeatures = allow, defaultLengthUnit = mm)

sketch(on = YZ) {
  line1 = sketch2::line(start = [var -6.32mm, var 6.22mm], end = [var 6.76mm, var -0.51mm])
  line2 = sketch2::line(start = [var 3.1mm, var 2.37mm], end = [var 6.1mm, var -4.57mm])
  line4 = sketch2::line(start = [var 6.93mm, var -2.41mm], end = [var 3.86mm, var -4.72mm])
  line5 = sketch2::line(start = [var -5.08mm, var -0.76mm], end = [var -5.23mm, var -5.31mm])
  line6 = sketch2::line(start = [var -3.81mm, var -7.37mm], end = [var 0mm, var -8.89mm])
  line7 = sketch2::line(start = [var -1.11mm, var -6.95mm], end = [var -2.54mm, var -8.89mm])
  line8 = sketch2::line(start = [var 3.77mm, var -7.25mm], end = [var 4.57mm, var -10.67mm])
  line9 = sketch2::line(start = [var 2.54mm, var -10.41mm], end = [var 5.56mm, var -8.36mm])
  line10 = sketch2::line(start = [var 0.76mm, var 5.08mm], end = [var 3.56mm, var 5.08mm])
  line11 = sketch2::line(start = [var 3.23mm, var 6.14mm], end = [var 6.35mm, var 6.1mm])
  line12 = sketch2::line(start = [var 3.56mm, var 7.37mm], end = [var 6.6mm, var 7.37mm])
  line13 = sketch2::line(start = [var 1.02mm, var 8.38mm], end = [var 6.6mm, var 8.38mm])
  line14 = sketch2::line(start = [var 2.54mm, var 4.32mm], end = [var 5.36mm, var 9.42mm])
  line15 = sketch2::line(start = [var -3.587mm, var 6.93mm], end = [var -2.13mm, var 6.18mm])
  line16 = sketch2::line(start = [var -3.587mm, var 6.93mm], end = [var -2.331mm, var 7.502mm])
  line17 = sketch2::line(start = [var -2.331mm, var 7.502mm], end = [var -2.13mm, var 6.18mm])
  line3 = sketch2::line(start = [var -2.18mm, var -0.77mm], end = [var -1.47mm, var -5.51mm])
  sketch2::coincident([line17.end, line15.end])
  sketch2::coincident([line15.start, line16.start])
  sketch2::coincident([line17.start, line16.end])
}
`

    const { rustContext, instance } = await buildTheWorldAndConnectToEngine()

    // Parse the KCL code to get AST
    const ast = assertParse(sketchBlockCode, instance)

    // Execute the code to get the scene graph
    const { sceneGraph, execOutcome } = await rustContext.hackSetProgram(
      ast,
      await jsAppSettings()
    )
    // Convert SceneGraph to SceneGraphDelta
    const initialSceneGraphDelta: SceneGraphDelta = {
      new_graph: sceneGraph,
      new_objects: [],
      invalidates_ids: false,
      exec_outcome: execOutcome,
    }

    // Convert input points to Vector3 array
    const points = inputData.points.map((p) => new Vector3(p[0], p[1], p[2]))

    // Call processTrimOperations
    const result = await processTrimOperations({
      points,
      initialSceneGraph: initialSceneGraphDelta,
      rustContext,
      sketchId: inputData.sketchId,
      lastPointIndex: 0,
    })

    expect(result).not.toBeNull()
    if (result) {
      expect(result.kclSource.text).toBe(expectedCodeOutput2)
      // expect to find "sketch2::coincident(" three times
      expect(
        (result.kclSource.text.match(/sketch2::coincident\(/g) || []).length
      ).toBe(3)
    }
  })
})
