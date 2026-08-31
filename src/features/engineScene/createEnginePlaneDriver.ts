import { computed, effect, type ReadonlySignal } from '@preact/signals'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type {
  DefaultPlaneDriver,
  DefaultPlaneName,
  DefaultPlanePick,
} from '@src/contracts/defaultPlanes'

/**
 * What each plane is made of, on this engine.
 *
 * Two objects, because kcl-lib mints `NegXy` with the same origin as `Xy` and
 * its x and z axes negated — the same square with its normal flipped. They are
 * shown and hidden together: a plane visible only from the front disappears the
 * moment you orbit behind it, and hiding the back alone changes nothing anybody
 * can see.
 *
 * This table is the opinion the seam exists to isolate. A renderer with one
 * object per plane, or none until asked, writes its own driver and nothing above
 * this file changes.
 */
const FACES: Record<
  DefaultPlaneName,
  Readonly<Record<'front' | 'back', keyof DefaultPlanes>>
> = {
  xy: { front: 'xy', back: 'negXy' },
  xz: { front: 'xz', back: 'negXz' },
  yz: { front: 'yz', back: 'negYz' },
}

const PLANES = Object.keys(FACES) as readonly DefaultPlaneName[]

export interface EnginePlaneDriverDependencies {
  /** The ids the last run created, or null before anything has run. */
  ids: ReadonlySignal<DefaultPlanes | null>
  /**
   * Bumps when the engine starts a fresh scene.
   *
   * Everything it was told is forgotten then, so every plane has to be restated
   * rather than skipped as already-correct.
   */
  sceneEpoch: ReadonlySignal<number>
  /** Show or hide one engine object. */
  setHidden: (id: string, hidden: boolean) => void
}

/**
 * The default planes as the Zoo engine has them.
 *
 * Everything peculiar to that engine lives here: that a run mints the planes and
 * hands back six uuids, that each plane is a front and a back, that a new scene
 * has forgotten what the last one was told, and that visibility is an
 * `object_visible` command sent down a socket.
 *
 * It holds intent rather than mirroring state. The policy says which planes it
 * wants; this remembers that, works out what the engine has actually been told,
 * and sends the difference. Nothing here reads the engine back, so there is no
 * second copy of the truth to drift — which is exactly the failure this replaces
 * in the existing app, where a visibility flag in machine context is kept in
 * step with the engine by hand at five call sites.
 */
export function createEnginePlaneDriver(
  dependencies: EnginePlaneDriverDependencies
): DefaultPlaneDriver & { start: () => void; dispose: () => void } {
  /** What the policy has asked for, by plane. */
  const wanted = new Map<DefaultPlaneName, boolean>()
  /**
   * What the engine was last told, by object id rather than by plane.
   *
   * By id because a run mints new ones: an entry keyed by plane would make the
   * next scene's objects look already-correct and leave them hidden.
   */
  let told = new Map<string, boolean>()
  /*
   * Null until the first reconciliation rather than peeked at construction.
   * Peeking evaluates the computed, which resolves a service — and the container
   * refuses that while the registry graph is being flattened, which is exactly
   * when a feature's factory body runs.
   */
  let lastEpoch: number | null = null

  /** Send one plane, both faces, if the engine does not already have it. */
  const push = (plane: DefaultPlaneName, ids: DefaultPlanes) => {
    const visible = wanted.get(plane)
    if (visible === undefined) return

    const hidden = !visible
    for (const face of Object.values(FACES[plane])) {
      const id = ids[face]
      if (!id) continue
      if (told.get(id) === hidden) continue

      told.set(id, hidden)
      dependencies.setHidden(id, hidden)
    }
  }

  /**
   * Restate everything when the engine's idea of the scene changes underneath.
   *
   * A fresh scene has forgotten, and a fresh run has renumbered. Either way what
   * was sent last means nothing, so the whole intent goes again — deduplicated
   * against `told`, which the epoch clears.
   */
  const restate = () =>
    effect(() => {
      const ids = dependencies.ids.value
      const epoch = dependencies.sceneEpoch.value

      if (lastEpoch !== epoch) {
        lastEpoch = epoch
        told = new Map()
      }

      if (!ids) return
      for (const plane of wanted.keys()) push(plane, ids)
    })

  let stop: (() => void) | null = null

  return {
    id: 'engine',

    available: computed(() => dependencies.ids.value !== null),

    /**
     * A uuid back to the plane it belongs to.
     *
     * Searched rather than kept in a reverse index, because there are six of
     * them and the alternative is a second map to invalidate on every run. The
     * facing is the part that matters to the caller: a click on the back of XY
     * is a click on `-XY`, and losing that would silently sketch on the wrong
     * side.
     */
    planeAt(entityId): DefaultPlanePick | null {
      const ids = dependencies.ids.value
      if (!ids) return null

      for (const plane of PLANES) {
        const faces = FACES[plane]
        if (ids[faces.front] === entityId) return { plane, facing: 'front' }
        if (ids[faces.back] === entityId) return { plane, facing: 'back' }
      }

      return null
    },

    setVisible(plane, visible) {
      wanted.set(plane, visible)

      /*
       * Peeked, not read: this is called from the policy's own effect, and
       * subscribing that effect to the ids would have a new run re-enter it
       * while it is running.
       */
      const ids = dependencies.ids.peek()
      if (ids) push(plane, ids)
    },

    /**
     * Begin restating.
     *
     * Separate from construction for the same reason it is everywhere else here:
     * the effect reads signals that resolve services, and the container forbids
     * that while the graph is being flattened. Idempotent, so a second call
     * cannot double the subscription.
     */
    start() {
      if (!stop) stop = restate()
    },

    dispose() {
      stop?.()
      stop = null
    },
  }
}
