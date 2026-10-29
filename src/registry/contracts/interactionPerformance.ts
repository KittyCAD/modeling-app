import { defineService } from '@kittycad/registry'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'

export interface InteractionPerformanceService {
  start(interactionIds?: readonly string[]): Promise<void>
  snapshot(): InteractionSnapshot
  stop(): InteractionSnapshot
}

export const interactionPerformanceService =
  defineService<InteractionPerformanceService>('interactionPerformance')
