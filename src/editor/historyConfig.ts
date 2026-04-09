import { history } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'

// CodeMirror documents `minDepth` as a minimum, not a hard cap:
// https://codemirror.net/docs/ref/#commands.history^config.minDepth
// In the current `@codemirror/commands` implementation, history pruning only
// kicks in after a branch exceeds roughly `minDepth + 20`, so we leave headroom
// here to keep CodeMirror's retained history at or below Rust's hard checkpoint
// cap. Relevant implementation for the shipped package version:
// https://github.com/codemirror/commands/blob/6.10.3/src/history.ts#L222
// (see `updateBranch`, which trims only after `to + 1 > maxLen + 20`).
const CODEMIRROR_HISTORY_HEADROOM = 20

// Conservative bootstrap value used before the wasm-backed checkpoint limit is
// available. KclManager reconfigures both histories once wasm initialization
// completes.
// Source of truth for this is MAX_SKETCH_CHECKPOINTS in frontend.rs
export const FALLBACK_SKETCH_CHECKPOINT_LIMIT = 100

export function historyMinDepthFromCheckpointLimit(
  checkpointLimit: number
): number {
  return Math.max(0, checkpointLimit - CODEMIRROR_HISTORY_HEADROOM)
}

export function createHistoryExtension(
  checkpointLimit = FALLBACK_SKETCH_CHECKPOINT_LIMIT
): Extension {
  return history({
    minDepth: historyMinDepthFromCheckpointLimit(checkpointLimit),
  })
}
