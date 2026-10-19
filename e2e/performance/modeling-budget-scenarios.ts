import { OrthographicCamera, Quaternion, Vector3 } from 'three'

import type {
  BudgetFixtures,
  BudgetScenario,
} from '@e2e/performance/budget-scenarios'
import { prepareModeling } from '@e2e/performance/scenarios'
import { expect } from '@e2e/performance/test'
import { modelingInteractions } from '@src/lib/interactionPerformance/modelingOutcomes'

// Use the project version, matching the shared fixture, so the existing CPU
// workload can retain its own version settings without a mixed-version error.
type ModelingPlane = 'XY' | 'offsetPlane(XY, offset = -200)'
function modelingCode(plane: ModelingPlane = 'XY') {
  return `@settings(defaultLengthUnit = mm)
baseSketch = sketch(on = ${plane}) {
  line1 = line(start = [var -10, var -10], end = [var 10, var -10])
  line2 = line(start = [var 10, var -10], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -10, var 10])
  line4 = line(start = [var -10, var 10], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
boxVisible = extrude(region(point = [0, 0], sketch = baseSketch), length = 10)
hide(baseSketch)
`
}

async function prepareSolid(fixtures: BudgetFixtures, plane?: ModelingPlane) {
  await prepareModeling(fixtures, { code: modelingCode(plane) })
  await fixtures.page.waitForFunction(() => {
    const editor = window.app.project?.executingEditor.value
    return Boolean(
      editor &&
        !editor.isExecutingSignal.value &&
        editor.modelingState?.matches('idle')
    )
  })
}

export async function prepareIsolatedSolid(fixtures: BudgetFixtures) {
  await prepareSolid(fixtures, 'offsetPlane(XY, offset = -200)')
  await fixtures.scene.moveCameraTo(
    fixtures.modelProfile === 'small'
      ? { x: 0, y: 0, z: -150 }
      : { x: 80, y: -80, z: -120 },
    { x: 0, y: 0, z: -195 }
  )
  await fixtures.scene.getCameraInfo()
}

async function preparePlaneSelection(fixtures: BudgetFixtures) {
  await prepareSolid(fixtures)
  await fixtures.toolbar.openFeatureTreePane()
  await fixtures.toolbar.startSketchBtn.click()
  await expect(
    fixtures.page.getByRole('button', { name: 'Top plane XY', exact: true })
  ).toBeEnabled()
}

async function selectTopPlane({ page }: BudgetFixtures) {
  await page.getByRole('button', { name: 'Top plane XY', exact: true }).click()
}

async function verifySketch({ page, toolbar }: BudgetFixtures) {
  await expect(toolbar.exitSketchBtn).toBeEnabled()
  await expect(toolbar.lineBtn).toBeEnabled()
  await page.waitForFunction(() =>
    window.app.project?.executingEditor.value?.modelingState?.matches(
      'sketchSolveMode'
    )
  )
}

async function prepareCube(fixtures: BudgetFixtures) {
  await prepareSolid(fixtures)
  await fixtures.scene.clickGizmoMenuItem('Use cube gizmo')
  await expect(
    fixtures.page.getByTestId('gizmo').locator('canvas')
  ).toBeVisible()
  // Normal engine-backed fixture setup, outside the measured input. All three
  // front/right/top targets must face the viewer before the trusted canvas click.
  await fixtures.scene.moveCameraTo(
    { x: 80, y: -80, z: 80 },
    { x: 0, y: 0, z: 5 }
  )
  // look_at updates the engine stream; requesting its settings also synchronizes
  // the client camera used to render and raycast the orientation cube.
  await fixtures.scene.getCameraInfo()
}

async function clickCubeTarget({ page }: BudgetFixtures, point: Vector3) {
  const canvas = page.getByTestId('gizmo').locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The cube gizmo canvas has no bounding box')
  const orientation = await page.evaluate(() => {
    const quaternion =
      window.app.singletons.kclManager.sceneInfra.camControls.camera.quaternion
    return {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    }
  })
  // Project a point on the actual cube mesh into its canvas. Mesh scale and
  // orthographic zoom match GizmoRenderer; no DOM target or event is synthesized.
  const camera = new OrthographicCamera()
  camera.zoom = 1.4
  camera.quaternion.copy(
    new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
  )
  camera.position.set(0, 0, 2.2).applyQuaternion(camera.quaternion)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const projected = point.clone().multiplyScalar(1.05).project(camera)
  await page.mouse.move(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2
  )
  await page.mouse.down()
  await page.mouse.up()
}

