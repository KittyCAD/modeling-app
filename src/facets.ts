import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { RouteObject } from 'react-router-dom'
import { appendFacet } from '@src/lib/extensions'

export const routesFacet = appendFacet<RouteObject>('routes')
export const statusBarGlobalItemsFacet =
  appendFacet<StatusBarItemType>('status-bar-global')
export const statusBarLocalItemsFacet =
  appendFacet<StatusBarItemType>('status-bar-local')
