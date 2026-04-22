import { StateEffect } from '@codemirror/state'

export type SketchCheckpointHistoryEffect = {
  undoCheckpointId: number | null
  redoCheckpointId: number | null
}

export const sketchCheckpointHistoryEffect =
  StateEffect.define<SketchCheckpointHistoryEffect>()
