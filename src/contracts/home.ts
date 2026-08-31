import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'

/**
 * Something a feature puts in Home's left column.
 *
 * Contributed rather than listed by the home screen, for the same reason the
 * status bar works this way: the things worth showing beside the project list —
 * a credit balance, an agent, whatever comes next — belong to the features that
 * own them, and Home should not have to import each one to lay them out.
 */
export interface HomeSidebarItem {
  id: string
  /**
   * Which end of the column.
   *
   * `start` is for what somebody came here to *do* — the actions. `end` is for
   * standing information: what you have left, what is happening. The column
   * pushes the two apart, so the split is a layout fact rather than a hint.
   */
  group?: 'start' | 'end'
  /** Lower sorts earlier within a group. */
  order?: number
  /** Omitted from the DOM entirely while false. */
  visible?: ReadonlySignal<boolean>
  /**
   * Must return a component element, not JSX that calls hooks inline.
   *
   * Items render inside Home's own component, so a hook called directly in
   * `render` would belong to Home — and its position in the hook order would
   * shift whenever the item list changed.
   */
  render: () => ComponentChildren
}

export const homeContract = defineContract({
  homeSidebarItemsValueSpec: defineValueSpec<
    HomeSidebarItem,
    HomeSidebarItem[]
  >({
    name: 'home.sidebarItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { homeSidebarItemsValueSpec } = homeContract
