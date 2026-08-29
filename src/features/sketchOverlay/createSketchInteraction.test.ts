import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { SketchSessionService } from '@src/contracts/sketchSession'
import type { OpenSketch } from '@src/contracts/sketchSession'
import type { SketchToolState } from '@src/lib/sketch/tools'
import { createSketchInteraction } from '@src/features/sketchOverlay/createSketchInteraction'

const plane = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
}

const pointer = (type: string, x = 40, y = 60, button = 0) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event as unknown as PointerEvent
}

function setup(
  options: { open?: OpenSketch | null; tool?: SketchToolState | null } = {}
) {
  const open = signal<OpenSketch | null>(
    options.open === undefined
      ? { sketchId: 0, name: 's', plane, planeProblem: null }
      : options.open
  )
  const tool = signal<SketchToolState | null>(options.tool ?? null)
  const place = vi.fn()

  const session = { open, tool, place } as unknown as SketchSessionService

  // The identity projection: an element pixel is a plane millimetre, which
  // keeps the arithmetic out of the way of what is being tested.
  const projection = {
    unproject: (at: { x: number; y: number }) => ({ x: at.x, y: at.y }),
  } as unknown as SceneProjection

  const interaction = createSketchInteraction({
    session: () => session,
    projection: () => projection,
  })

  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect

  /*
   * Two listeners on two elements, because in the app they are two interactions
   * at two orders — the tool ahead of the camera, the click swallower behind it.
   * Sharing one element here would test a stacking that does not exist.
   */
  const dispose = interaction.attachTool(element)

  const picked = document.createElement('div')
  picked.getBoundingClientRect = element.getBoundingClientRect
  const disposePick = interaction.attachPick(picked)

  return {
    element,
    picked,
    interaction,
    session,
    tool,
    open,
    place,
    dispose: () => {
      dispose()
      disposePick()
    },
  }
}

describe('createSketchInteraction', () => {
  it('follows the pointer over the plane while a sketch is open', () => {
    const app = setup()

    app.element.dispatchEvent(pointer('pointermove', 12, 34))

    expect(app.interaction.pointer.at.value).toEqual({ x: 12, y: 34 })
  })

  it('knows nothing about the plane when no sketch is open', () => {
    const app = setup({ open: null })

    app.element.dispatchEvent(pointer('pointermove'))

    expect(app.interaction.pointer.at.value).toBeNull()
  })

  it('places a point where a click landed', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })

    app.element.dispatchEvent(pointer('pointerdown', 20, 30))
    app.element.dispatchEvent(pointer('pointerup', 20, 30))

    expect(app.place).toHaveBeenCalledWith({ x: 20, y: 30 })
  })

  /*
   * Letting pointerdown through would start an orbit that the click then
   * finished, so the claim has to happen on the press.
   */
  it('claims the press so the camera does not orbit', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })
    const event = pointer('pointerdown')
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.element.dispatchEvent(event)

    expect(claimed).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the press alone when no tool is equipped', () => {
    const app = setup()
    const event = pointer('pointerdown')
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.element.dispatchEvent(event)
    app.element.dispatchEvent(pointer('pointerup'))

    // Orbiting inside a sketch has to keep working, and the camera starts its
    // drag on the press.
    expect(claimed).not.toHaveBeenCalled()
    expect(app.place).not.toHaveBeenCalled()
  })

  it('does not mistake a drag for a click', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })

    app.element.dispatchEvent(pointer('pointerdown', 20, 30))
    app.element.dispatchEvent(pointer('pointerup', 60, 30))

    expect(app.place).not.toHaveBeenCalled()
  })

  it('ignores buttons that are not the primary one', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })

    app.element.dispatchEvent(pointer('pointerdown', 20, 30, 2))
    app.element.dispatchEvent(pointer('pointerup', 20, 30, 2))

    expect(app.place).not.toHaveBeenCalled()
  })

  it('forgets where the pointer was when it leaves the scene', () => {
    const app = setup()
    app.element.dispatchEvent(pointer('pointermove'))

    app.element.dispatchEvent(pointer('pointerleave'))

    expect(app.interaction.pointer.at.value).toBeNull()
  })

  it('stops listening when the viewport goes away', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })
    app.dispose()

    app.element.dispatchEvent(pointer('pointerdown', 20, 30))
    app.element.dispatchEvent(pointer('pointerup', 20, 30))

    expect(app.place).not.toHaveBeenCalled()
  })
})

describe('clicks that are not drawing', () => {
  /*
   * Selection's answer to a click on nothing is "leave the mode", and leaving
   * the mode now writes the sketch back. A stray click may not finish a sketch.
   */
  it('swallows a click so selection never leaves the mode', () => {
    const app = setup()
    const event = pointer('pointerup')
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.picked.dispatchEvent(event)

    expect(claimed).toHaveBeenCalled()
  })

  it('leaves clicks alone when no sketch is open', () => {
    const app = setup({ open: null })
    const event = pointer('pointerup')
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.picked.dispatchEvent(event)

    expect(claimed).not.toHaveBeenCalled()
  })

  it('leaves a tool’s clicks to the tool', () => {
    const app = setup({ tool: { tool: 'line', points: [] } })
    const event = pointer('pointerup', 20, 30)
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.picked.dispatchEvent(event)

    // The tool's own listener is ahead of the camera and has already taken it.
    expect(claimed).not.toHaveBeenCalled()
  })
})
