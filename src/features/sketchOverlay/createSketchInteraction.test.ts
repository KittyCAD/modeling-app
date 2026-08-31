import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { SketchSessionService } from '@src/contracts/sketchSession'
import type { OpenSketch } from '@src/contracts/sketchSession'
import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchToolId } from '@src/lib/sketch/tools'
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
    tool?: SketchToolId | null
    graph?: SceneGraph | null
  } = {}
) {
  const open = signal<OpenSketch | null>(
    options.open === undefined
      ? { sketchId: 0, name: 's', plane, planeProblem: null }
      : options.open
  )
  const tool = signal<SketchToolId | null>(options.tool ?? null)
  const place = vi.fn()
  const moveTo = vi.fn()
  const finishChain = vi.fn()
  const beginDrag = vi.fn((id: number, at: { x: number; y: number }) => {
    draft.value = { kind: 'dragging', objectId: id, from: at }
  })
  const endDrag = vi.fn(() => {
    draft.value = { kind: 'idle' }
  })
  const draft = signal<{
    kind: string
    pointId?: number
    objectId?: number
    from?: { x: number; y: number }
  }>({ kind: 'idle' })

  const select = vi.fn()
  const clearSelection = vi.fn()
  const cancelTool = vi.fn(() => {
    draft.value = { kind: 'idle' }
  })

  const session = {
    open,
    tool,
    draft,
    place,
    moveTo,
    finishChain,
    beginDrag,
    endDrag,
    select,
    clearSelection,
    cancelTool,
  } as unknown as SketchSessionService

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
    moveTo,
    finishChain,
    beginDrag,
    endDrag,
    select,
    clearSelection,
    cancelTool,
    draft,
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
    const app = setup({ tool: 'line' })

    app.element.dispatchEvent(pointer('pointerdown', 20, 30))
    app.element.dispatchEvent(pointer('pointerup', 20, 30))

    expect(app.place).toHaveBeenCalledWith({ x: 20, y: 30 })
  })

  /*
   * Letting pointerdown through would start an orbit that the click then
   * finished, so the claim has to happen on the press.
   */
  it('claims the press so the camera does not orbit', () => {
    const app = setup({ tool: 'line' })
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
    const app = setup({ tool: 'line' })

    app.element.dispatchEvent(pointer('pointerdown', 20, 30))
    app.element.dispatchEvent(pointer('pointerup', 60, 30))

    expect(app.place).not.toHaveBeenCalled()
  })

  it('ignores buttons that are not the primary one', () => {
    const app = setup({ tool: 'line' })

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
    const app = setup({ tool: 'line' })
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
    const app = setup({ tool: 'line' })
    const event = pointer('pointerup', 20, 30)
    const claimed = vi.spyOn(event, 'stopImmediatePropagation')

    app.picked.dispatchEvent(event)

    // The tool's own listener is ahead of the camera and has already taken it.
    expect(claimed).not.toHaveBeenCalled()
  })
})

