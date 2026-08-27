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
let showTimer: number | undefined

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host

  labelNode = document.createElement('span')
  labelNode.className = 'zds-tooltip__label'

  shortcutNode = document.createElement('kbd')
  shortcutNode.className = 'zds-tooltip__shortcut'

  host = document.createElement('div')
  host.className = 'zds-tooltip'
  host.setAttribute('role', 'tooltip')
  host.dataset.visible = 'false'
  host.append(labelNode, shortcutNode)
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

  element.dataset.visible = 'true'
  position(anchor, options.placement ?? 'bottom')
}

function hideTooltip() {
  window.clearTimeout(showTimer)
  if (host) host.dataset.visible = 'false'
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

  const onEnter = () => {
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => showTooltip(element, options), delay)
  }

  const onLeave = () => {
    window.clearTimeout(showTimer)
    hideTooltip()
  }

  const onFocus = () => {
    // Keyboard users have no hover intent to read, so skip the delay.
    if (element.matches(':focus-visible')) showTooltip(element, options)
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

  useEffect(() => {
    const element = ref.current
    if (!element || !content) return
    return attachTooltip(element, { content, shortcut, placement, delay })
  }, [content, shortcut, placement, delay])

  return ref
}
