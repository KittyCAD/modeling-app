import { Popover } from '@headlessui/react'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { reportRejection } from '@src/lib/trap'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useEffect, useId, useRef } from 'react'

type ToolbarDropdownPanelProps = {
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  open: boolean
}

const anchorTolerance = 2
const dropdownGap = 16
const viewportPadding = 8

const panelStyle = {
  inset: 'unset',
  insetInlineStart: 'anchor(50%)',
  insetBlockStart: 'anchor(end)',
  marginBlockStart: `${dropdownGap}px`,
  transform: 'translateX(calc(-50% + var(--toolbar-dropdown-offset-x, 0px)))',
  positionTry: 'flip-block',
  positionTryFallbacks: 'flip-block',
} as CSSProperties

function resetPanelToAnchorPosition(panel: HTMLElement) {
  panel.style.removeProperty('bottom')
  panel.style.removeProperty('left')
  panel.style.removeProperty('position')
  panel.style.removeProperty('right')
  panel.style.removeProperty('top')
  panel.style.inset = 'unset'
  panel.style.insetInlineStart = 'anchor(50%)'
  panel.style.insetBlockStart = 'anchor(end)'
  panel.style.marginBlockStart = `${dropdownGap}px`
  panel.style.transform =
    'translateX(calc(-50% + var(--toolbar-dropdown-offset-x, 0px)))'
}

function isPanelAnchoredToButton(panelRect: DOMRect, buttonRect: DOMRect) {
  const horizontallyCentered =
    Math.abs(
      panelRect.left +
        panelRect.width / 2 -
        (buttonRect.left + buttonRect.width / 2)
    ) <= anchorTolerance
  const verticallyAttached =
    Math.abs(panelRect.top - (buttonRect.bottom + dropdownGap)) <=
      anchorTolerance ||
    Math.abs(panelRect.bottom - (buttonRect.top - dropdownGap)) <=
      anchorTolerance

  return horizontallyCentered && verticallyAttached
}

function rectToReport(rect: DOMRect) {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  }
}

function cssSupports(property: string, value: string) {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports(property, value)
    : false
}

function isPopoverOpen(panel: HTMLElement) {
  try {
    return panel.matches(':popover-open')
  } catch {
    return undefined
  }
}

