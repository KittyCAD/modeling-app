import { Popover } from '@headlessui/react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useEffect, useId, useRef } from 'react'

type ToolbarDropdownPanelProps = {
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  open: boolean
}

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

      const updatePanelOffset = () => {
        panel.style.setProperty('--toolbar-dropdown-offset-x', '0px')

        const panelRect = panel.getBoundingClientRect()
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
      updatePanelOffset()

      return () => {
        panel.style.removeProperty('--toolbar-dropdown-offset-x')
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
