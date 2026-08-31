import { type ReadonlySignal, computed, effect, signal } from '@preact/signals'
import type {
  DefaultPlaneDriver,
  DefaultPlaneName,
  DefaultPlaneView,
  DefaultPlanesService,
  PlaneVisibility,
} from '@src/contracts/defaultPlanes'

/**
 * The three planes there are.
 *
 * Three, not six. That the Zoo engine draws each one as a front and a back is
 * true of that engine and lives in its driver; up here a plane is a plane, and
 * this list is what the outline shows.
 */
const PLANES: readonly { name: DefaultPlaneName; title: string }[] = [
  { name: 'xy', title: 'XY' },
  { name: 'xz', title: 'XZ' },
  { name: 'yz', title: 'YZ' },
]

export interface DefaultPlanesDependencies {
  /**
   * Whatever can actually show a plane, once there is one.
   *
   * A getter rather than a signal because it is resolved from the container, and
   * that may not be done while the graph is being flattened. Null when nothing
   * renders — a headless test, or an app with no scene — and then this is a
   * model nobody is watching, which is a perfectly good thing for it to be.
   */
  driver: () => DefaultPlaneDriver | null
  /** Whether the last run put anything on screen. */
  sceneIsEmpty: ReadonlySignal<boolean>
  /**
   * Whether something is waiting to be told which plane.
   *
   * `sketch(on = …)` asking to be clicked is the case. Without this the planes
   * are hidden the moment a project has geometry in it, so the second sketch in
   * a file has nothing to point at — the prompt says "click a plane" over a
   * scene with none in it.
   */
  askedFor: ReadonlySignal<boolean>
}

/**
 * The default planes, shown when there is nothing else to look at.
 *
 * Two rules, and they compose without a state machine:
 *
 * 1. A plane on `auto` is visible when the scene is empty, or when something is
 *    asking to be told which plane.
 * 2. A plane the user has touched does what they said, until they put it back.
 *
 * The second still beats the first while a plane is being asked for, which is
 * the tri-state meaning what it says. A plane somebody turned off stays off, and
 * the panel says why rather than the app quietly overruling them.
 *
 * That is the whole of it, and it is deliberately all that is here. There are no
 * object ids, no commands, no idea of what a plane is made of and no memory of
 * what anything has been told — those belong to whatever is drawing, behind
 * `defaultPlaneDriverService`, because they are the parts that change when the
 * renderer does. What is left is a policy, and it is renderer-independent by
 * construction rather than by intention.
 *
 * It states its whole intent on every change rather than sending differences.
 * Working out that there is nothing to do is the driver's job, and putting it
 * there means the policy cannot get out of step with a scene it never sees.
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

    return dependencies.sceneIsEmpty.value || dependencies.askedFor.value
  }

  const available = computed(
    () => dependencies.driver()?.available.value ?? false
  )

  const planes = computed<readonly DefaultPlaneView[]>(() =>
    PLANES.map(({ name, title }) => ({
      name,
      title,
      visible: available.value && wanted(name),
      visibility: visibilityOf(name),
    }))
  )

  /**
   * Tell the renderer what it should be showing.
   *
   * Every plane every time, because the cost of restating is a map lookup in the
   * driver and the cost of being clever here is the policy holding a shadow copy
   * of a scene it has no other reason to know about.
   */
  const reconcile = () =>
    effect(() => {
      const driver = dependencies.driver()
      if (!driver?.available.value) return

      for (const { name } of PLANES) driver.setVisible(name, wanted(name))
    })

  /**
   * An override belongs to the scene it was made in.
   *
   * So closing the project forgets it, and opening the next one starts on the
   * automatic rule. The alternative — remembering across sessions — means
   * opening a project to invisible planes somebody turned off last week, with
   * nothing on screen to say why.
   *
   * Its own effect, reading only availability: clearing `overrides` from the
   * reconciling effect would be writing a signal that same effect reads.
   */
  const forget = () =>
    effect(() => {
      if (!available.value) overrides.value = new Map()
    })

  let stops: (() => void)[] = []

  return {
    planes,
    sceneIsEmpty: computed(() => dependencies.sceneIsEmpty.value),
    askedFor: computed(() => dependencies.askedFor.value),
    available,
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

    /*
     * Passed straight through, because the answer is entirely the renderer's.
     * It is here so that selection has one service to ask rather than having to
     * know a driver exists.
     */
    planeAt: (entityId) => dependencies.driver()?.planeAt(entityId) ?? null,

    /**
     * Begin talking to the renderer.
     *
     * Separate from construction because both effects resolve the driver on
     * their first run, and the container forbids a service read while the
     * registry graph is being flattened — so the wiring defers this by a
     * microtask. Explicit rather than a `queueMicrotask` hidden in here: the
     * rule is about *when the container is ready*, which is the caller's fact,
     * and a test that has no container should not have to wait for one.
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
