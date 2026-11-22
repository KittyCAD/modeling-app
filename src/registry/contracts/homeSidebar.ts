import { contract, Facet } from 'plankton'
import type { ComponentType } from 'react'

export interface HomeSidebarItemProps {
  className: string
}

export interface HomeSidebarItem {
  id: string
  order?: number
  isVisible?: () => boolean
  Component: ComponentType<HomeSidebarItemProps>
}

const sortByOrderProperty = (items: readonly HomeSidebarItem[]) =>
  items.toSorted((a, b) => (a.order || 0) - (b.order || 0))
export const homeSidebarContract = contract({
  homeSidebarItemsFacet: new Facet<HomeSidebarItem, HomeSidebarItem[]>(
    'home-sidebar-items',
    (inputs) => (inputs.length ? sortByOrderProperty(inputs) : [])
  ),
})

export const { homeSidebarItemsFacet } = homeSidebarContract
