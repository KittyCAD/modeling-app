import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { SketchSessionService } from '@src/contracts/sketchSession'
import type { OpenSketch } from '@src/contracts/sketchSession'
import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
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
  options: {
    open?: OpenSketch | null
    tool?: SketchToolState | null
    graph?: SceneGraph | null
  } = {}
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
    // One pixel per millimetre, to match the identity unprojection above.
    scaleOn: () => 1,
  } as unknown as SceneProjection

  const interaction = createSketchInteraction({
    session: () => session,
    projection: () => projection,
    graph: () => options.graph ?? null,
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

describe('snapping', () => {
  /** A line from (20,20) to (40,20), and the two ends as points. */
  const graph = {
    objects: [
      {
        id: 0,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 20, units: 'Mm' },
              y: { value: 20, units: 'Mm' },
            },
            ctor: null,
            owner: null,
            freedom: 'Free',
            constraints: [],
          },
        },
        label: 'p0',
        comments: '',
        artifact_id: 'a0',
        source: { type: 'Simple', range: [0, 0, 0], node_path: null },
      },
      {
        id: 1,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Point',
            position: {
              x: { value: 40, units: 'Mm' },
              y: { value: 20, units: 'Mm' },
            },
            ctor: null,
            owner: null,
            freedom: 'Free',
            constraints: [],
          },
        },
        label: 'p1',
        comments: '',
        artifact_id: 'a1',
        source: { type: 'Simple', range: [0, 0, 0], node_path: null },
      },
      {
        id: 2,
        kind: {
          type: 'Segment',
          segment: {
            type: 'Line',
            start: 0,
            end: 1,
            ctor: { type: 'Line' },
            ctor_applicable: true,
            construction: false,
          },
        },
        label: 'l1',
        comments: '',
        artifact_id: 'a2',
        source: { type: 'Simple', range: [0, 0, 0], node_path: null },
      },
      {
        id: 3,
        kind: {
          type: 'Sketch',
          args: { on: { default: 'XY' } },
          plane: 9,
          segments: [2],
          constraints: [],
        },
        label: 's',
        comments: '',
        artifact_id: 'a3',
        source: { type: 'Simple', range: [0, 0, 0], node_path: null },
      },
    ],
    sketch_mode: 3,
  } as unknown as SceneGraph

  const drawing = () =>
    setup({
      tool: { tool: 'line', points: [] },
      graph,
      // The sketch is object 3 in the fixture; ids are array indices.
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
    })

  it('places the point on the endpoint it was near, not where the click was', () => {
    const app = drawing()

    // Identity projection, so element pixels are plane millimetres: two
    // millimetres from the end of the line, inside the ten-pixel reach.
    app.element.dispatchEvent(pointer('pointerdown', 22, 20))
    app.element.dispatchEvent(pointer('pointerup', 22, 20))

    expect(app.place).toHaveBeenCalledWith({ x: 20, y: 20 })
  })

  it('reports what it would snap to, so the drawing can mark it', () => {
    const app = drawing()

    app.element.dispatchEvent(pointer('pointermove', 22, 20))

    // The indicator and the click read the same candidate, or one could mark a
    // place the other does not use.
    expect(app.interaction.pointer.snap.value?.target).toEqual({
      type: 'point',
      id: 0,
    })
  })

  it('lets shift mean “near that, not on it”', () => {
    const app = drawing()
    const press = pointer('pointerdown', 22, 20)
    const release = pointer('pointerup', 22, 20)
    Object.defineProperty(press, 'shiftKey', { value: true })
    Object.defineProperty(release, 'shiftKey', { value: true })

    app.element.dispatchEvent(press)
    app.element.dispatchEvent(release)

    expect(app.place).toHaveBeenCalledWith({ x: 22, y: 20 })
  })

  it('places where the pointer is when nothing is in reach', () => {
    const app = drawing()

    app.element.dispatchEvent(pointer('pointerdown', 150, 90))
    app.element.dispatchEvent(pointer('pointerup', 150, 90))

    expect(app.place).toHaveBeenCalledWith({ x: 150, y: 90 })
  })

  it('forgets the candidate when the pointer leaves', () => {
    const app = drawing()
    app.element.dispatchEvent(pointer('pointermove', 22, 20))

    app.element.dispatchEvent(pointer('pointerleave'))

    expect(app.interaction.pointer.snap.value).toBeNull()
  })
})
