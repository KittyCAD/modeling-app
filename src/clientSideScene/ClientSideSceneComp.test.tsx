import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mode: 'sketchSolveMode',
  onCameraMoving: (_isMoving: boolean, _isTween: boolean) => {},
  sceneInfra: {
    localRenderer: null as object | null,
    renderer: { domElement: null as HTMLCanvasElement | null },
    labelRenderer: { domElement: null as HTMLDivElement | null },
    camControls: {
      setIsCamMovingCallback: vi.fn(),
      initTouchControls: vi.fn(),
      onWindowResize: vi.fn(),
    },
    updateOtherSelectionColors: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseUp: vi.fn(),
    onCanvasResized: vi.fn(),
    setSend: vi.fn(),
  },
  sceneEntitiesManager: {
    onCamChange: vi.fn(async () => {}),
    tearDownSketch: vi.fn(),
  },
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    state: { matches: (mode: unknown) => mode === mocks.mode },
    context: {
      mouseState: { type: 'idle' },
      segmentOverlays: {},
      sketchSolveToolName: null,
    },
    send: vi.fn(),
  }),
}))

vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({
    kclManager: {
      sceneInfra: mocks.sceneInfra,
      sceneEntitiesManager: mocks.sceneEntitiesManager,
      engineCommandManager: {},
    },
  }),
}))

vi.mock('@src/clientSideScene/ConstraintBadgeTooltipOverlay', () => ({
  ConstraintBadgeTooltipOverlay: () => null,
}))
vi.mock('@src/clientSideScene/EditingConstraintInput', () => ({
  EditingConstraintInput: () => null,
}))
vi.mock('@src/machines/sketchSolve/sketchSolveImpl', () => ({
  cleanupSketchSolveGroup: vi.fn(),
}))
vi.mock('@src/lib/toolbar', () => ({
  useToolbarConfig: () => [],
  getSketchSolveToolIconMap: () => ({}),
}))
vi.mock('@src/lib/cameraControls', () => ({
  cameraMouseDragGuards: { Zoo: {} },
}))
vi.mock('@src/lib/utils', () => ({
  throttle: (callback: unknown) => callback,
  toSync: (callback: unknown) => callback,
}))
vi.mock('@src/lang/modifyAst', () => ({}))
vi.mock('@src/lang/queryAst', () => ({}))
vi.mock('@src/lang/std/sketch', () => ({}))
vi.mock('@src/lang/std/sketchcombos', () => ({}))
vi.mock('@src/lang/util', () => ({}))
vi.mock('@src/lang/wasm', () => ({}))

function renderScene(sketchSolveDimming = 0.3) {
  render(
    <ClientSideScene
      cameraControls="Zoo"
      enableTouchControls={false}
      sketchSolveDimming={sketchSolveDimming}
    />
  )
  return screen.getByTestId('client-side-scene')
}

function opacity(scene: HTMLElement) {
  return scene.style.getPropertyValue('--tw-bg-opacity')
}

describe('client scene visibility during camera movement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode = 'sketchSolveMode'
    mocks.sceneInfra.localRenderer = null
    mocks.sceneInfra.renderer.domElement = document.createElement('canvas')
    mocks.sceneInfra.labelRenderer.domElement = document.createElement('div')
    mocks.sceneInfra.camControls.setIsCamMovingCallback.mockImplementation(
      (callback) => {
        mocks.onCameraMoving = callback
      }
    )
  })

  afterEach(cleanup)

  it.each(['Sketch', 'sketchSolveMode'])(
    'hides the client overlay, not the streamed solid, during animations in %s',
    (mode) => {
      mocks.mode = mode
      const scene = renderScene()

      act(() => mocks.onCameraMoving(true, true))
      expect(scene).toHaveClass('opacity-0')
      expect(scene).not.toHaveClass('bg-chalkboard-10')
      expect(opacity(scene)).toBe('')

      act(() => mocks.onCameraMoving(false, true))
      expect(scene).toHaveClass('opacity-100', 'bg-chalkboard-10')
      expect(opacity(scene)).toBe(mode === 'Sketch' ? '0.8' : '0.3')
    }
  )

  it.each(['Sketch', 'sketchSolveMode'])(
    'hides the streamed solid, not the client sketch, during manual movement in %s',
    (mode) => {
      mocks.mode = mode
      const scene = renderScene()

      act(() => mocks.onCameraMoving(true, false))
      expect(scene).toHaveClass('opacity-100', 'bg-chalkboard-10')
      expect(opacity(scene)).toBe('1')

      act(() => mocks.onCameraMoving(false, false))
      expect(opacity(scene)).toBe(mode === 'Sketch' ? '0.8' : '0.3')
    }
  )

  it.each(['Sketch', 'sketchSolveMode'])(
    'keeps the local solid and sketch visible during drags and animations in %s',
    (mode) => {
      mocks.mode = mode
      mocks.sceneInfra.localRenderer = {}
      const scene = renderScene()

      for (const isTween of [false, true]) {
        act(() => mocks.onCameraMoving(true, isTween))
        expect(scene).toHaveClass('opacity-100', 'bg-chalkboard-10')
        expect(opacity(scene)).toBe(mode === 'Sketch' ? '0.8' : '0.3')
        act(() => mocks.onCameraMoving(false, isTween))
      }
    }
  )

  it('hides the client overlay during streamed movement outside sketch mode', () => {
    mocks.mode = 'idle'
    const scene = renderScene()

    act(() => mocks.onCameraMoving(true, false))
    expect(scene).toHaveClass('opacity-0')
    expect(scene).not.toHaveClass('bg-chalkboard-10')

    act(() => mocks.onCameraMoving(false, false))
    expect(scene).toHaveClass('opacity-100')
  })

  it('keeps the local client scene visible and undimmed outside sketch mode', () => {
    mocks.mode = 'idle'
    mocks.sceneInfra.localRenderer = {}
    const scene = renderScene()

    for (const isTween of [false, true]) {
      act(() => mocks.onCameraMoving(true, isTween))
      expect(scene).toHaveClass('opacity-100')
      expect(scene).not.toHaveClass('bg-chalkboard-10')
      expect(opacity(scene)).toBe('')
      act(() => mocks.onCameraMoving(false, isTween))
    }
  })

  it.each([0, 0.3, 1])(
    'keeps legacy dimming at 0.8 when sketch-solve dimming is %s',
    (dimming) => {
      mocks.mode = 'Sketch'
      const scene = renderScene(dimming)
      expect(opacity(scene)).toBe('0.8')
    }
  )
})
