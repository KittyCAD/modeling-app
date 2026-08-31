import { type ReadonlySignal, computed, effect, signal } from '@preact/signals'
import type {
  Pointing,
  PointingOrigin,
  PointingService,
} from '@src/contracts/pointing'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import {
  type Provenance,
  provenanceAt,
  provenanceOf,
} from '@src/lib/kcl/provenance'

export interface PointingDependencies {
  /** The graph the last run produced. Empty before one. */
  artifacts: ReadonlySignal<ArtifactMap>
  /**
   * Whatever can light things up, absent when nothing is rendering.
   *
   * A getter because it is resolved from the container. Without one this is a
   * model of what is being pointed at that nobody is showing, which is a
   * perfectly good thing for it to be — the editor still decorates.
   */
  highlighter: () => { highlight: (ids: readonly string[]) => void } | undefined
}

const sameAt = (a: Pointing, b: Pointing): boolean =>
  a.from === b.from &&
  a.at.kind === b.at.kind &&
  (a.at.kind === 'entity'
    ? a.at.id === (b.at as { id: string }).id
    : a.at.offset === (b.at as { offset: number }).offset)

const sameProvenance = (a: Provenance, b: Provenance): boolean =>
  a.absence === b.absence &&
  a.ranges.length === b.ranges.length &&
  a.entities.length === b.entities.length &&
  a.ranges.every((mark, index) => {
    const other = b.ranges[index]
    return (
      mark.role === other.role &&
      mark.range[0] === other.range[0] &&
      mark.range[1] === other.range[1] &&
      mark.range[2] === other.range[2]
    )
  }) &&
  a.entities.every((mark, index) => {
    const other = b.entities[index]
    return mark.id === other.id && mark.role === other.role
  })

/**
 * What the pointer is over, everywhere at once.
 *
 * One signal and one derived answer, which is the whole architecture. Every
 * surface reads it and renders its own half; none of them writes in response to
 * another's read, so the feedback loop that stopped the existing app from ever
 * implementing the code-to-scene direction cannot form here.
 *
 * The only thing it does on its own is tell the renderer what to light, and only
 * for a hover that came from the code. A hover in the scene is already lit by
 * whatever answered the pick — sending a set of ids on top of that would be two
 * things arguing over the same highlight.
 */
export function createPointing(
  dependencies: PointingDependencies
): PointingService & { start: () => void; dispose: () => void } {
  const pointing = signal<Pointing | null>(null)

  /**
   * Identity-stable, which is not an optimisation but a requirement.
   *
   * Moving the pointer one character along changes the offset and so changes the
   * pointing, but the answer is the same call and the same faces. A consumer
   * that dispatches an editor transaction per change would dispatch one per
   * pixel of mouse travel; returning the previous object when nothing differs is
   * what lets every consumer skip by comparing.
   */
  let last: Provenance | null = null

  const provenance = computed<Provenance | null>(() => {
    const current = pointing.value
    if (!current) {
      last = null
      return null
    }

    const artifacts = dependencies.artifacts.value
    const found =
      current.at.kind === 'entity'
        ? provenanceOf(artifacts, current.at.id)
        : provenanceAt(artifacts, current.at.offset)

    if (last && sameProvenance(last, found)) return last
    last = found
    return found
  })

  /**
   * Light what a line of code made.
   *
   * Only for `code`, because that is the half the renderer does not already
   * know. Clearing when the origin changes is deliberate and is why this
   * compares against what was last sent rather than firing every time: a hover
   * moving from the editor to the scene has to take the code-driven highlight
   * away exactly once, and then leave the engine's own hover alone.
   */
  let told: readonly string[] = []

  const push = () =>
    effect(() => {
      const current = pointing.value
      const found = provenance.value

      const wanted =
        current?.from === 'code' && found
          ? found.entities.map((mark) => mark.id)
          : []

      if (
        wanted.length === told.length &&
        wanted.every((id, index) => id === told[index])
      ) {
        return
      }

      told = wanted
      dependencies.highlighter()?.highlight(wanted)
    })

  let stop: (() => void) | null = null

  return {
    pointing: computed(() => pointing.value),
    provenance,

    point(next) {
      const current = pointing.peek()
      // Deduplicated here rather than by each caller: a pointermove handler
      // fires far more often than the answer changes.
      if (current && sameAt(current, next)) return

      pointing.value = next
    },

    clear(from: PointingOrigin) {
      if (pointing.peek()?.from !== from) return
      pointing.value = null
    },

    /**
     * Begin telling the renderer.
     *
     * Separate from construction as everything with an effect here is: the
     * effect resolves a service on its first run, and the container forbids that
     * while the registry graph is being flattened. Idempotent.
     */
    start() {
      if (!stop) stop = push()
    },

    dispose() {
      stop?.()
      stop = null
    },
  }
}
