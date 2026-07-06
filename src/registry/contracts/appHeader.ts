import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { App } from '@src/lib/app'
import type { ComponentType } from 'react'

export interface AppHeaderItemProps {
  className: string
  app: App
}

export interface AppHeaderItem {
  id: string
  order?: number
  Component: ComponentType<AppHeaderItemProps>
}

const sortByOrderProperty = (inputs: readonly AppHeaderItem[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const appHeaderContract = defineContract({
  appHeaderItemsValueSpec: defineValueSpec<AppHeaderItem, AppHeaderItem[]>({
    name: 'app-header-items',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { appHeaderItemsValueSpec } = appHeaderContract
