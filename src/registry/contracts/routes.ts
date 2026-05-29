import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { RouteObject } from 'react-router-dom'

export const routesContract = defineContract({
  routesValueSpec: appendValueSpec<RouteObject>('routes'),
})

export const { routesValueSpec } = routesContract
