import { defineService } from '@kittycad/registry'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'

export interface InteractionPerformanceService {
  start(): void
  snapshot(): InteractionSnapshot
  stop(): InteractionSnapshot
}

export const interactionPerformanceService =
  defineService<InteractionPerformanceService>('interactionPerformance')
