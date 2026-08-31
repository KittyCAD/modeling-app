import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { IconName } from '@kittycad/ui-kit'
import type { ReadonlySignal } from '@preact/signals'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'
import type { ComponentChildren } from 'preact'

/**
 * One independently contributed section in the scene's start-side HUD.
 *
 * The HUD is a scene-level outline surface, not a second application pane. Its
 * sections describe alternate views of the executing buffer: operations today,
 * bodies or other derived structure later. Keeping the section as the unit of
 * contribution lets those features stack without learning about one another.
 */
export interface SceneHudSection {
  id: string
  title: string
  icon?: IconName
  /** Lower sections appear nearer the top of the HUD. */
  order?: number
  /** A newly mounted section starts folded when true. */
  defaultCollapsed?: boolean
  /** Omitted from the HUD entirely while false. */
  visible?: ReadonlySignal<boolean>
  /** Controls aligned after the section title. */
  headerActions?: () => ComponentChildren
  /** Must return an element rather than call hooks inline. */
  render: () => ComponentChildren
}

/**
 * The outline's fold state, reachable from outside the component that draws it.
 *
 * A service rather than component state because a keybinding has to be able to
 * fold a section, and a command cannot reach into a `useState`. The HUD reads
 * the same signals it writes, so the key and the chevron are the one act.
 *
 * A feature contributing a section is expected to contribute its own toggle
 * command and binding alongside it, the way `featureTree` does — the section is
 * the unit of contribution, so its keyboard is too, and nothing here has to
 * enumerate sections it does not know about.
 */
export interface SceneHudService {
  /** Whether the outline is folded to its edge. */
  readonly collapsed: ReadonlySignal<boolean>
  toggleCollapsed(): void
  setCollapsed(value: boolean): void
  /**
   * Whether one section is unfolded.
   *
   * `initiallyOpen` seeds the answer the first time a section is asked about,
   * which is how `defaultCollapsed` reaches this without the service having to
   * read the sections value spec.
   */
  sectionOpen(
    sectionId: string,
    initiallyOpen?: boolean
  ): ReadonlySignal<boolean>
  /**
   * Fold or unfold a section, unfolding the whole outline if it was collapsed.
   *
   * The second part matters for a keybinding: toggling a section while the
   * outline is folded to its edge would otherwise look like the key did nothing.
   */
  toggleSection(sectionId: string): void
}

export const sceneHudContract = defineContract({
  sceneHudService: defineService<SceneHudService>('scene.hud.service'),
  sceneHudSectionsValueSpec: defineValueSpec<
    SceneHudSection,
    SceneHudSection[]
  >({
    name: 'scene.hudSections',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { sceneHudService, sceneHudSectionsValueSpec } = sceneHudContract
