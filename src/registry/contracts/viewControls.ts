import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'
import { contract, Facet } from 'plankton'

export interface ViewControlMenuItemProps {
  disabled: boolean
  highlighted: boolean
}

export interface ViewControlMenuItem {
  id: string
  order: number
  Component: ComponentType<ViewControlMenuItemProps>
  help?: {
    requested: ReadonlySignal<boolean>
    message: string
    shown(): void
  }
}

export const { viewControlMenuItemsFacet } = contract({
  viewControlMenuItemsFacet: new Facet<
    ViewControlMenuItem,
    readonly ViewControlMenuItem[]
  >('view-controls.menu-items', (items) =>
    items.toSorted((a, b) => a.order - b.order)
  ),
})