/** A line from (20,20) to (40,20), and the two ends as points. */
const sketchGraph = {
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

describe('snapping', () => {
  const graph = sketchGraph

  const drawing = () =>
    setup({
      tool: 'line',
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

describe('the rubber band', () => {
  it('drags the draft to the snapped position, not to the pointer', () => {
    const app = setup({ tool: 'line' })

    app.element.dispatchEvent(pointer('pointermove', 40, 60))

    // A preview that follows the cursor past a snap target lies about where the
    // next click will land.
    expect(app.moveTo).toHaveBeenCalledWith({ x: 40, y: 60 })
  })

  it('says nothing while no tool is equipped', () => {
    const app = setup()

    app.element.dispatchEvent(pointer('pointermove', 40, 60))

    expect(app.moveTo).not.toHaveBeenCalled()
  })

  /*
   * The second click of the pair has already committed a segment, so what a
   * double click says is "and no more" rather than "and one more".
   */
  it('ends the chain on a double click, without placing again', () => {
    const app = setup({ tool: 'line' })
    const press = pointer('pointerdown', 20, 30)
    const release = pointer('pointerup', 20, 30)
    Object.defineProperty(release, 'detail', { value: 2 })

    app.element.dispatchEvent(press)
    app.element.dispatchEvent(release)

    expect(app.finishChain).toHaveBeenCalledTimes(1)
    expect(app.place).not.toHaveBeenCalled()
  })
})

describe('dragging a point', () => {
  /** The line fixture again, with its two ends as grabbable points. */
  const dragSetup = () =>
    setup({
      graph: sketchGraph,
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
    })

  /*
   * The press has to be claimed ahead of the camera, or grabbing a corner also
   * spins the model — which is why this cannot live with the handler that sits
   * behind the camera and swallows clicks.
   */
  it('grabs the point under the pointer, with no tool equipped', () => {
    const app = dragSetup()
    const press = pointer('pointerdown', 20, 20)
    const claimed = vi.spyOn(press, 'stopImmediatePropagation')

    app.element.dispatchEvent(press)

    // The grab position travels with it: translating a body is measured from
    // where it was taken hold of.
    expect(app.beginDrag).toHaveBeenCalledWith(0, { x: 20, y: 20 })
    expect(claimed).toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(true)
  })

  it('leaves the press to the camera when there is no point there', () => {
    const app = dragSetup()
    const press = pointer('pointerdown', 150, 90)
    const claimed = vi.spyOn(press, 'stopImmediatePropagation')

    app.element.dispatchEvent(press)

    expect(app.beginDrag).not.toHaveBeenCalled()
    expect(claimed).not.toHaveBeenCalled()
  })

  it('moves the point as the pointer moves', () => {
    const app = dragSetup()
    app.element.dispatchEvent(pointer('pointerdown', 20, 20))

    app.element.dispatchEvent(pointer('pointermove', 30, 25))

    // Snapped onto the line it is five millimetres from, which is the point of
    // solving as you drag rather than when you let go.
    expect(app.moveTo).toHaveBeenCalledWith({ x: 30, y: 20 })
  })

  /*
   * The point being moved is in the sketch like any other, so without excluding
   * it the drag snaps to where it started and refuses to move.
   */
  it('does not snap the dragged point to itself', () => {
    const app = dragSetup()
    app.element.dispatchEvent(pointer('pointerdown', 20, 20))

    app.element.dispatchEvent(pointer('pointermove', 22, 60))

    expect(app.moveTo).toHaveBeenCalledWith({ x: 22, y: 60 })
  })

  it('commits where it was released, not where the last preview was', () => {
    const app = dragSetup()
    app.element.dispatchEvent(pointer('pointerdown', 20, 20))
    app.element.dispatchEvent(pointer('pointermove', 30, 25))

    app.element.dispatchEvent(pointer('pointerup', 60, 70))

    // The pointer can move between the last move event and the release.
    expect(app.endDrag).toHaveBeenCalledWith({ x: 60, y: 70 })
    expect(app.place).not.toHaveBeenCalled()
  })

  it('snaps the released position like a click does', () => {
    const app = dragSetup()
    app.element.dispatchEvent(pointer('pointerdown', 20, 20))

    // Two millimetres from the line's other end, inside the reach.
    app.element.dispatchEvent(pointer('pointerup', 42, 20))

    expect(app.endDrag).toHaveBeenCalledWith({ x: 40, y: 20 })
  })

  it('draws rather than drags when a tool is equipped', () => {
    const app = setup({
      graph: sketchGraph,
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
      tool: 'line',
    })

    app.element.dispatchEvent(pointer('pointerdown', 20, 20))

    expect(app.beginDrag).not.toHaveBeenCalled()
  })
})

describe('selecting by clicking', () => {
  const clickable = () =>
    setup({
      graph: sketchGraph,
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
    })

  /*
   * A press on a segment starts a drag, because it might become one — so what
   * makes it a selection instead is the release without movement.
   */
  it('selects what was pressed when the pointer did not move', () => {
    const app = clickable()

    // Two millimetres off the middle of the line: near enough to the body, far
    // enough from either end that a point does not win the pick.
    app.element.dispatchEvent(pointer('pointerdown', 30, 22))
    app.element.dispatchEvent(pointer('pointerup', 30, 22))

    expect(app.select).toHaveBeenCalledWith(2, { add: false })
    // Abandoned rather than committed, so a click costs no solve and cannot
    // nudge geometry by a pixel.
    expect(app.cancelTool).toHaveBeenCalled()
    expect(app.endDrag).not.toHaveBeenCalled()
  })

  it('adds to the selection with shift held', () => {
    const app = clickable()
    const press = pointer('pointerdown', 20, 20)
    const release = new MouseEvent('pointerup', {
      bubbles: true,
      clientX: 20,
      clientY: 20,
      button: 0,
      shiftKey: true,
    }) as unknown as PointerEvent

    app.element.dispatchEvent(press)
    app.element.dispatchEvent(release)

    expect(app.select).toHaveBeenCalledWith(0, { add: true })
  })

  it('drags rather than selects once the pointer has moved', () => {
    const app = clickable()

    app.element.dispatchEvent(pointer('pointerdown', 30, 22))
    app.element.dispatchEvent(pointer('pointermove', 60, 40))
    app.element.dispatchEvent(pointer('pointerup', 60, 40))

    expect(app.endDrag).toHaveBeenCalled()
    expect(app.select).not.toHaveBeenCalled()
  })

  it('clears the selection when the click was on nothing', () => {
    const app = clickable()

    app.picked.dispatchEvent(pointer('pointerdown', 150, 90))
    app.picked.dispatchEvent(pointer('pointerup', 150, 90))

    expect(app.clearSelection).toHaveBeenCalled()
  })

  /*
   * This handler runs *behind* the camera, so a press that turned into an orbit
   * arrives here on release like any other. Clearing the selection because
   * somebody looked at the model from another angle would be its own bug.
   */
  it('leaves the selection alone after an orbit', () => {
    const app = clickable()

    app.picked.dispatchEvent(pointer('pointerdown', 150, 90))
    app.picked.dispatchEvent(pointer('pointerup', 60, 20))

    expect(app.clearSelection).not.toHaveBeenCalled()
  })

  it('selects the origin, which is not in the graph at all', () => {
    const app = clickable()

    app.picked.dispatchEvent(pointer('pointerdown', 0, 0))
    app.picked.dispatchEvent(pointer('pointerup', 0, 0))

    expect(app.select).toHaveBeenCalledWith('origin', { add: false })
    expect(app.clearSelection).not.toHaveBeenCalled()
  })

  it('keeps a shift-click on nothing from clearing what is selected', () => {
    const app = clickable()
    const press = pointer('pointerdown', 150, 90)
    const release = new MouseEvent('pointerup', {
      bubbles: true,
      clientX: 150,
      clientY: 90,
      button: 0,
      shiftKey: true,
    }) as unknown as PointerEvent

    app.picked.dispatchEvent(press)
    app.picked.dispatchEvent(release)

    expect(app.clearSelection).not.toHaveBeenCalled()
  })
})

describe('selecting with a box', () => {
  const boxable = () =>
    setup({
      graph: sketchGraph,
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
    })

  /*
   * Not claimed on the press: a press that never moves is a click on nothing,
   * which belongs to the handler behind the camera.
   */
  it('leaves the press alone until the pointer has moved', () => {
    const app = boxable()
    const press = pointer('pointerdown', 150, 90)
    const claimed = vi.spyOn(press, 'stopImmediatePropagation')

    app.element.dispatchEvent(press)

    expect(claimed).not.toHaveBeenCalled()
    expect(app.interaction.pointer.box.value).toBeNull()
  })

  it('grows a box once the pointer has gone far enough', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointerdown', 150, 90))

    app.element.dispatchEvent(pointer('pointermove', 100, 40))

    expect(app.interaction.pointer.box.value).toEqual({
      from: { x: 150, y: 90 },
      to: { x: 100, y: 40 },
      // Dragged right to left, so everything it touches.
      mode: 'crossing',
    })
  })

  it('reads a left-to-right drag as containment', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointerdown', 10, 10))

    app.element.dispatchEvent(pointer('pointermove', 100, 90))

    expect(app.interaction.pointer.box.value?.mode).toBe('contains')
  })

  it('selects what the box covers on release', () => {
    const app = boxable()
    // A box around the whole line fixture, dragged left to right.
    app.element.dispatchEvent(pointer('pointerdown', 10, 10))
    app.element.dispatchEvent(pointer('pointermove', 60, 30))
    app.element.dispatchEvent(pointer('pointerup', 60, 30))

    // Points 0 and 1 and the line 2 between them.
    expect(app.select.mock.calls.map((call) => call[0])).toEqual([0, 1, 2])
    // The first replaces, the rest add — so the box is one selection, not three.
    expect(app.select.mock.calls.map((call) => call[1])).toEqual([
      { add: false },
      { add: true },
      { add: true },
    ])
    expect(app.interaction.pointer.box.value).toBeNull()
  })

  it('adds to the selection when shift is held', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointerdown', 10, 10))
    app.element.dispatchEvent(pointer('pointermove', 60, 30))
    app.element.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 60,
        clientY: 30,
        button: 0,
        shiftKey: true,
      }) as unknown as PointerEvent
    )

    expect(app.select.mock.calls.every((call) => call[1]?.add)).toBe(true)
  })

  it('clears the selection when the box covered nothing', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointerdown', 120, 70))
    app.element.dispatchEvent(pointer('pointermove', 180, 95))
    app.element.dispatchEvent(pointer('pointerup', 180, 95))

    expect(app.clearSelection).toHaveBeenCalled()
    expect(app.select).not.toHaveBeenCalled()
  })

  /*
   * Several control schemes make a modified left drag a camera gesture, and the
   * camera sits behind this handler — so a modified press must fall through.
   */
  it('leaves a modified drag to the camera', () => {
    const app = boxable()
    app.element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 150,
        clientY: 90,
        button: 0,
        altKey: true,
      }) as unknown as PointerEvent
    )

    app.element.dispatchEvent(pointer('pointermove', 100, 40))

    expect(app.interaction.pointer.box.value).toBeNull()
  })

  it('abandons the box if the pointer leaves the surface', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointerdown', 150, 90))
    app.element.dispatchEvent(pointer('pointermove', 100, 40))

    app.element.dispatchEvent(pointer('pointerleave'))

    // The release will happen somewhere this cannot see, and a box applied from
    // the last position it *did* see would select from a rectangle nobody saw
    // finish.
    expect(app.interaction.pointer.box.value).toBeNull()
  })

  it('answers nothing else while a box is being dragged', () => {
    const app = boxable()
    app.element.dispatchEvent(pointer('pointermove', 20, 20))
    expect(app.interaction.pointer.hovered.value).toBe(0)

    app.element.dispatchEvent(pointer('pointerdown', 150, 90))
    app.element.dispatchEvent(pointer('pointermove', 20, 20))

    /*
     * Otherwise a row of constraint badges flashes up for every segment the box
     * is dragged across, and the snap indicator marks places nothing will land.
     */
    expect(app.interaction.pointer.hovered.value).toBeNull()
    expect(app.interaction.pointer.snap.value).toBeNull()
  })

  it('does not box while a tool is equipped', () => {
    const app = setup({
      tool: 'line',
      graph: sketchGraph,
      open: { sketchId: 3, name: 's', plane, planeProblem: null },
    })

    app.element.dispatchEvent(pointer('pointerdown', 150, 90))
    app.element.dispatchEvent(pointer('pointermove', 100, 40))

    // The press belongs to the tool: it is drawing a line, not a box.
    expect(app.interaction.pointer.box.value).toBeNull()
  })
})
