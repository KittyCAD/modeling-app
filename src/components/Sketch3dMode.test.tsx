import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera } from 'three'

const mocks = vi.hoisted(() => ({
  manager: {
    id: 1,
    code: '',
    isExecuting: false,
    ast: { body: [] as unknown[] },
    execState: { spatialSketches: [] as unknown[] },
    updateCodeEditor: vi.fn(),
    sceneInfra: {
      baseUnitMultiplier: 1,
      baseUnitChange: { add: vi.fn(), remove: vi.fn() },
      scene: { add: vi.fn(), remove: vi.fn() },
      renderer: { domElement: null as HTMLCanvasElement | null },
      camControls: { camera: null as PerspectiveCamera | null },
    },
  },
}))
vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({ kclManager: mocks.manager }),
}))

import { Sketch3dMode } from '@src/components/Sketch3dMode'
import { sketch3dEditRequest } from '@src/lib/sketch3dMode'

describe('3D sketch mode source edits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.manager.code = ''
    mocks.manager.ast.body = []
    mocks.manager.execState.spatialSketches = []
    mocks.manager.sceneInfra.baseUnitMultiplier = 1
    mocks.manager.sceneInfra.renderer.domElement =
      document.createElement('canvas')
    sketch3dEditRequest.value = null
  })
  afterEach(cleanup)

  it('creates a sketch3d block using the editor history and execution flow', () => {
    render(<Sketch3dMode disabled={false} onActiveChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '3D sketch' }))
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(mocks.manager.updateCodeEditor).toHaveBeenCalledWith(
      expect.stringContaining('sketch3d1 = sketch3d() {'),
      expect.objectContaining({
        shouldExecute: true,
        shouldWriteToDisk: true,
        shouldAddToHistory: true,
      })
    )
    expect(mocks.manager.updateCodeEditor.mock.calls[0][0]).not.toContain('|>')
  })

  it('inserts geometry correctly when preceding comments have multibyte characters', () => {
    const code = '// π\nsketch3d1 = sketch3d() {\n}\n'
    mocks.manager.code = code
    mocks.manager.ast.body = [
      {
        type: 'VariableDeclaration',
        declaration: {
          id: { name: 'sketch3d1' },
          init: {
            type: 'SketchBlock',
            spatial: true,
            start: new TextEncoder().encode(
              code.slice(0, code.indexOf('sketch3d()'))
            ).length,
            end: new TextEncoder().encode(code.trimEnd()).length,
            body: { items: [] },
          },
        },
      },
    ]
    render(<Sketch3dMode disabled={false} onActiveChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '3D sketch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add geometry' }))
    expect(mocks.manager.updateCodeEditor.mock.calls[0][0]).toBe(
      '// π\nsketch3d1 = sketch3d() {\n  line1 = line(start = [var 0mm, var 0mm, var 0mm], end = [var 10mm, var 0mm, var 0mm])\n}\n'
    )
  })

  it('does not allow geometry edits while modeling is disabled', () => {
    render(<Sketch3dMode disabled onActiveChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '3D sketch' })).toBeDisabled()
    expect(mocks.manager.updateCodeEditor).not.toHaveBeenCalled()
  })

  it('draws in millimeters when the viewport uses centimeters', () => {
    const code = 's = sketch3d() {\n}\n'
    mocks.manager.code = code
    mocks.manager.ast.body = [
      {
        type: 'VariableDeclaration',
        declaration: {
          id: { name: 's' },
          init: {
            type: 'SketchBlock',
            spatial: true,
            start: 4,
            end: code.trimEnd().length,
            body: { items: [] },
          },
        },
      },
    ]
    mocks.manager.sceneInfra.baseUnitMultiplier = 10
    const camera = new PerspectiveCamera(90, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.updateMatrixWorld()
    mocks.manager.sceneInfra.camControls.camera = camera
    const canvas = mocks.manager.sceneInfra.renderer.domElement!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    document.body.append(canvas)
    render(<Sketch3dMode disabled={false} onActiveChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '3D sketch' }))
    fireEvent.change(screen.getByLabelText('3D geometry tool'), {
      target: { value: 'point' },
    })
    fireEvent.change(screen.getByLabelText('Offset (mm)'), {
      target: { value: '20' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Draw in view' }))
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 75,
        clientY: 50,
        button: 0,
      })
    )
    fireEvent(
      canvas,
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 75,
        clientY: 50,
        button: 0,
      })
    )
    expect(mocks.manager.updateCodeEditor).toHaveBeenCalledWith(
      expect.stringContaining('point(at = [var 40mm, var 0mm, var 20mm])'),
      expect.anything()
    )
    canvas.remove()
  })
})
