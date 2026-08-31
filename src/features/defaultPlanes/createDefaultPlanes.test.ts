import { type ReadonlySignal, computed, signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DefaultPlaneDriver,
  DefaultPlaneName,
} from '@src/contracts/defaultPlanes'
import { createDefaultPlanes } from '@src/features/defaultPlanes/createDefaultPlanes'

/** What the fake renderer says its one recognisable object is. */
const XY_FRONT = { plane: 'xy', facing: 'front' } as const

let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
})

/**
 * A renderer that only records what it was asked for.
 *
 * Which is the point of the seam: none of these tests can say anything about
 * object ids, front and back faces, or commands, because the thing under test
 * has no access to any of that.
 */
const fakeDriver = (available: ReadonlySignal<boolean>) => {
  const setVisible =
    vi.fn<(plane: DefaultPlaneName, visible: boolean) => void>()

  const driver: DefaultPlaneDriver = {
    id: 'fake',
    available,
    setVisible,
    planeAt: (entityId) => (entityId === 'the-xy-plane' ? XY_FRONT : null),
  }

  return { driver, setVisible }
}

const setup = (
  options: { empty?: boolean; available?: boolean; askedFor?: boolean } = {}
) => {
  const empty = signal(options.empty ?? true)
  const askedFor = signal(options.askedFor ?? false)
  const available = signal(options.available ?? true)
  const renderer = fakeDriver(computed(() => available.value))

  const planes = createDefaultPlanes({
    driver: () => renderer.driver,
    sceneIsEmpty: empty,
    askedFor,
  })
  /*
   * Started here rather than on construction, which is the point of it being
   * separate: the app defers this by a microtask because the container forbids a
   * service read while the graph is being flattened, and a test with no container
   * should not have to wait for one.
   */
  planes.start()
  dispose = planes.dispose

  return { planes, empty, askedFor, available, setVisible: renderer.setVisible }
}

/** What the renderer was asked for about one plane, last. */
const lastFor = (
  setVisible: ReturnType<typeof vi.fn>,
  plane: DefaultPlaneName
) => [...setVisible.mock.calls].reverse().find((call) => call[0] === plane)?.[1]

describe('when the planes show themselves', () => {
  /*
   * The whole point: an empty project should look empty rather than broken, and
   * three translucent squares are what tell you which way up you are.
   */
  it('shows the three planes while the scene is empty', () => {
    const app = setup({ empty: true })

    expect(lastFor(app.setVisible, 'xy')).toBe(true)
    expect(lastFor(app.setVisible, 'xz')).toBe(true)
    expect(lastFor(app.setVisible, 'yz')).toBe(true)
  })

  it('hides them the moment there is geometry', () => {
    const app = setup({ empty: true })

    app.empty.value = false

    expect(lastFor(app.setVisible, 'xy')).toBe(false)
  })

  /*
   * The case the automatic rule alone gets wrong. A file with a solid in it hides
   * the planes, so the second sketch has nothing to click and the prompt asks you
   * to click a plane over a scene with none in it.
   */
  it('shows them over geometry while something is asking for one', () => {
    const app = setup({ empty: false })

    app.askedFor.value = true

    expect(lastFor(app.setVisible, 'xy')).toBe(true)
  })

  it('puts them away again once nobody is asking', () => {
    const app = setup({ empty: false, askedFor: true })

    app.askedFor.value = false

    expect(lastFor(app.setVisible, 'xy')).toBe(false)
  })

  /* The tri-state meaning what it says: a plane turned off stays off. */
  it('leaves a plane somebody turned off alone', () => {
    const app = setup({ empty: false })
    app.planes.set('xy', 'hidden')

    app.askedFor.value = true

    expect(lastFor(app.setVisible, 'xy')).toBe(false)
    expect(lastFor(app.setVisible, 'xz')).toBe(true)
  })

  it('brings them back when the geometry goes away', () => {
    const app = setup({ empty: false })
    app.empty.value = true

    expect(lastFor(app.setVisible, 'xy')).toBe(true)
  })

  it('says nothing to a renderer that has no planes yet', () => {
    const app = setup({ available: false })

    expect(app.setVisible).not.toHaveBeenCalled()
    expect(app.planes.available.value).toBe(false)
  })

  /* Nobody to talk to is a state, not a crash. */
  it('holds its opinions with no renderer at all', () => {
    const planes = createDefaultPlanes({
      driver: () => null,
      sceneIsEmpty: signal(true),
      askedFor: signal(false),
    })
    planes.start()
    dispose = planes.dispose

    expect(planes.available.value).toBe(false)
    expect(() => planes.set('xy', 'shown')).not.toThrow()
  })
})