function verifyCube(direction: Vector3) {
  const expected = { x: direction.x, y: direction.y, z: direction.z }
  return async ({ page }: BudgetFixtures) => {
    await page.waitForFunction((expected) => {
      const controls = window.app.singletons.kclManager.sceneInfra.camControls
      const direction = controls.camera.position
        .clone()
        .sub(controls.target)
        .normalize()
      return (
        Math.abs(direction.x - expected.x) < 0.001 &&
        Math.abs(direction.y - expected.y) < 0.001 &&
        Math.abs(direction.z - expected.z) < 0.001 &&
        controls.syncDirection === 'engineToClient' &&
        controls.enableRotate
      )
    }, expected)
  }
}

export const modelingBudgetScenarios: BudgetScenario[] = [
  {
    definition: modelingInteractions.sketchPlaneEnter,
    unavailableWithErrors:
      'Creating a new sketch requires a valid editable AST.',
    prepare: preparePlaneSelection,
    act: selectTopPlane,
    verify: verifySketch,
  },
  {
    definition: modelingInteractions.sketchFaceEnter,
    unavailableWithErrors:
      'Creating a face sketch requires a valid editable AST.',
    prepare: async (fixtures) => {
      const large = fixtures.modelProfile !== 'small'
      // Keep the target box clear of the loaded cooler's mounting base.
      await prepareSolid(
        fixtures,
        large ? 'offsetPlane(XY, offset = -200)' : 'XY'
      )
      await fixtures.scene.moveCameraTo(
        {
          x: 80,
          y: -80,
          z: large ? -120 : 80,
        },
        { x: 0, y: 0, z: large ? -195 : 5 }
      )
      if (large) {
        await fixtures.scene.getCameraInfo()
      }
      await fixtures.toolbar.startSketchBtn.click()
    },
    act: async ({ scene, page }) => {
      const point = await scene.convertPagePositionToStream(0.5, 0.5, 'ratio')
      await page.mouse.click(point.x, point.y)
    },
    verify: async (fixtures) => {
      await verifySketch(fixtures)
      await fixtures.editor.expectEditor.toContain('faceOf(boxVisible,')
    },
  },
  {
    definition: modelingInteractions.sketchExistingEdit,
    unavailableWithErrors:
      'Cached sketches are deliberately read-only after a parse error.',
    prepare: async (fixtures) => {
      await prepareSolid(fixtures)
      const operation = await fixtures.toolbar.getFeatureTreeOperation(
        'baseSketch',
        0
      )
      await expect(operation).toBeEnabled()
    },
    act: async ({ toolbar }) => {
      const operation = await toolbar.getFeatureTreeOperation('baseSketch', 0)
      await operation.dblclick()
    },
    verify: verifySketch,
  },
  {
    definition: modelingInteractions.cubeFace,
    prepare: prepareCube,
    act: (fixtures) => clickCubeTarget(fixtures, new Vector3(0, -0.5, 0)),
    verify: verifyCube(new Vector3(0, -1, 0)),
  },
  {
    definition: modelingInteractions.cubeEdge,
    prepare: prepareCube,
    act: (fixtures) => clickCubeTarget(fixtures, new Vector3(0, -0.44, 0.44)),
    verify: verifyCube(new Vector3(0, -1, 1).normalize()),
  },
  {
    definition: modelingInteractions.cubeCorner,
    prepare: prepareCube,
    act: (fixtures) => clickCubeTarget(fixtures, new Vector3(0.4, -0.4, 0.4)),
    verify: verifyCube(new Vector3(1, -1, 1).normalize()),
  },
  {
    definition: modelingInteractions.sceneDimmingEnter,
    unavailableWithErrors:
      'Entering sketch mode requires a valid editable AST.',
    prepare: preparePlaneSelection,
    act: selectTopPlane,
    verify: verifySketch,
  },
  {
    definition: modelingInteractions.sceneDimmingExit,
    unavailableWithErrors:
      'Preparing sketch-mode exit requires a valid editable AST.',
    prepare: async (fixtures) => {
      await preparePlaneSelection(fixtures)
      await selectTopPlane(fixtures)
      await verifySketch(fixtures)
      await fixtures.page
        .getByTestId('client-side-scene')
        .evaluate(async (scene) => {
          await Promise.all(
            scene.getAnimations().map((animation) => animation.finished)
          )
        })
    },
    act: async ({ toolbar }) => {
      await toolbar.exitSketchBtn.click()
    },
    verify: async ({ toolbar }) => {
      await expect(toolbar.startSketchBtn).toBeEnabled()
      await expect(toolbar.exitSketchBtn).toBeHidden()
    },
  },
]
