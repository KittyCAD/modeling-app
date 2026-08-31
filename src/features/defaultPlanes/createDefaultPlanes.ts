import { type ReadonlySignal, computed, effect, signal } from '@preact/signals'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type {
  DefaultPlaneName,
  DefaultPlaneView,
  DefaultPlanesService,
  PlaneVisibility,
} from '@src/contracts/defaultPlanes'

/** In the order a list should show them: the three principals, then the backs. */
const PLANES: readonly { name: DefaultPlaneName; title: string }[] = [
  { name: 'xy', title: 'XY' },
  { name: 'xz', title: 'XZ' },
  { name: 'yz', title: 'YZ' },
  { name: 'negXy', title: '-XY' },
  { name: 'negXz', title: '-XZ' },
  { name: 'negYz', title: '-YZ' },
]

const isBack = (name: DefaultPlaneName) => name.startsWith('neg')

export interface DefaultPlanesDependencies {
  /** The ids the last run created, or null before anything has run. */
  ids: ReadonlySignal<DefaultPlanes | null>
  /** Whether the last run put anything on screen. */
  sceneIsEmpty: ReadonlySignal<boolean>
  /** Show or hide one plane on the engine. */
  setHidden: (id: string, hidden: boolean) => void
  /**
   * Bumps when the engine starts a fresh scene.
   *
   * Everything the app told it is forgotten then, so every plane has to be
   * restated rather than skipped as already-correct.
   */
  sceneEpoch: ReadonlySignal<number>
}

/**
 * The default planes, shown when there is nothing else to look at.
 *
 * Two rules, and they compose without a state machine:
 *
 * 1. A plane on `auto` is visible when the scene is empty — and only the three
 *    principals, because three translucent squares orient you and six are a box.
 * 2. A plane the user has touched does what they said, until they put it back.
 *
 * Everything else here is reconciliation: work out what each plane *should* be,
 * compare it to what the engine was last told, and send the difference. Nothing
 * mirrors the engine's state; the engine is brought to ours.
 */
export function createDefaultPlanes(
  dependencies: DefaultPlanesDependencies
): DefaultPlanesService & { start: () => void; dispose: () => void } {
  const overrides = signal<ReadonlyMap<DefaultPlaneName, PlaneVisibility>>(
    new Map()
  )

  const visibilityOf = (name: DefaultPlaneName): PlaneVisibility =>
    overrides.value.get(name) ?? 'auto'

  /** What a plane should be, from the rule and whatever was asked of it. */
  const wanted = (name: DefaultPlaneName): boolean => {
    const asked = visibilityOf(name)
    if (asked !== 'auto') return asked === 'shown'

    return dependencies.sceneIsEmpty.value && !isBack(name)
  }

  const planes = computed<readonly DefaultPlaneView[]>(() =>
    PLANES.map(({ name, title }) => ({
      name,
      title,
      visible: dependencies.ids.value !== null && wanted(name),
      visibility: visibilityOf(name),
      back: isBack(name),
    }))
  )

  /**
   * What the engine was last told, by plane id rather than by name.
   *
   * By id because a new run mints new ids: an entry keyed by name would make the
   * next scene's planes look already-correct and leave them hidden.
   */
  let told = new Map<string, boolean>()
  /*
   * Null until the first reconciliation, rather than peeked at construction.
   * Peeking evaluates the computed, which resolves the engine service — and the
   * container refuses that while the registry graph is being flattened, which is
   * exactly when a feature's factory body runs.
   */
  let lastEpoch: number | null = null

  const reconcile = () =>
    effect(() => {
      const ids = dependencies.ids.value
      // Read so a fresh scene restates everything: the engine has forgotten.
      const epoch = dependencies.sceneEpoch.value

      if (lastEpoch !== epoch) {
        lastEpoch = epoch
        told = new Map()
      }

      if (!ids) return

      for (const { name } of PLANES) {
        const id = ids[name]
        if (!id) continue

        const hidden = !wanted(name)
        if (told.get(id) === hidden) continue

        told.set(id, hidden)
        dependencies.setHidden(id, hidden)
      }
    })

  /**
   * An override belongs to the scene it was made in.
   *
   * So closing the project forgets it, and opening the next one starts on the
   * automatic rule. The alternative — remembering across sessions — means opening
   * a project to invisible planes somebody turned off last week, with nothing on
   * screen to say why.
   *
   * Its own effect, reading only the ids: clearing `overrides` from the
   * reconciling effect would be writing a signal that same effect reads.
   */
  const forget = () =>
    effect(() => {
      if (dependencies.ids.value === null) overrides.value = new Map()
    })

  let stops: (() => void)[] = []

  return {
    planes,
    sceneIsEmpty: computed(() => dependencies.sceneIsEmpty.value),
    available: computed(() => dependencies.ids.value !== null),
    overridden: computed(() => overrides.value.size > 0),

    set(name, visibility) {
      const next = new Map(overrides.peek())
      /*
       * `auto` is removal rather than a stored value, so "has anything been
       * overridden" is the map's size and cannot drift from what it holds.
       */
      if (visibility === 'auto') next.delete(name)
      else next.set(name, visibility)

      overrides.value = next
    },

    resetOverrides() {
      overrides.value = new Map()
    },

    /**
     * Begin talking to the engine.
     *
     * Separate from construction because both effects read services on their
     * first run, and the container forbids that while the registry graph is
     * being flattened — so the wiring defers this by a microtask. Explicit rather
     * than a `queueMicrotask` hidden in here: the rule is about *when the
     * container is ready*, which is the caller's fact, and a test that has no
     * container should not have to wait for one.
     *
     * Idempotent, so a second call cannot double the subscriptions.
     */
    start() {
      if (stops.length > 0) return
      stops = [reconcile(), forget()]
    },

    dispose: () => {
      for (const stop of stops) stop()
      stops = []
    },
  }
}
