import { cleanup, render, screen } from '@testing-library/react'
import { PerspectiveCamera, Scene } from 'three'
import type * as Three from 'three'
import { Signal } from '@src/lib/signal'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  editor: {},
  style: 'cube',
  renderers: new Map<
    HTMLCanvasElement,
    { dispose: () => void; render: () => void }
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
      render = vi.fn()
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
