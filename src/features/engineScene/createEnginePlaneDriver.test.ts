import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import { createEnginePlaneDriver } from '@src/features/engineScene/createEnginePlaneDriver'

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

const setup = (options: { ids?: DefaultPlanes | null } = {}) => {
  const ids = signal<DefaultPlanes | null>(
    options.ids === undefined ? IDS : options.ids
  )
  const sceneEpoch = signal(0)
  const setHidden = vi.fn<(id: string, hidden: boolean) => void>()

  const driver = createEnginePlaneDriver({ ids, sceneEpoch, setHidden })
  driver.start()
  dispose = driver.dispose

  return { driver, ids, sceneEpoch, setHidden }
}

/** What the engine was told about one object, last. */
const lastFor = (setHidden: ReturnType<typeof vi.fn>, id: string) =>
  [...setHidden.mock.calls].reverse().find((call) => call[0] === id)?.[1]

describe('a plane on this engine', () => {
  /*
   * `NegXy` is the same square as `Xy` with its normal flipped, so the pair moves
   * together: showing only the front means the plane disappears the moment you
   * orbit past it, and hiding only the back does nothing anybody can see.
   */
  it('is two objects, shown together', () => {
    const app = setup()

    app.driver.setVisible('xy', true)

    expect(lastFor(app.setHidden, 'id-xy')).toBe(false)
    expect(lastFor(app.setHidden, 'id-neg-xy')).toBe(false)
  })

  it('is two objects, hidden together', () => {
    const app = setup()

    app.driver.setVisible('xy', false)

    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
    expect(lastFor(app.setHidden, 'id-neg-xy')).toBe(true)
  })

  it('leaves the other planes alone', () => {
    const app = setup()

    app.driver.setVisible('xz', true)

    expect(lastFor(app.setHidden, 'id-xy')).toBeUndefined()
    expect(lastFor(app.setHidden, 'id-xz')).toBe(false)
  })
})

describe('what the engine has already been told', () => {
  /* One command per change, not one per restatement. */
  it('says nothing when asked for what it already sent', () => {
    const app = setup()
    app.driver.setVisible('xy', true)
    app.setHidden.mockClear()

    app.driver.setVisible('xy', true)

    expect(app.setHidden).not.toHaveBeenCalled()
  })

  /*
   * A fresh scene has forgotten everything, so every plane is restated —
   * skipping them as already-correct is how planes end up invisible after a
   * reconnect.
   */
  it('restates everything when the engine starts a new scene', () => {
    const app = setup()
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      app.driver.setVisible(plane, true)
    }
    app.setHidden.mockClear()

    app.sceneEpoch.value += 1

    expect(app.setHidden).toHaveBeenCalledTimes(6)
  })

  /* A new run mints new ids, so what the old ones were told means nothing. */
  it('states the planes again when a run makes new ones', () => {
    const app = setup()
    app.driver.setVisible('xy', true)
    app.setHidden.mockClear()

    app.ids.value = { ...IDS, xy: 'id-xy-2' }

    expect(app.setHidden).toHaveBeenCalledWith('id-xy-2', false)
  })

  /*
   * Intent outlives the objects it was about. Asking before a run has minted
   * anything is not an error — it is the ordinary case on startup, and the
   * answer has to survive until there is something to send it to.
   */
  it('remembers what was asked before there were planes to ask about', () => {
    const app = setup({ ids: null })
    app.driver.setVisible('xy', false)

    expect(app.setHidden).not.toHaveBeenCalled()

    app.ids.value = IDS

    expect(lastFor(app.setHidden, 'id-xy')).toBe(true)
    expect(lastFor(app.setHidden, 'id-neg-xy')).toBe(true)
  })
})

describe('whether there is anything to address', () => {
  it('has nothing before a run', () => {
    expect(setup({ ids: null }).driver.available.value).toBe(false)
  })

  it('has planes once one has happened', () => {
    const app = setup({ ids: null })
    app.ids.value = IDS

    expect(app.driver.available.value).toBe(true)
  })

  it('stops talking once disposed', () => {
    const app = setup()
    app.driver.setVisible('xy', true)
    app.driver.dispose()
    app.setHidden.mockClear()

    app.sceneEpoch.value += 1

    expect(app.setHidden).not.toHaveBeenCalled()
  })
})

describe('naming a clicked object', () => {
  /*
   * The engine answers a click with a uuid and nothing else, and a default plane
   * is in no file, so this is the only thing in the app that can say what was
   * clicked.
   */
  it('recognises a plane it made', () => {
    expect(setup().driver.planeAt('id-xz')).toEqual({
      plane: 'xz',
      facing: 'front',
    })
  })

  /* The sign in `-XY`, and the reason facing is carried rather than collapsed. */
  it('says which side of it you clicked', () => {
    expect(setup().driver.planeAt('id-neg-xy')).toEqual({
      plane: 'xy',
      facing: 'back',
    })
  })

  it('knows nothing about anything else', () => {
    expect(setup().driver.planeAt('some-face')).toBeNull()
    expect(setup({ ids: null }).driver.planeAt('id-xy')).toBeNull()
  })
})
