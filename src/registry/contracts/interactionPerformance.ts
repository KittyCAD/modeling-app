import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { service } from 'plankton'
export interface InteractionPerformanceService {
  start(): Promise<void>
  snapshot(): InteractionSnapshot
  stop(): InteractionSnapshot
}

export const interactionPerformanceService =
  service<InteractionPerformanceService>('interactionPerformance')
