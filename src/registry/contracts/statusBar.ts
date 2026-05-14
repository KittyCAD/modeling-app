import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'

type NullableStatusBarItemContribution = {
  type: 'nullable-status-bar-item'
  item: StatusBarItemType | null
}

type StatusBarItemContribution =
  | StatusBarItemType
  | NullableStatusBarItemContribution
  | null

export const nullableStatusBarItem = (
  item: StatusBarItemType | null
): NullableStatusBarItemContribution => ({
  type: 'nullable-status-bar-item',
  item,
})

const isNullableStatusBarItemContribution = (
  input: StatusBarItemContribution
): input is NullableStatusBarItemContribution =>
  input !== null && 'type' in input && input.type === 'nullable-status-bar-item'

const byOrder = (a: StatusBarItemType, b: StatusBarItemType) =>
  (a.order || 0) - (b.order || 0)

const sortByOrderProperty = (
  inputs: readonly StatusBarItemContribution[],
  nullablePosition: 'start' | 'end'
) => {
  const staticItems: StatusBarItemType[] = []
  const nullableItems: StatusBarItemType[] = []

  for (const input of inputs) {
    if (input === null) {
      continue
    }

    if (isNullableStatusBarItemContribution(input)) {
      if (input.item !== null) {
        nullableItems.push(input.item)
      }
      continue
    }

    staticItems.push(input)
  }

  const sortedStaticItems = staticItems.toSorted(byOrder)
  const sortedNullableItems = nullableItems.toSorted(byOrder)

  return nullablePosition === 'start'
    ? [...sortedNullableItems, ...sortedStaticItems]
    : [...sortedStaticItems, ...sortedNullableItems]
}

const sortGlobalStatusBarItems = (
  inputs: readonly StatusBarItemContribution[]
) => sortByOrderProperty(inputs, 'end')

const sortLocalStatusBarItems = (
  inputs: readonly StatusBarItemContribution[]
) => sortByOrderProperty(inputs, 'start')

export function filterStatusBarItemsForScopes(
  items: readonly StatusBarItemType[],
  scopes: readonly string[]
) {
  const activeScopes = new Set(scopes)

  return items.filter(
    (item) =>
      !item.scopes?.length ||
      item.scopes.some((scope) => activeScopes.has(scope))
  )
}

export const statusBarContract = defineContract({
  statusBarGlobalItemsValueSpec: defineValueSpec<
    StatusBarItemContribution,
    StatusBarItemType[]
  >({
    name: 'status-bar-global',
    defaultValue: [],
    combine: sortGlobalStatusBarItems,
  }),
  statusBarLocalItemsValueSpec: defineValueSpec<
    StatusBarItemContribution,
    StatusBarItemType[]
  >({
    name: 'status-bar-local',
    defaultValue: [],
    combine: sortLocalStatusBarItems,
  }),
})

export const { statusBarGlobalItemsValueSpec, statusBarLocalItemsValueSpec } =
  statusBarContract
