import { defineContract, defineValueSpec } from '@kittycad/registry'
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

export const sceneHudContract = defineContract({
  sceneHudSectionsValueSpec: defineValueSpec<
    SceneHudSection,
    SceneHudSection[]
  >({
    name: 'scene.hudSections',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { sceneHudSectionsValueSpec } = sceneHudContract
