import type { App } from '@src/lib/app'
import { contract, Facet } from 'plankton'
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
export const appHeaderContract = contract({
  appHeaderItemsFacet: new Facet<AppHeaderItem, AppHeaderItem[]>(
    'app-header-items',
    (inputs) => (inputs.length ? sortByOrderProperty(inputs) : [])
  ),
})

export const { appHeaderItemsFacet } = appHeaderContract
