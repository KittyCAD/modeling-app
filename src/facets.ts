import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { RouteObject } from 'react-router-dom'
import { appendFacet, mergeObjectsFacet } from '@src/lib/extensions'

export const routesFacet = appendFacet<RouteObject>('routes')
export const statusBarFacet = mergeObjectsFacet<{
  global: StatusBarItemType[]
  local: StatusBarItemType[]
}>('statusbar', {
  global: [],
  local: [],
})
