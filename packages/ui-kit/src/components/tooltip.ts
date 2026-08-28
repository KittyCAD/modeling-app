import { useEffect, useRef } from 'preact/hooks'
import './tooltip.css'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipOptions {
  content: string
  /** Rendered in mono after the label, e.g. `⌘K`. */
  shortcut?: string
  placement?: TooltipPlacement
  /** Delay before showing on hover. Focus always shows immediately. */
  delay?: number
  /**
   * What the thing does, shown only after a longer dwell.
   *
   * Two phases, because the two questions are asked at different speeds. Someone
   * sweeping a toolbar wants the *name*, instantly and out of the way; someone
   * who has stopped on a button wants to know what it does, and by then they are
   * reading rather than scanning. One tooltip carrying both would either be slow
   * to name things or a paragraph in the way.
   */
  description?: string
  /** How long the pointer must rest before the description appears. */
  descriptionDelay?: number
}

/**
 * One tooltip element for the whole document.
 *
 * A tooltip is transient and never more than one at a time, so there is no
 * reason for every tooltip-bearing control to render its own node. A singleton
 * keeps hundreds of chassis buttons from each adding DOM, and keeps tooltips
 * out of the layout entirely — no wrapper element to disturb a flex row.
 */
let host: HTMLElement | null = null
let labelNode: HTMLElement | null = null
let shortcutNode: HTMLElement | null = null
let descriptionNode: HTMLElement | null = null
let showTimer: number | undefined
let describeTimer: number | undefined

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host

  labelNode = document.createElement('span')
  labelNode.className = 'zds-tooltip__label'

  shortcutNode = document.createElement('kbd')
  shortcutNode.className = 'zds-tooltip__shortcut'

  descriptionNode = document.createElement('p')
  descriptionNode.className = 'zds-tooltip__description'
  descriptionNode.hidden = true

  host = document.createElement('div')
  host.className = 'zds-tooltip'
  host.setAttribute('role', 'tooltip')
  host.dataset.visible = 'false'
  host.append(labelNode, shortcutNode, descriptionNode)
  document.body.appendChild(host)

  return host
}

const OFFSET = 6
const EDGE = 4

const opposite: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

function position(anchor: Element, placement: TooltipPlacement) {
  const element = ensureHost()
  const rect = anchor.getBoundingClientRect()
  const own = element.getBoundingClientRect()
  const viewport = { width: window.innerWidth, height: window.innerHeight }

  const fits = (candidate: TooltipPlacement) => {
    switch (candidate) {
      case 'top':
        return rect.top - own.height - OFFSET >= 0
      case 'bottom':
        return rect.bottom + own.height + OFFSET <= viewport.height
      case 'left':
        return rect.left - own.width - OFFSET >= 0
      case 'right':
        return rect.right + own.width + OFFSET <= viewport.width
    }
  }

  const resolved = fits(placement) ? placement : opposite[placement]

  let top = 0
  let left = 0
  switch (resolved) {
    case 'top':
      top = rect.top - own.height - OFFSET
      left = rect.left + rect.width / 2 - own.width / 2
      break
    case 'bottom':
      top = rect.bottom + OFFSET
      left = rect.left + rect.width / 2 - own.width / 2
      break
    case 'left':
      top = rect.top + rect.height / 2 - own.height / 2
      left = rect.left - own.width - OFFSET
      break
    case 'right':
      top = rect.top + rect.height / 2 - own.height / 2
      left = rect.right + OFFSET
      break
  }

  // Keep the tooltip on screen along whichever axis is still free.
  left = Math.min(Math.max(EDGE, left), viewport.width - own.width - EDGE)
  top = Math.min(Math.max(EDGE, top), viewport.height - own.height - EDGE)

  element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  element.dataset.placement = resolved
}

function showTooltip(anchor: Element, options: TooltipOptions) {
  const element = ensureHost()

  if (labelNode) labelNode.textContent = options.content
  if (shortcutNode) {
    shortcutNode.textContent = options.shortcut ?? ''
    shortcutNode.hidden = !options.shortcut
  }
  // The name arrives on its own. Anything longer has to be waited for.
  if (descriptionNode) {
    descriptionNode.textContent = ''
    descriptionNode.hidden = true
  }
  element.dataset.expanded = 'false'

  element.dataset.visible = 'true'
  position(anchor, options.placement ?? 'bottom')
}

/** Grow the tooltip into the fuller answer, in place. */
function describeTooltip(anchor: Element, options: TooltipOptions) {
  const element = ensureHost()
  if (element.dataset.visible !== 'true' || !options.description) return

  if (descriptionNode) {
    descriptionNode.textContent = options.description
    descriptionNode.hidden = false
  }
  element.dataset.expanded = 'true'
  // Re-measured, because it just got taller: the same placement rules, against
  // a different box.
  position(anchor, options.placement ?? 'bottom')
}

function hideTooltip() {
  window.clearTimeout(showTimer)
  window.clearTimeout(describeTimer)
  if (host) {
    host.dataset.visible = 'false'
    host.dataset.expanded = 'false'
  }
}

/**
 * Give an element a tooltip, imperatively.
 *
 * Exposed for callers outside the component tree; inside a component prefer
 * `useTooltip`.
 */
export function attachTooltip(
  element: HTMLElement,
  options: TooltipOptions
): () => void {
  const delay = options.delay ?? 350
  const describeDelay = options.descriptionDelay ?? 900

  const describeLater = () => {
    if (!options.description) return
    window.clearTimeout(describeTimer)
    describeTimer = window.setTimeout(
      () => describeTooltip(element, options),
      describeDelay
    )
  }

  const onEnter = () => {
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => {
      showTooltip(element, options)
      // Timed from when the name appeared, not from when the pointer arrived, so
      // the two delays add up the way they read: a name, then a beat, then more.
      describeLater()
    }, delay)
  }

  const onLeave = () => {
    window.clearTimeout(showTimer)
    hideTooltip()
  }

  const onFocus = () => {
    // Keyboard users have no hover intent to read, so skip the delay.
    if (element.matches(':focus-visible')) {
      showTooltip(element, options)
      describeLater()
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideTooltip()
  }

  element.addEventListener('pointerenter', onEnter)
  element.addEventListener('pointerleave', onLeave)
  element.addEventListener('pointerdown', onLeave)
  element.addEventListener('focus', onFocus)
  element.addEventListener('blur', onLeave)
  element.addEventListener('keydown', onKeyDown)

  return () => {
    element.removeEventListener('pointerenter', onEnter)
    element.removeEventListener('pointerleave', onLeave)
    element.removeEventListener('pointerdown', onLeave)
    element.removeEventListener('focus', onFocus)
    element.removeEventListener('blur', onLeave)
    element.removeEventListener('keydown', onKeyDown)
    onLeave()
  }
}

/**
 * Attach a tooltip to whatever the returned ref lands on.
 *
 * Pass `undefined` for `options` to leave the element without a tooltip, so
 * callers do not need to branch on whether they have anything to say.
 */
export function useTooltip<T extends HTMLElement>(
  options: TooltipOptions | undefined
) {
  const ref = useRef<T>(null)
  const content = options?.content
  const shortcut = options?.shortcut
  const placement = options?.placement
  const delay = options?.delay
  const description = options?.description
  const descriptionDelay = options?.descriptionDelay

  useEffect(() => {
    const element = ref.current
    if (!element || !content) return
    return attachTooltip(element, {
      content,
      shortcut,
      placement,
      delay,
      description,
      descriptionDelay,
    })
  }, [content, shortcut, placement, delay, description, descriptionDelay])

  return ref
}
