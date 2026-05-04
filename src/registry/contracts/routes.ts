import type { RouteObject } from 'react-router-dom'
import { appendValueSpec, defineContract } from '@kittycad/registry'

export const routesContract = defineContract({
  routesValueSpec: appendValueSpec<RouteObject>('routes'),
})

export const { routesValueSpec } = routesContract
