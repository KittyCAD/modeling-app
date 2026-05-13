import { Popover } from '@headlessui/react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'

type ToolbarDropdownPanelProps = {
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  open: boolean
}

const panelStyle = {
  inset: 'unset',
  insetInlineStart: 'anchor(50%)',
  insetBlockStart: 'anchor(end)',
  transform: 'translateX(calc(-50% + var(--toolbar-dropdown-offset-x, 0px)))',
  positionTry: 'flip-block',
  positionTryFallbacks: 'flip-block',
} as CSSProperties

export function ToolbarDropdownPanel({
  buttonRef,
  children,
  open,
}: ToolbarDropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current

    if (!panel) {
      return
    }

    if (open) {
      if (!button) {
        return
      }

      const updatePanelOffset = () => {
        // Keep the dropdown centered unless it would overflow the viewport.
        panel.style.setProperty('--toolbar-dropdown-offset-x', '0px')

        const panelRect = panel.getBoundingClientRect()
        const viewportPadding = 8
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
      }
    }

    panel.hidePopover()
  }, [buttonRef, open])

  return (
    <Popover.Panel
      ref={panelRef}
      popover="manual"
      className="!pointer-events-auto absolute z-20 mt-4 w-fit max-w-[280px] max-h-[80vh] overflow-y-auto text-inherit dark:text-chalkboard-10 bg-chalkboard-10 dark:bg-chalkboard-100 rounded shadow-lg border border-solid border-chalkboard-30 dark:border-chalkboard-80 text-sm m-0 p-0"
      style={panelStyle}
      unmount={false}
    >
      <ul className="m-0 p-0 py-2 flex flex-col align-stretch">{children}</ul>
    </Popover.Panel>
  )
}
