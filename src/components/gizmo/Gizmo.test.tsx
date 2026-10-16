import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  editor: {},
  theme: 'light',
  sketch: false,
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ state: { matches: () => mocks.sketch } }),
}))
vi.mock('@src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => mocks.theme,
}))
vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({ kclManager: mocks.editor }),
  useApp: () => ({
    settings: {
      useSettings: () => ({
        app: { allowOrbitInSketchMode: { current: false } },
      }),
    },
  }),
}))
vi.mock('@src/components/ViewControlMenu', () => ({
  ViewControlContextMenu: () => null,
}))

import CubeGizmo from '@src/components/gizmo/CubeGizmo'
import AxisGizmo from '@src/components/gizmo/AxisGizmo'

function createScene() {
  const renderer = {
    canvas: document.createElement('canvas'),
    setTheme: vi.fn(),
    setDisabled: vi.fn(),
    dispose: vi.fn(),
  }
  return {
    renderer,
    getCubeGizmo: vi.fn(() => renderer),
    getAxisGizmo: vi.fn(() => renderer),
  }
}

afterEach(() => {
  cleanup()
  mocks.theme = 'light'
  mocks.sketch = false
  vi.clearAllMocks()
})

it.each([
  { Gizmo: CubeGizmo, strict: false },
  { Gizmo: CubeGizmo, strict: true },
  { Gizmo: AxisGizmo, strict: false },
  { Gizmo: AxisGizmo, strict: true },
])(
  'attaches scene-owned gizmos without disposing on view cleanup ($Gizmo.name, StrictMode: $strict)',
  ({ Gizmo, strict }) => {
    const first = createScene()
    mocks.editor = { sceneInfra: first }
    const view = () =>
      strict ? (
        <StrictMode>
          <Gizmo />
        </StrictMode>
      ) : (
        <Gizmo />
      )
    const mounted = render(view())
    const wrapper = screen.getByLabelText('View orientation gizmo')
    expect(wrapper.querySelectorAll('canvas')).toHaveLength(1)
    expect(wrapper.querySelector('canvas')).toBe(first.renderer.canvas)
    expect(first.renderer.dispose).not.toHaveBeenCalled()

    const second = createScene()
    mocks.editor = { sceneInfra: second }
    mounted.rerender(view())
    expect(screen.getByLabelText('View orientation gizmo')).toBe(wrapper)
    expect(wrapper.querySelector('canvas')).toBe(second.renderer.canvas)
    expect(first.renderer.canvas.isConnected).toBe(false)
    expect(first.renderer.dispose).not.toHaveBeenCalled()

    mocks.sketch = true
    mounted.rerender(view())
    expect(second.renderer.setDisabled).toHaveBeenLastCalledWith(true)
    mounted.unmount()
    expect(second.renderer.canvas.isConnected).toBe(false)
    expect(second.renderer.dispose).not.toHaveBeenCalled()

    render(view())
    expect(
      screen.getByLabelText('View orientation gizmo').querySelector('canvas')
    ).toBe(second.renderer.canvas)
    expect(second.renderer.dispose).not.toHaveBeenCalled()
  }
)