function reportUnresolvedAnchor(
  panel: HTMLElement,
  button: HTMLElement,
  panelRect: DOMRect,
  buttonRect: DOMRect
) {
  const buttonStyle = window.getComputedStyle(button)
  const panelComputedStyle = window.getComputedStyle(panel)
  const buttonAnchorName = buttonStyle.getPropertyValue('anchor-name')
  const panelPositionAnchor =
    panelComputedStyle.getPropertyValue('position-anchor')

  void reportClientError({
    code: ClientErrorCode.ToolbarDropdownAnchorPositioningError,
    errorName: 'ToolbarDropdownAnchorPositioningError',
    message: 'Toolbar dropdown CSS anchor positioning did not resolve.',
    dedupeKey: 'ToolbarDropdownPanel:unresolved-css-anchor',
    extra: {
      source: 'ToolbarDropdownPanel',
      buttonRect: rectToReport(buttonRect),
      panelRect: rectToReport(panelRect),
      computedAnchorStyles: {
        buttonAnchorNameSet: Boolean(buttonAnchorName),
        panelPositionAnchorSet: Boolean(panelPositionAnchor),
        anchorNamesMatch:
          Boolean(buttonAnchorName) && buttonAnchorName === panelPositionAnchor,
        panelPosition: panelComputedStyle.position,
        panelInsetBlockStart:
          panelComputedStyle.getPropertyValue('inset-block-start'),
        panelInsetInlineStart:
          panelComputedStyle.getPropertyValue('inset-inline-start'),
        panelTransform: panelComputedStyle.transform,
      },
      cssSupport: {
        anchorName: cssSupports('anchor-name', '--toolbar-dropdown'),
        positionAnchor: cssSupports('position-anchor', '--toolbar-dropdown'),
        anchorFunction: cssSupports('inset-block-start', 'anchor(end)'),
      },
      triggerOnboardingId: button.getAttribute('data-onboarding-id'),
      panelIsPopoverOpen: isPopoverOpen(panel),
      viewport: {
        devicePixelRatio: window.devicePixelRatio,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    },
  }).catch(reportRejection)
}

function positionPanelFromButton(panel: HTMLElement, button: HTMLElement) {
  const buttonRect = button.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const maxLeft = Math.max(
    viewportPadding,
    window.innerWidth - viewportPadding - panelRect.width
  )
  const maxTop = Math.max(
    viewportPadding,
    window.innerHeight - viewportPadding - panelRect.height
  )
  const centeredLeft =
    buttonRect.left + buttonRect.width / 2 - panelRect.width / 2
  const belowButton = buttonRect.bottom + dropdownGap
  const aboveButton = buttonRect.top - dropdownGap - panelRect.height
  const preferredTop =
    belowButton + panelRect.height > window.innerHeight - viewportPadding &&
    aboveButton >= viewportPadding
      ? aboveButton
      : belowButton
  const left = Math.min(Math.max(centeredLeft, viewportPadding), maxLeft)
  const top = Math.min(Math.max(preferredTop, viewportPadding), maxTop)

  panel.style.inset = 'auto'
  panel.style.insetInlineStart = 'auto'
  panel.style.insetBlockStart = 'auto'
  panel.style.marginBlockStart = '0'
  panel.style.position = 'fixed'
  panel.style.transform = 'none'
  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

function restoreStyleProperty(
  element: HTMLElement,
  property: string,
  value: string,
  priority: string
) {
  if (value) {
    element.style.setProperty(property, value, priority)
  } else {
    element.style.removeProperty(property)
  }
}

export function ToolbarDropdownPanel({
  buttonRef,
  children,
  open,
}: ToolbarDropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const anchorName = `--toolbar-dropdown-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current

    if (!panel) {
      return
    }

    const previousButtonAnchor = button?.style.getPropertyValue('anchor-name')
    const previousButtonAnchorPriority =
      button?.style.getPropertyPriority('anchor-name')
    const previousPanelAnchor = panel.style.getPropertyValue('position-anchor')
    const previousPanelAnchorPriority =
      panel.style.getPropertyPriority('position-anchor')

    if (button) {
      button.style.setProperty('anchor-name', anchorName)
    }
    panel.style.setProperty('position-anchor', anchorName)

    const restoreAnchors = () => {
      if (button) {
        restoreStyleProperty(
          button,
          'anchor-name',
          previousButtonAnchor ?? '',
          previousButtonAnchorPriority ?? ''
        )
      }
      restoreStyleProperty(
        panel,
        'position-anchor',
        previousPanelAnchor,
        previousPanelAnchorPriority
      )
    }

    if (open) {
      if (!button) {
        restoreAnchors()
        return
      }

      const updatePanelPosition = () => {
        resetPanelToAnchorPosition(panel)
        panel.style.setProperty('--toolbar-dropdown-offset-x', '0px')

        const panelRect = panel.getBoundingClientRect()
        const buttonRect = button.getBoundingClientRect()
        if (!isPanelAnchoredToButton(panelRect, buttonRect)) {
          reportUnresolvedAnchor(panel, button, panelRect, buttonRect)
          positionPanelFromButton(panel, button)
          return
        }

        // Keep the anchored dropdown centered unless it would overflow the viewport.
        const leftOverflow = viewportPadding - panelRect.left
        const rightOverflow =
          panelRect.right - (window.innerWidth - viewportPadding)
        const offset =
          leftOverflow > 0
            ? leftOverflow
            : rightOverflow > 0
              ? -rightOverflow
              : 0

        panel.style.setProperty('--toolbar-dropdown-offset-x', `${offset}px`)
      }
      // @ts-ignore-next-line -- React is not up to date about the options that can be passed
      panel.showPopover({ source: button })
      updatePanelPosition()
      window.addEventListener('resize', updatePanelPosition)
      window.addEventListener('scroll', updatePanelPosition, true)

      return () => {
        window.removeEventListener('resize', updatePanelPosition)
        window.removeEventListener('scroll', updatePanelPosition, true)
        panel.style.removeProperty('--toolbar-dropdown-offset-x')
        resetPanelToAnchorPosition(panel)
        restoreAnchors()
      }
    }

    panel.hidePopover()
    return restoreAnchors
  }, [anchorName, buttonRef, open])

  return (
    <Popover.Panel
      ref={panelRef}
      popover="manual"
      className="!pointer-events-auto absolute z-20 w-fit max-w-[280px] max-h-[80vh] overflow-y-auto text-inherit dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-30 dark:border-chalkboard-80 text-sm m-0 p-0"
      style={panelStyle}
      unmount={false}
    >
      <ul className="m-0 p-0 py-2 flex flex-col align-stretch">{children}</ul>
    </Popover.Panel>
  )
}
