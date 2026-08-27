import type { Signal } from '@preact/signals'
import { useSignalEffect } from '@preact/signals'
import { Fragment, type ComponentChildren, type JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { type BaseProps, cx } from './shared'
import './split.css'

export type SplitOrientation = 'inline' | 'block'

export interface SplitPane {
  id: string
  content: ComponentChildren
  /** Minimum extent in pixels. Dragging cannot take a pane below this. */
  minSize?: number
}

export interface SplitProps extends BaseProps {
  /** `inline` lays panes out side by side; `block` stacks them. */
  orientation: SplitOrientation
  panes: SplitPane[]
  /**
   * Fractions, one per pane, summing to 1. Two-way: dragging a gutter writes
   * back here, which is what lets the layout service own and persist sizes
   * without the component keeping a second copy of the truth.
   */
  sizes: Signal<number[]>
}

const DEFAULT_MIN = 80

/**
 * A resizable split of two or more panes.
 *
 * Sizes live in a signal owned by the caller rather than in component state.
 * That inversion is deliberate: the layout service is the single home for "how
 * big is everything", so a size change from a drag, from restoring a saved
 * layout, or from a command all take the same path.
 */
export function Split({
  orientation,
  panes,
  sizes,
  class: className,
  ...rest
}: SplitProps) {
  const isInline = orientation === 'inline'
  const container = useRef<HTMLDivElement>(null)

  // One template string drives every pane extent, so a drag frame is a single
  // style write on the container rather than N writes across the panes.
  useSignalEffect(() => {
    const element = container.current
    if (!element) return
    const template = normalize(sizes.value, panes.length)
      .map((fraction) => `minmax(0, ${fraction}fr)`)
      .join(' var(--zds-split-gutter) ')
    element.style.setProperty(
      isInline ? 'grid-template-columns' : 'grid-template-rows',
      template
    )
    element.style.setProperty(
      isInline ? 'grid-template-rows' : 'grid-template-columns',
      ''
    )
  })

  const totalExtent = () => {
    const element = container.current
    if (!element) return 0
    const rect = element.getBoundingClientRect()
    return isInline ? rect.width : rect.height
  }

  const beginDrag = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>,
    gutterIndex: number
  ) => {
    if (event.button !== 0) return
    event.preventDefault()

    const gutter = event.currentTarget
    const extent = totalExtent()
    if (extent <= 0) return

    gutter.setPointerCapture(event.pointerId)
    const startPosition = isInline ? event.clientX : event.clientY
    const startSizes = normalize(sizes.value, panes.length)
    if (container.current) container.current.dataset.dragging = 'true'

    const onMove = (move: PointerEvent) => {
      const position = isInline ? move.clientX : move.clientY
      sizes.value = applyDelta(
        startSizes,
        gutterIndex,
        (position - startPosition) / extent,
        extent,
        panes
      )
    }

    const onUp = () => {
      if (container.current) delete container.current.dataset.dragging
      gutter.removeEventListener('pointermove', onMove)
      gutter.removeEventListener('pointerup', onUp)
      gutter.removeEventListener('pointercancel', onUp)
    }

    gutter.addEventListener('pointermove', onMove)
    gutter.addEventListener('pointerup', onUp)
    gutter.addEventListener('pointercancel', onUp)
  }

  /** Keyboard resizing, so a split is not a mouse-only control. */
  const nudge = (
    event: JSX.TargetedKeyboardEvent<HTMLDivElement>,
    index: number
  ) => {
    const decreaseKey = isInline ? 'ArrowLeft' : 'ArrowUp'
    const increaseKey = isInline ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== decreaseKey && event.key !== increaseKey) return

    event.preventDefault()
    const extent = totalExtent()
    if (extent <= 0) return

    const step = (event.shiftKey ? 40 : 12) / extent
    sizes.value = applyDelta(
      normalize(sizes.value, panes.length),
      index,
      event.key === increaseKey ? step : -step,
      extent,
      panes
    )
  }

  return (
    <div
      {...rest}
      ref={container}
      class={cx('zds-split', `zds-split--${orientation}`, className)}
    >
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 ? (
            <div
              class="zds-split__gutter"
              role="separator"
              tabIndex={0}
              aria-orientation={isInline ? 'vertical' : 'horizontal'}
              aria-label={`Resize ${panes[index - 1].id} and ${pane.id}`}
              onPointerDown={(event) => beginDrag(event, index - 1)}
              onKeyDown={(event) => nudge(event, index - 1)}
            />
          ) : null}
          <div class="zds-split__pane" data-pane-id={pane.id}>
            {pane.content}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** Coerce any stored size array into `count` fractions summing to 1. */
function normalize(sizes: readonly number[], count: number): number[] {
  const usable =
    sizes.length === count ? sizes.slice() : new Array(count).fill(1 / count)
  const total = usable.reduce((sum, value) => sum + (value > 0 ? value : 0), 0)
  if (total <= 0) return new Array(count).fill(1 / count)
  return usable.map((value) => (value > 0 ? value : 0) / total)
}

/**
 * Move one gutter, clamping both neighbours to their minimum sizes.
 *
 * Only the two panes either side of the gutter change, which is what makes a
 * drag feel local instead of rippling through the whole layout.
 */
function applyDelta(
  sizes: readonly number[],
  gutterIndex: number,
  delta: number,
  extent: number,
  panes: readonly SplitPane[]
): number[] {
  const next = sizes.slice()
  const a = gutterIndex
  const b = gutterIndex + 1

  const minA = (panes[a].minSize ?? DEFAULT_MIN) / extent
  const minB = (panes[b].minSize ?? DEFAULT_MIN) / extent
  const pair = next[a] + next[b]

  // If the pair cannot satisfy both minimums there is nothing sensible to do.
  if (pair < minA + minB) return next

  const clamped = Math.min(Math.max(next[a] + delta, minA), pair - minB)
  next[a] = clamped
  next[b] = pair - clamped
  return next
}
