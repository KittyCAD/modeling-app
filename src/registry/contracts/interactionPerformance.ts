import { defineService } from '@kittycad/registry'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'

export interface InteractionPerformanceService {
  start(): Promise<void>
  snapshot(): InteractionSnapshot
  stop(): InteractionSnapshot
}

export const interactionPerformanceService =
  defineService<InteractionPerformanceService>('interactionPerformance')
