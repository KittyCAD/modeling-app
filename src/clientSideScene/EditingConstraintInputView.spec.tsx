import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { Group, OrthographicCamera, Sprite, SpriteMaterial } from 'three'
import { createActor, fromTransition } from 'xstate'
import {
  afterEach,
  assert,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'

vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: vi.fn(),
  useSingletons: vi.fn(),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    state: { children: { sketchSolveMachine: sketch } },
  }),
}))

import { EditingConstraintInputView } from '@src/clientSideScene/EditingConstraintInputView'
import { DISTANCE_CONSTRAINT_LABEL } from '@src/clientSideScene/sceneConstants'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { createTestSettings } from '@src/lib/kcl/testFixtures'
import { createSettings } from '@src/lib/settings/initialSettings'
import * as settingsUtils from '@src/lib/settings/settingsUtils'
import * as constraintUtils from '@src/machines/sketchSolve/constraints/constraintUtils'
import { buildModelingMachineInput } from '@src/unitTestUtils'

interface SketchContext {
  editingConstraintId: number | undefined
  sketchId: number
  sketchExecOutcome: {
    sceneGraphDelta: { new_graph: { objects: ApiObject[] } }
  }
}
type SketchEvent =
  | { type: 'edit'; id: number | undefined }
  | { type: 'stop editing constraint' }

function createSketch(objects: ApiObject[], editingConstraintId?: number) {
  const context: SketchContext = {
    editingConstraintId,
    sketchId: 10,
    sketchExecOutcome: { sceneGraphDelta: { new_graph: { objects } } },
  }
  return createActor(
    fromTransition(
      (current: SketchContext, event: SketchEvent) => ({
        ...current,
        editingConstraintId: event.type === 'edit' ? event.id : undefined,
      }),
      context
    )
  ).start()
}
let sketch: ReturnType<typeof createSketch>

const connectToEngine = vi.fn<ConnectionManager['start']>()

beforeEach(() => {
  vi.spyOn(settingsUtils, 'loadAndValidateSettings').mockResolvedValue({
    settings: createSettings(),
    configuration: {},
  })
  connectToEngine
    .mockReset()
    .mockRejectedValue(
      new Error('This component test must not connect to an engine')
    )
  vi.spyOn(ConnectionManager.prototype, 'start').mockImplementation(
    connectToEngine
  )
})
afterEach(() => {
  cleanup()
  expect(connectToEngine).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

function radius(id: number, expression: string): ApiObject {
  return {
    id,
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Radius',
        arc: 2,
        radius: { value: 5, units: 'Mm' },
        source: { expr: expression, is_literal: false },
      },
    },
  }
}

async function openEditor(editingConstraintId: number | undefined) {
  const world = await buildModelingMachineInput()
  const objects: ApiObject[] = []
  objects[0] = radius(0, 'width / 2')
  objects[7] = radius(7, '5mm')
  objects[8] = radius(8, 'radius')
  const actor = createSketch(objects, editingConstraintId)
  sketch = actor
  onTestFinished(() => {
    actor.stop()
  })
  const sent = vi.spyOn(sketch, 'send')
  const { sceneInfra } = world.kclManager
  const canvas = sceneInfra.renderer.domElement
  Object.defineProperties(canvas, {
    clientWidth: { value: 400 },
    clientHeight: { value: 200 },
  })
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.updateMatrixWorld(true)
  sceneInfra.camControls.camera = camera
  const group = new Group()
  group.name = 'sketchSolveGroup'
  const material = new SpriteMaterial()
  onTestFinished(() => material.dispose())
  for (const [id, x, y] of [
    [0, 0, 0],
    [7, 0, 0],
    [8, 1, 1],
  ]) {
    const constraint = new Group()
    constraint.name = String(id)
    const label = new Sprite(material)
    label.userData.type = DISTANCE_CONSTRAINT_LABEL
    label.position.set(x, y, 0)
    constraint.add(label)
    group.add(constraint)
  }
  sceneInfra.scene.getObjectByName('sketchSolveGroup')?.removeFromParent()
  sceneInfra.scene.add(group)
  const settings = createTestSettings()
  let unmount = () => {}
  await act(async () => {
    const mounted = render(
      <Suspense fallback={<p>Loading input</p>}>
        <EditingConstraintInputView
          kclManager={world.kclManager}
          settings={settings}
        />
      </Suspense>
    )
    unmount = mounted.unmount
  })
  const edit = (id: number | undefined) =>
    act(() => sketch.send({ type: 'edit', id }))
  return {
    edit,
    sent,
    camera,
    cameraChanged: () =>
      act(() => sceneInfra.camControls.cameraChange.dispatch()),
    unmount,
  }
}

