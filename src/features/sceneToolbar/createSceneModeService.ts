import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  SceneMode,
  SceneModeGate,
  SceneModeService,
} from '@src/contracts/sceneModes'

export interface SceneModeServiceDependencies {
  modes: ReadonlySignal<readonly SceneMode[]>
  /** Contributed reasons a mode cannot be entered. */
  gates: ReadonlySignal<readonly SceneModeGate[]>
}

/**
 * Which mode the scene is in.
 *
 * The active mode is *derived*, not stored. What is stored is the last mode
 * somebody asked for; whether that is what is active depends on whether it still
 * exists and can still be entered. So a mode that goes away — a feature
 * uninstalled, a sketch closed — cannot leave the scene in a mode with no tools
 * and no way out, which is the failure a stored current-mode always eventually
 * produces.
 */
export function createSceneModeService(
  dependencies: SceneModeServiceDependencies
): SceneModeService {
  const { modes, gates } = dependencies

  /**
   * Whether a mode can be entered, and the first reason it cannot.
   *
   * Every gate has to agree. One reason is reported rather than all of them,
   * because a disabled control has room for one and the first is the one to fix.
   */
  const availability = (mode: SceneMode) => {
    if (!(mode.available?.value ?? true)) {
      return { available: false, reason: mode.unavailableReason }
    }

    const closed = gates.value.find(
      (gate) => gate.mode === mode.id && !gate.available.value
    )

    return closed
      ? { available: false, reason: closed.reason ?? mode.unavailableReason }
      : { available: true }
  }

  const isAvailable = (mode: SceneMode) => availability(mode).available

  const requested = signal<string | null>(null)
  const lastUsed = signal<ReadonlyMap<string, string>>(new Map())

  const active = computed(() => {
    const available = modes.value.filter(isAvailable)

    const asked = available.find((mode) => mode.id === requested.value)
    if (asked) return asked

    /*
     * The request outlives a mode being unavailable, so a sketch that closes and
     * reopens puts you back where you were rather than making you ask twice.
     * Being *refused* is different: `enter` never records a mode it turned down,
     * so a keystroke that did nothing cannot take effect minutes later.
     */

    // The first mode is where you start, and where you land when the mode you
    // were in stops being available.
    return available[0] ?? null
  })

  return {
    modes,
    active,

    availability(modeId) {
      const mode = modes.value.find((candidate) => candidate.id === modeId)
      // A mode that does not exist cannot be entered, and saying "no such mode"
      // to a user would be reporting our problem as theirs.
      if (!mode) return { available: false }
      return availability(mode)
    },
    lastUsed: computed(() => lastUsed.value),

    enter(modeId) {
      const mode = modes.peek().find((candidate) => candidate.id === modeId)
      if (!mode || !isAvailable(mode)) return
      requested.value = modeId
    },

    reset() {
      requested.value = null
    },

    noteUsed(groupId, commandId) {
      const next = new Map(lastUsed.peek())
      next.set(groupId, commandId)
      lastUsed.value = next
    },
  }
}
