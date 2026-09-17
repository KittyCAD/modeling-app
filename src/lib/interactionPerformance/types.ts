export interface InteractionTiming {
  durationMs: number
  inputDelayMs: number
  processingMs: number
  presentationDelayMs: number
}

export interface InteractionSample {
  sequence: number
  id: string | null
  targetTag: string
  startTime: number
  renderOpportunityMs: number | null
  outcomeMs: number | null
  eventTiming: InteractionTiming | null
  status: 'pending' | 'complete' | 'unattributed' | 'timeout'
}

export interface InteractionDescription {
  id: string
  testId: string
  budgetMs: number
  outcome: string
}

export interface InteractionSnapshot {
  samples: InteractionSample[]
  registered: InteractionDescription[]
  droppedSamples: number
  droppedPointerEvents: number
  visibilityInterrupted: boolean
}

export interface InteractionDefinition extends InteractionDescription {
  isReady: (document: Document) => boolean
}
