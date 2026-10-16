import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  EngineSceneViewExtensionOverlay,
  type EngineSceneExtensionContext,
} from '@src/registry/contracts/engineScene'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('keeps side rails between measured top and bottom controls as they resize', () => {
  let topHeight = 32
  let resized: (() => void) | undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const zone = this.dataset.engineSceneViewExtensionZone
      return {
        top: zone === 'bottom' ? 560 : 0,
        bottom: zone === 'top' ? topHeight : 600,
        height: zone === 'top' ? topHeight : 600,
        width: 800,
        left: 0,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
  )
  const context = {} as EngineSceneExtensionContext
  const view = render(
    <EngineSceneViewExtensionOverlay
      {...context}
      extensions={[
        { id: 'toolbar', zone: 'top', Component: () => <div>Toolbar</div> },
        {
          id: 'bottom',
          zone: 'bottom',
          Component: () => <div>Bottom controls</div>,
        },
        { id: 'browser', zone: 'left', Component: () => <div>Browser</div> },
      ]}
    />
  )
  const overlay = view.container.firstElementChild as HTMLElement
  expect(overlay.style.getPropertyValue('--scene-top-inset')).toBe('32px')
  expect(overlay.style.getPropertyValue('--scene-bottom-inset')).toBe('40px')
  topHeight = 48
  resized?.()
  expect(overlay.style.getPropertyValue('--scene-top-inset')).toBe('48px')
  expect(overlay.style.getPropertyValue('--scene-bottom-inset')).toBe('40px')
})
