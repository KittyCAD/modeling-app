import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'

export type ShellZone = 'start' | 'center' | 'end'

export interface ShellItem {
  id: string
  zone: ShellZone
  /** Lower sorts earlier within a zone. */
  order?: number
  /** Omitted from the DOM entirely while false. */
  visible?: ReadonlySignal<boolean>
  render: () => ComponentChildren
}

/**
 * A top-level view.
 *
 * `active` is the whole point of principle 5. A screen decides whether it
 * should be showing by looking at application state — is a project open, is
 * the user signed in — never by matching a URL. The URL is downstream of this,
 * not upstream.
 */
export interface Screen {
  id: string
  active: ReadonlySignal<boolean>
  /** Lower wins when several screens are active at once. */
  order?: number
  render: () => ComponentChildren
}

const byOrder = <T extends { order?: number; id: string }>(
  inputs: readonly T[]
): T[] =>
  [...inputs].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )

const dedupeById = <T extends { id: string }>(inputs: readonly T[]): T[] => {
  const seen = new Set<string>()
  return inputs.filter((input) => {
    if (seen.has(input.id)) return false
    seen.add(input.id)
    return true
  })
}

/**
 * The app frame.
 *
 * The shell owns three strips and nothing else: a top bar, the main area, and
 * a status bar. It has no knowledge of projects, files, or geometry — every
 * one of those is a contribution. That is what keeps the frame from
 * accumulating the whole app the way a hand-written layout component does.
 */
export const shellContract = defineContract({
  topBarItemsValueSpec: defineValueSpec<ShellItem, ShellItem[]>({
    name: 'shell.topBarItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  statusBarItemsValueSpec: defineValueSpec<ShellItem, ShellItem[]>({
    name: 'shell.statusBarItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  screensValueSpec: defineValueSpec<Screen, Screen[]>({
    name: 'shell.screens',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { topBarItemsValueSpec, statusBarItemsValueSpec, screensValueSpec } =
  shellContract