describe('when somebody asks for a plane', () => {
  it('keeps it showing after geometry arrives', () => {
    const app = setup({ empty: true })

    app.planes.set('xy', 'shown')
    app.empty.value = false

    // Turned on deliberately, so it stops following the scene.
    expect(lastFor(app.setVisible, 'xy')).toBe(true)
    expect(lastFor(app.setVisible, 'xz')).toBe(false)
  })

  it('keeps it hidden while the scene is empty', () => {
    const app = setup({ empty: true })

    app.planes.set('xy', 'hidden')

    expect(lastFor(app.setVisible, 'xy')).toBe(false)
  })

  it('follows the scene again once it is put back on automatic', () => {
    const app = setup({ empty: false })
    app.planes.set('xy', 'shown')

    app.planes.set('xy', 'auto')

    expect(lastFor(app.setVisible, 'xy')).toBe(false)
    expect(app.planes.overridden.value).toBe(false)
  })

  it('puts everything back at once', () => {
    const app = setup({ empty: false })
    app.planes.set('xy', 'shown')
    app.planes.set('yz', 'shown')

    app.planes.resetOverrides()

    expect(app.planes.overridden.value).toBe(false)
    expect(lastFor(app.setVisible, 'xy')).toBe(false)
    expect(lastFor(app.setVisible, 'yz')).toBe(false)
  })

  /*
   * An override belongs to the scene it was made in — otherwise you open a
   * project to invisible planes somebody turned off last week, with nothing on
   * screen to say why.
   */
  it('forgets what was asked when the project closes', () => {
    const app = setup({ empty: true })
    app.planes.set('xy', 'hidden')

    app.available.value = false

    expect(app.planes.overridden.value).toBe(false)
  })
})

describe('talking to the renderer', () => {
  /*
   * The policy restates rather than diffs, and that is the deal the contract
   * makes: working out that nothing changed needs to know what the renderer was
   * told, and this does not.
   */
  it('states its whole intent, leaving the driver to skip what it has', () => {
    const app = setup({ empty: true })
    app.setVisible.mockClear()

    app.planes.set('xy', 'shown')

    expect(app.setVisible).toHaveBeenCalledTimes(3)
  })

  it('states everything again when a renderer arrives', () => {
    const app = setup({ empty: true, available: false })

    app.available.value = true

    expect(app.setVisible).toHaveBeenCalledTimes(3)
  })

  it('stops talking once disposed', () => {
    const app = setup({ empty: true })
    app.planes.dispose()
    app.setVisible.mockClear()

    app.empty.value = false

    expect(app.setVisible).not.toHaveBeenCalled()
  })
})

describe('naming what was clicked', () => {
  /*
   * A default plane is in nobody's file, so nothing else in the app can say what
   * a click on one was. The policy does not know either — it asks whatever drew
   * it, which is the only thing that could answer.
   */
  it('passes the question to the renderer', () => {
    const app = setup()

    expect(app.planes.planeAt('the-xy-plane')).toEqual({
      plane: 'xy',
      facing: 'front',
    })
    expect(app.planes.planeAt('some-face')).toBeNull()
  })

  it('answers nothing with no renderer', () => {
    const planes = createDefaultPlanes({
      driver: () => null,
      sceneIsEmpty: signal(true),
      askedFor: signal(false),
    })
    dispose = planes.dispose

    expect(planes.planeAt('the-xy-plane')).toBeNull()
  })
})

describe('what a list would draw', () => {
  /* Three rows for six engine objects: a back face is not a plane of its own. */
  it('offers one row per plane', () => {
    const app = setup()

    expect(app.planes.planes.value.map((plane) => plane.title)).toEqual([
      'XY',
      'XZ',
      'YZ',
    ])
  })

  it('reports what each one is doing and why', () => {
    const app = setup({ empty: true })
    app.planes.set('xz', 'hidden')

    const rows = new Map(
      app.planes.planes.value.map((plane) => [plane.name, plane])
    )
    expect(rows.get('xy')).toMatchObject({ visible: true, visibility: 'auto' })
    expect(rows.get('xz')).toMatchObject({
      visible: false,
      visibility: 'hidden',
    })
    expect(rows.get('yz')).toMatchObject({ visible: true, visibility: 'auto' })
  })

  it('shows nothing as visible before anything has run', () => {
    const app = setup({ available: false, empty: true })

    expect(app.planes.planes.value.every((plane) => !plane.visible)).toBe(true)
  })
})
