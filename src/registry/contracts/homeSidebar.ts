import { defineContract, defineValueSpec } from '@kittycad/registry'
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

export const homeSidebarContract = defineContract({
  homeSidebarItemsValueSpec: defineValueSpec<
    HomeSidebarItem,
    HomeSidebarItem[]
  >({
    name: 'home-sidebar-items',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { homeSidebarItemsValueSpec } = homeSidebarContract
