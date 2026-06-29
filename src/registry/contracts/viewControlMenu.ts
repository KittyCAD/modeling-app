import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ComponentType } from 'react'

export interface ViewControlMenuSection {
  id: string
  order?: number
  Component: ComponentType
}

const sortByOrderProperty = (inputs: readonly ViewControlMenuSection[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const viewControlMenuContract = defineContract({
  viewControlMenuSectionsValueSpec: defineValueSpec<
    ViewControlMenuSection,
    ViewControlMenuSection[]
  >({
    name: 'view-control-menu-sections',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { viewControlMenuSectionsValueSpec } = viewControlMenuContract