function inputPosition() {
  const container = screen
    .getByRole('textbox')
    .closest('.cm-editor')?.parentElement
  assert(container, 'Expected the positioned input container')
  return { left: container.style.left, top: container.style.top }
}

it('shows an input when constraint editing starts and hides it when editing ends', async () => {
  const editor = await openEditor(undefined)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  editor.edit(7)
  expect(screen.getByRole('textbox')).toHaveTextContent('5mm')
  editor.edit(undefined)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it.each([
  { id: 0, expression: 'width / 2' },
  { id: 7, expression: '5mm' },
  { id: 8, expression: 'radius' },
])(
  'starts constraint $id with its source expression, $expression',
  async ({ id, expression }) => {
    await openEditor(id)
    const input = screen.getByRole('textbox')
    expect(input).toHaveTextContent(expression)
    expect(input).toHaveFocus()
  }
)

it('positions the input over its label and follows camera movement', async () => {
  const editor = await openEditor(7)
  expect(inputPosition()).toEqual({ left: '200px', top: '100px' })
  editor.camera.position.x = 1
  editor.camera.updateMatrixWorld(true)
  editor.cameraChanged()
  expect(inputPosition()).toEqual({ left: '100px', top: '100px' })
})

it('follows the newly edited constraint when the camera moves', async () => {
  const editor = await openEditor(7)
  editor.edit(8)
  expect(inputPosition()).toEqual({ left: '300px', top: '50px' })
  editor.camera.position.x = 1
  editor.camera.updateMatrixWorld(true)
  editor.cameraChanged()
  expect(inputPosition()).toEqual({ left: '200px', top: '50px' })
})

it('cancels editing with Escape', async () => {
  const editor = await openEditor(7)
  fireEvent.keyDown(screen.getByRole('textbox'), {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
  })
  expect(editor.sent).toHaveBeenCalledWith({ type: 'stop editing constraint' })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('allows camera panning with the middle button and cancels on an outside primary click', async () => {
  const editor = await openEditor(7)
  fireEvent.pointerDown(screen.getByRole('textbox'), { button: 0 })
  fireEvent.pointerDown(document.body, { button: 1 })
  expect(editor.sent).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox')).toBeInTheDocument()
  fireEvent.pointerDown(document.body, { button: 0 })
  expect(editor.sent).toHaveBeenCalledWith({ type: 'stop editing constraint' })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('stops following the camera when editing ends and resumes when editing starts again', async () => {
  const editor = await openEditor(7)
  const project = vi.spyOn(
    constraintUtils,
    'calculateDimensionLabelScreenPosition'
  )
  editor.edit(undefined)
  editor.cameraChanged()
  expect(project).not.toHaveBeenCalled()
  editor.edit(8)
  project.mockClear()
  editor.camera.position.x = 1
  editor.camera.updateMatrixWorld(true)
  editor.cameraChanged()
  expect(project).toHaveBeenCalledOnce()
  expect(inputPosition()).toEqual({ left: '200px', top: '50px' })
})

it('removes camera and outside-click listeners when unmounted', async () => {
  const editor = await openEditor(7)
  const project = vi.spyOn(
    constraintUtils,
    'calculateDimensionLabelScreenPosition'
  )
  editor.unmount()
  editor.cameraChanged()
  fireEvent.pointerDown(document.body, { button: 0 })
  expect(project).not.toHaveBeenCalled()
  expect(editor.sent).not.toHaveBeenCalled()
})
