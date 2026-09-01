import { getViewExtensionsForMode } from '@src/lib/aiFirstCad/viewExtensions'
import type { EngineSceneViewExtension } from '@src/registry/contracts/engineScene'
import { describe, expect, it, vi } from 'vitest'

const extensions = [
  {
    id: 'engine-scene.toolbar',
    zone: 'top',
    Component: vi.fn(),
  },
  {
    id: 'engine-scene.gizmo',
    zone: 'bottom-right',
    Component: vi.fn(),
  },
] satisfies EngineSceneViewExtension[]

describe('AI-first CAD view extensions', () => {
  it('hides the modeling toolbar in AI mode', () => {
    expect(
      getViewExtensionsForMode('ai', extensions).map(
        (extension) => extension.id
      )
    ).toEqual(['engine-scene.gizmo'])
  })

  it('hides the gizmo while the AI Canvas grid is visible', () => {
    expect(
      getViewExtensionsForMode('ai', extensions, true).map(
        (extension) => extension.id
      )
    ).toEqual([])
  })

  it('moves the modeling toolbar out of the TradCAD scene', () => {
    expect(
      getViewExtensionsForMode('manual', extensions).map(
        (extension) => extension.id
      )
    ).toEqual(['engine-scene.gizmo'])
  })

  it('moves the modeling toolbar out of the CodeCAD scene', () => {
    expect(
      getViewExtensionsForMode('code', extensions).map(
        (extension) => extension.id
      )
    ).toEqual(['engine-scene.gizmo'])
  })

  it.each(['manual', 'code'] as const)(
    'hides the gizmo while Canvas is visible in %s mode',
    (mode) => {
      expect(
        getViewExtensionsForMode(mode, extensions, true).map(
          (extension) => extension.id
        )
      ).toEqual([])
    }
  )
})
