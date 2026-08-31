import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import { createDefaultPlanes } from '@src/features/defaultPlanes/createDefaultPlanes'

const IDS: DefaultPlanes = {
  xy: 'id-xy',
  xz: 'id-xz',
  yz: 'id-yz',
  negXy: 'id-neg-xy',
  negXz: 'id-neg-xz',
  negYz: 'id-neg-yz',
}

let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
})

const setup = (
  options: { empty?: boolean; ids?: DefaultPlanes | null } = {}
) => {
  const ids = signal<DefaultPlanes | null>(
    options.ids === undefined ? IDS : options.ids
  )
  const empty = signal(options.empty ?? true)
  const sceneEpoch = signal(0)
  const setHidden = vi.fn()

  const planes = createDefaultPlanes({
    ids,
    sceneIsEmpty: empty,
    setHidden,
    sceneEpoch,
  })
  /*
   * Started here rather than on construction, which is the point of it being
   * separate: the app defers this by a microtask because the container forbids a
   * service read while the graph is being flattened, and a test with no container
   * should not have to wait for one.
   */
  planes.start()
  dispose = planes.dispose

  return { planes, ids, empty, sceneEpoch, setHidden }
}

/** What the engine was told about one plane, last. */
const lastFor = (setHidden: ReturnType<typeof vi.fn>, id: string) =>
  [...setHidden.mock.calls].reverse().find((call) => call[0] === id)?.[1]

describe('when the planes show themselves', () => {
  /*
   * The whole point: an empty project should look empty rather than broken, and
   * three translucent squares are what tell you which way up you are.
   */
  it('shows the three principals while the scene is empty', () => {
    const app = setup({ empty: true })

    expect(lastFor(app.setHidden, 'id-xy')).toBe(false)
    expect(lastFor(app.setHidden, 'id-xz')).toBe(false)
    expect(lastFor(app.setHidden, 'id-yz')).toBe(false)
  })

  /* Three squares orient you; six are a box you are looking at from inside. */
  it('leaves the back faces hidden', () => {
    const app = setup({ empty: true })

    expect(lastFor(app.setHidden, 'id-neg-xy')).toBe(true)
    expect(lastFor(app.setHidden, 'id-neg-xz')).toBe(true)
  })

  it('hides them the moment there is geometry', () => {
    const app = setup({ empty: true })

    app.empty.value = false

    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
  })

  it('brings them back when the geometry goes away', () => {
    const app = setup({ empty: false })
    app.empty.value = true

    expect(lastFor(app.setHidden, 'id-xy')).toBe(false)
  })

  it('says nothing to an engine that has no planes yet', () => {
    const app = setup({ ids: null })

    expect(app.setHidden).not.toHaveBeenCalled()
    expect(app.planes.available.value).toBe(false)
  })
})

describe('when somebody asks for a plane', () => {
  it('keeps it showing after geometry arrives', () => {
    const app = setup({ empty: true })

    app.planes.set('xy', 'shown')
    app.empty.value = false

    // Turned on deliberately, so it stops following the scene.
    expect(lastFor(app.setHidden, 'id-xy')).toBe(false)
    expect(lastFor(app.setHidden, 'id-xz')).toBe(true)
  })

  it('keeps it hidden while the scene is empty', () => {
    const app = setup({ empty: true })

    app.planes.set('xy', 'hidden')

    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
  })

  it('shows a back face that was asked for', () => {
    const app = setup({ empty: true })

    app.planes.set('negXy', 'shown')

    expect(lastFor(app.setHidden, 'id-neg-xy')).toBe(false)
  })

  it('follows the scene again once it is put back on automatic', () => {
    const app = setup({ empty: false })
    app.planes.set('xy', 'shown')

    app.planes.set('xy', 'auto')

    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
    expect(app.planes.overridden.value).toBe(false)
  })

  it('puts everything back at once', () => {
    const app = setup({ empty: false })
    app.planes.set('xy', 'shown')
    app.planes.set('yz', 'shown')

    app.planes.resetOverrides()

    expect(app.planes.overridden.value).toBe(false)
    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
    expect(lastFor(app.setHidden, 'id-yz')).toBe(true)
  })

  /*
   * An override belongs to the scene it was made in — otherwise you open a
   * project to invisible planes somebody turned off last week, with nothing on
   * screen to say why.
   */
  it('forgets what was asked when the project closes', () => {
    const app = setup({ empty: true })
    app.planes.set('xy', 'hidden')

    app.ids.value = null

    expect(app.planes.overridden.value).toBe(false)
  })
})

describe('talking to the engine', () => {
  /* One command per change, not one per render. */
  it('says nothing when nothing has changed', () => {
    const app = setup({ empty: true })
    const before = app.setHidden.mock.calls.length

    app.planes.set('xy', 'shown')

    // Already showing under the automatic rule, so there is nothing to send.
    expect(app.setHidden.mock.calls.length).toBe(before)
  })

  /*
   * A fresh scene has forgotten everything, so every plane is restated — skipping
   * them as already-correct is how planes end up invisible after a reconnect.
   */
  it('restates every plane when the engine starts a new scene', () => {
    const app = setup({ empty: true })
    app.setHidden.mockClear()

    app.sceneEpoch.value += 1

    expect(app.setHidden).toHaveBeenCalledTimes(6)
  })

  /* A new run mints new ids, so what the old ones were told means nothing. */
  it('states the planes again when a run makes new ones', () => {
    const app = setup({ empty: true })
    app.setHidden.mockClear()

    app.ids.value = { ...IDS, xy: 'id-xy-2' }

    expect(app.setHidden).toHaveBeenCalledWith('id-xy-2', false)
  })

  it('stops talking once disposed', () => {
    const app = setup({ empty: true })
    app.planes.dispose()
    app.setHidden.mockClear()

    app.empty.value = false

    expect(app.setHidden).not.toHaveBeenCalled()
  })
})

describe('what a list would draw', () => {
  it('offers every plane, backs last', () => {
    const app = setup()

    expect(app.planes.planes.value.map((plane) => plane.title)).toEqual([
      'XY',
      'XZ',
      'YZ',
      '-XY',
      '-XZ',
      '-YZ',
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
    expect(rows.get('negXy')).toMatchObject({ visible: false, back: true })
  })

  it('shows nothing as visible before anything has run', () => {
    const app = setup({ ids: null, empty: true })

    expect(app.planes.planes.value.every((plane) => !plane.visible)).toBe(true)
  })
})
