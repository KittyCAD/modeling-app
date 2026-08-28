import {
  appendValueSpec,
  defineContract,
  defineValueSpec,
} from '@kittycad/registry'
import type { IconName } from '@kittycad/ui-kit'
import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'

/**
 * A group of entries in the app menu.
 *
 * Sections rather than a flat list because the menu is assembled from features
 * that do not know about each other, and grouping is the only way the result
 * reads as deliberate rather than as an accumulation.
 */
export interface AppMenuSection {
  id: string
  /** Lower sorts earlier. Identity conventionally takes a negative order. */
  order?: number
  label?: string
  /** Hidden entirely while false. */
  visible?: ReadonlySignal<boolean>
  /** Arbitrary content — an identity card, a plan summary, a readout. */
  content?: () => ComponentChildren
  items?: AppMenuItem[]
}

export interface AppMenuItem {
  id: string
  label: string
  icon?: IconName
  shortcut?: string
  destructive?: boolean
  disabled?: ReadonlySignal<boolean>
  /**
   * Runs the named command.
   *
   * Preferred over `onSelect`: a menu entry that maps to a command is also
   * reachable from the palette and from a keybinding, for free.
   */
  commandId?: string
  onSelect?: () => void
}

/**
 * What opens the menu.
 *
 * The first *non-null* contribution wins, so a feature can replace the trigger
 * rather than add to it — and can do so conditionally by contributing a signal
 * that yields null when it does not apply. That is how the generic app menu
 * becomes a user menu when signed in: auth contributes an avatar trigger that is
 * null while signed out. "It is only a user menu when authenticated" is then a
 * composition fact rather than a conditional inside a component.
 */
export interface AppMenuTrigger {
  id: string
  render: (props: {
    open: boolean
    toggle: () => void
    /** Forward to the trigger element, so focus can return to it on close. */
    ref: (element: HTMLElement | null) => void
  }) => ComponentChildren
}

const byOrder = (inputs: readonly AppMenuSection[]): AppMenuSection[] => {
  const seen = new Set<string>()
  return [...inputs]
    .filter((section) => {
      if (seen.has(section.id)) return false
      seen.add(section.id)
      return true
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

/**
 * The app menu.
 *
 * Deliberately not "the user menu". It is useful signed out — theme, settings,
 * shortcuts — and identity is one section in it. Naming it for the user would
 * have made the signed-out case look like a degraded state instead of the
 * ordinary one.
 */
export const appMenuContract = defineContract({
  appMenuSectionsValueSpec: defineValueSpec<AppMenuSection, AppMenuSection[]>({
    name: 'appMenu.sections',
    defaultValue: [],
    combine: byOrder,
  }),
  appMenuTriggerValueSpec: defineValueSpec<
    AppMenuTrigger | null,
    AppMenuTrigger | null
  >({
    name: 'appMenu.trigger',
    defaultValue: null,
    // Skipping nulls is what makes a conditional contribution possible; a plain
    // first-wins would let a declining contributor shadow a willing one.
    combine: (inputs) => inputs.find((input) => input !== null) ?? null,
  }),
  /** Extra sections contributed as a group, for features with several. */
  appMenuSectionGroupsValueSpec: appendValueSpec<readonly AppMenuSection[]>(
    'appMenu.sectionGroups'
  ),
})

export const {
  appMenuSectionsValueSpec,
  appMenuTriggerValueSpec,
  appMenuSectionGroupsValueSpec,
} = appMenuContract
