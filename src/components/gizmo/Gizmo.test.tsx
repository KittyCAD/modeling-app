import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PerspectiveCamera, Scene, Vector3 } from 'three'
import type * as Three from 'three'
import { Signal } from '@src/lib/signal'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  editor: {},
  style: 'cube',
  renderers: new Map<
    HTMLCanvasElement,
    {
      dispose: () => void
      render: (scene: Three.Scene, camera: Three.Camera) => void
    }
  >(),
}))

vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({ kclManager: mocks.editor }),
  useApp: () => ({
    settings: {
      useSettings: () => ({
        modeling: { gizmoType: { current: mocks.style } },
        app: { allowOrbitInSketchMode: { current: false } },
      }),
    },
  }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: { matches: () => false } }),
}))
vi.mock('@src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'light',
}))
vi.mock('@src/components/ViewControlMenu', () => ({
  useViewControlMenuItems: () => [],
  ViewControlContextMenu: () => null,
}))
vi.mock('@src/components/CustomIcon', () => ({ CustomIcon: () => null }))
vi.mock('@src/components/gizmo/GizmoRenderer', () => ({
  default: class {
    dispose = vi.fn()
    render = vi.fn()
    setTheme = vi.fn()
    setDisabled = vi.fn()
    constructor(canvas: HTMLCanvasElement) {
      // A lost WebGL context must never be handed to a replacement renderer.
      expect(mocks.renderers.has(canvas)).toBe(false)
      mocks.renderers.set(canvas, this)
    }
  },
}))
vi.mock('three', async () => {
  const original = await vi.importActual<typeof Three>('three')
  return {
    ...original,
    WebGLRenderer: class {
      dispose = vi.fn()
      forceContextLoss = vi.fn()
      setSize = vi.fn()
      setPixelRatio = vi.fn()
      render = vi.fn((scene: Three.Scene, camera: Three.Camera) => {
        scene.updateMatrixWorld()
        camera.updateMatrixWorld()
      })
      constructor({ canvas }: { canvas: HTMLCanvasElement }) {
        expect(mocks.renderers.has(canvas)).toBe(false)
        mocks.renderers.set(canvas, this)
      }
    },
  }
})

import Gizmo from '@src/components/gizmo/Gizmo'

function createScene() {
  return {
    scene: new Scene(),
    camControls: {
      camera: new PerspectiveCamera(),
      cameraChange: new Signal(),
    },
  }
}

afterEach(() => {
  cleanup()
  mocks.renderers.clear()
})

it.each(['cube', 'axis'])(
  'replaces the %s canvas only when its scene changes',
  (style) => {
    mocks.style = style
    const first = createScene()
    const removeListener = vi.spyOn(first.camControls.cameraChange, 'remove')
    const editor = { sceneInfra: first }
    mocks.editor = editor
    const mounted = render(<Gizmo />)
    const firstCanvas = screen
      .getByLabelText('View orientation gizmo')
      .querySelector('canvas')
    if (!firstCanvas) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Fail with a useful regression assertion.
      throw new Error('Missing initial gizmo canvas')
    }
    const firstRenderer = mocks.renderers.get(firstCanvas)
    expect(firstRenderer).toBeDefined()

    mounted.rerender(<Gizmo />)
    expect(
      screen.getByLabelText('View orientation gizmo').querySelector('canvas')
    ).toBe(firstCanvas)
    expect(firstRenderer?.dispose).not.toHaveBeenCalled()

    const second = createScene()
    editor.sceneInfra = second
    mounted.rerender(<Gizmo />)
    const secondCanvas = screen
      .getByLabelText('View orientation gizmo')
      .querySelector('canvas')
    if (!secondCanvas) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Fail with a useful regression assertion.
      throw new Error('Missing replacement gizmo canvas')
    }
    expect(secondCanvas).not.toBe(firstCanvas)
    expect(firstCanvas.isConnected).toBe(false)
    expect(firstRenderer?.dispose).toHaveBeenCalledTimes(1)
    const currentRenderer = mocks.renderers.get(secondCanvas)
    expect(currentRenderer).toBeDefined()

    // In particular, Axis must remove its listener from the outgoing scene,
    // even when the same legacy editor now points at the replacement scene.
    if (style === 'axis') {
      expect(removeListener).toHaveBeenCalledTimes(1)
      vi.mocked(firstRenderer!.render).mockClear()
      first.camControls.cameraChange.dispatch()
      expect(firstRenderer?.render).not.toHaveBeenCalled()
    }
    mounted.unmount()
    expect(currentRenderer?.dispose).toHaveBeenCalledTimes(1)
  }
)

