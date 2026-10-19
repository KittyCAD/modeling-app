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
  /** Native activation or animation lifecycle event that starts this span. */
  inputType?: InteractionInputEvent
  /** Declared native activation/effect timestamp, with pointerdown when available. */
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
  events?: readonly InteractionInputEvent[]
  /** Native drag/resize bursts represent one gesture, not separate activations. */
  coalesce?: 'first' | 'last'
  matchesTarget: (target: Element) => boolean
  matchesEvent?: (event: Event, target: Element) => boolean
  /** Capture the pre-action owner state, without changing application behavior. */
  prepareOutcome?: (
    document: Document,
    target: Element,
    event: Event
  ) => () => boolean
  isReady: (document: Document) => boolean
}

export type InteractionInputEvent =
  | 'click'
  | 'auxclick'
  | 'contextmenu'
  | 'dblclick'
  | 'input'
  | 'keydown'
  | 'keyup'
  | 'pointerover'
  | 'pointerout'
  | 'dragover'
  | 'resize'
  | 'animationstart'
  | 'transitionstart'
