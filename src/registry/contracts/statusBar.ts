import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { defineContract, defineValueSpec } from '@kittycad/registry'

const sortByOrderProperty = (inputs: readonly StatusBarItemType[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const statusBarContract = defineContract({
  statusBarGlobalItemsValueSpec: defineValueSpec<
    StatusBarItemType,
    StatusBarItemType[]
  >({
    name: 'status-bar-global',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
  statusBarLocalItemsValueSpec: defineValueSpec<
    StatusBarItemType,
    StatusBarItemType[]
  >({
    name: 'status-bar-local',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { statusBarGlobalItemsValueSpec, statusBarLocalItemsValueSpec } =
  statusBarContract