function renderAxisGizmo() {
  mocks.style = 'axis'
  const scene = createScene()
  const camera = scene.camControls.camera
  camera.position.set(1, 1, 1)
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 0, 0)
  const updateCameraToAxis = vi.fn().mockResolvedValue(undefined)
  mocks.editor = {
    sceneInfra: {
      ...scene,
      camControls: { ...scene.camControls, updateCameraToAxis },
    },
  }
  render(<Gizmo />)
  const gizmo = screen.getByLabelText('View orientation gizmo')
  const canvas = gizmo.querySelector('canvas')!
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 80,
    bottom: 80,
    width: 80,
    height: 80,
    toJSON: () => ({}),
  })
  return {
    gizmo,
    canvas,
    camera,
    cameraChange: scene.camControls.cameraChange,
    updateCameraToAxis,
  }
}

function axisPointerPosition(
  camera: PerspectiveCamera,
  direction: readonly [number, number, number]
) {
  const point = new Vector3(...direction)
    .multiplyScalar(0.35)
    .applyQuaternion(camera.quaternion.clone().invert())
  return {
    clientX: (point.x + 0.5) * 80,
    clientY: (0.5 - point.y) * 80,
  }
}

it.each([
  ['front', [0, -1, 0], '-y'],
  ['back', [0, 1, 0], 'y'],
  ['left', [-1, 0, 0], '-x'],
  ['right', [1, 0, 0], 'x'],
  ['top', [0, 0, 1], 'z'],
  ['bottom', [0, 0, -1], '-z'],
] as const)(
  'picks %s from the click position without a preceding mousemove',
  (_, direction, axis) => {
    const { gizmo, camera, updateCameraToAxis } = renderAxisGizmo()
    fireEvent.click(gizmo, axisPointerPosition(camera, direction))
    expect(updateCameraToAxis).toHaveBeenCalledExactlyOnceWith(axis)
  }
)

it('refreshes hover and picking when the camera turns under a stationary pointer', () => {
  const { gizmo, canvas, camera, cameraChange, updateCameraToAxis } =
    renderAxisGizmo()
  const pointer = axisPointerPosition(camera, [1, 0, 0])
  fireEvent.mouseMove(gizmo, pointer)
  camera.rotateZ(Math.PI)
  cameraChange.dispatch()
  const renderedScene = vi.mocked(mocks.renderers.get(canvas)!.render).mock
    .lastCall![0]
  expect(renderedScene.getObjectByName('-x')!.scale.x).toBeGreaterThan(
    renderedScene.getObjectByName('x')!.scale.x
  )
  fireEvent.click(gizmo, pointer)
  expect(updateCameraToAxis).toHaveBeenCalledExactlyOnceWith('-x')
})

it('does not reuse the hovered axis when clicking empty space', () => {
  const { gizmo, camera, updateCameraToAxis } = renderAxisGizmo()
  fireEvent.mouseMove(gizmo, axisPointerPosition(camera, [1, 0, 0]))
  fireEvent.click(gizmo, { clientX: 40, clientY: 40 })
  expect(updateCameraToAxis).not.toHaveBeenCalled()
})
