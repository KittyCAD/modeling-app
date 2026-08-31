import {
  computed,
  type ReadonlySignal,
  type Signal,
  signal,
} from '@preact/signals'
import type { SceneHudService } from '@src/contracts/sceneHud'

/**
 * The scene outline's fold state.
 *
 * Signals in a service rather than `useState` in the component, for one reason:
 * a keybinding runs a command, and a command cannot reach into component state.
 * Lifting it means the chevron and the keystroke are the same act on the same
 * value, rather than two mechanisms that agree until they do not.
 *
 * Nothing here is persisted. Fold state is a "right now" answer — unlike the
 * outline's *width*, which is remembered through the layout service's extents —
 * and an outline that reopens folded because of something you did last week is
 * worse than one that always starts open.
 */
export function createSceneHudService(): SceneHudService {
  const collapsed = signal(false)

  /**
   * One signal per section, created on first mention.
   *
   * Keyed rather than a single record so a section's own signal survives its
   * component unmounting — switching projects should not forget that you had
   * Features folded.
   */
  const sections = new Map<string, Signal<boolean>>()

  const openSignalFor = (sectionId: string, initiallyOpen: boolean) => {
    const existing = sections.get(sectionId)
    if (existing) return existing
    const created = signal(initiallyOpen)
    sections.set(sectionId, created)
    return created
  }

  return {
    collapsed: computed(() => collapsed.value),

    toggleCollapsed: () => {
      collapsed.value = !collapsed.value
    },

    setCollapsed: (value: boolean) => {
      collapsed.value = value
    },

    sectionOpen: (
      sectionId: string,
      initiallyOpen = true
    ): ReadonlySignal<boolean> => {
      const own = openSignalFor(sectionId, initiallyOpen)
      return computed(() => own.value)
    },

    toggleSection: (sectionId: string) => {
      /*
       * Seeded closed when the section has never been seen, so the first press
       * opens it. A command can arrive before the HUD has drawn — the outline is
       * hidden entirely when no section is visible — and "toggle" then has to
       * mean "show me this".
       */
      const own = openSignalFor(sectionId, false)
      own.value = !own.value

      // Unfolding a section inside a folded outline would otherwise be silent.
      if (own.value) collapsed.value = false
    },
  }
}
