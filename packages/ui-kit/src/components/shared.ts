import type { ReadonlySignal } from '@preact/signals'
import type { JSX } from 'preact'

/**
 * A prop that may be a constant or a signal.
 *
 * Preact subscribes to signals passed into DOM props and children directly,
 * without re-running the owning component, so accepting them here is how a
 * component stays cheap to update.
 */
export type MaybeSignal<T> = T | ReadonlySignal<T>

/**
 * Props every component accepts, so host apps can always reach the element.
 *
 * Deliberately excludes `title`: several components use that word for their own
 * visible heading, and having it also mean the native tooltip attribute makes
 * both meanings unreliable. Components that want a tooltip take one explicitly.
 */
export interface BaseProps {
  class?: string
  id?: string
  'data-testid'?: string
}

export type ControlSize = 'small' | 'medium' | 'large'

/** Join class names, dropping the falsy ones. */
export function cx(
  ...values: (string | false | null | undefined)[]
): string | undefined {
  const joined = values.filter(Boolean).join(' ')
  return joined || undefined
}

let idCounter = 0

/** Stable unique id, for label/control and aria relationships. */
export function uniqueId(prefix = 'zds'): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export type DivProps = JSX.HTMLAttributes<HTMLDivElement>
