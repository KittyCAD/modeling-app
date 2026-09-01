import { Popover, Portal } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { cleanPaneHeaderButtonClassName } from '@src/components/layout/Panel/CleanPaneHeader'
import { Toolbar } from '@src/Toolbar'
import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'

const panelStyle = {
  inset: 'unset',
  insetInlineStart: 'anchor(50%)',
  insetBlockStart: 'anchor(end)',
  transform: 'translateX(calc(-50% + var(--header-tools-offset-x, 0px)))',
  positionTry: 'flip-block',
  positionTryFallbacks: 'flip-block',
} as CSSProperties

export function HeaderToolbarMenu({
  ariaLabel,
  hiddenItemIds,
  panelTestId,
  title,
  visibleItemIds,
}: {
  ariaLabel: string
  hiddenItemIds?: readonly string[]
  panelTestId: string
  title: string
  visibleItemIds?: readonly string[]
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <Popover className="relative flex flex-none">
      {(popover) => (
        <>
          <Popover.Button
            ref={buttonRef}
            aria-label={ariaLabel}
            className={cleanPaneHeaderButtonClassName}
            title={title}
          >
            <CustomIcon
              className="h-3.5 w-3.5 ui-open:rotate-180"
              name="caretDown"
            />
          </Popover.Button>
          <HeaderToolbarPanel
            buttonRef={buttonRef}
            close={() => popover.close()}
            hiddenItemIds={hiddenItemIds}
            open={popover.open}
            panelRef={panelRef}
            panelTestId={panelTestId}
            visibleItemIds={visibleItemIds}
          />
        </>
      )}
    </Popover>
  )
}

function HeaderToolbarPanel({
  buttonRef,
  close,
  hiddenItemIds,
  open,
  panelRef,
  panelTestId,
  visibleItemIds,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  close: () => void
  hiddenItemIds?: readonly string[]
  open: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  panelTestId: string
  visibleItemIds?: readonly string[]
}) {
  useEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current

    if (!panel) return

    if (!open) {
      panel.hidePopover()
      return
    }

    if (!button) return

    const keepPanelInViewport = () => {
      panel.style.setProperty('--header-tools-offset-x', '0px')
      const panelRect = panel.getBoundingClientRect()
      const viewportPadding = 8
      const leftOverflow = viewportPadding - panelRect.left
      const rightOverflow =
        panelRect.right - (window.innerWidth - viewportPadding)
      const offset =
        leftOverflow > 0 ? leftOverflow : rightOverflow > 0 ? -rightOverflow : 0

      panel.style.setProperty('--header-tools-offset-x', `${offset}px`)
    }

    panel.showPopover({ source: button })
    keepPanelInViewport()

    return () => {
      panel.style.removeProperty('--header-tools-offset-x')
    }
  }, [buttonRef, open, panelRef])

  return (
    <Portal>
      <Popover.Panel
        ref={panelRef}
        popover="manual"
        unmount={false}
        data-testid={panelTestId}
        className="!pointer-events-auto absolute z-50 m-0 mt-2 max-h-[min(38rem,calc(100vh-5rem))] w-64 overflow-y-auto rounded-lg border border-solid border-chalkboard-30 bg-chalkboard-10 p-0 text-inherit shadow-xl dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10"
        style={panelStyle}
      >
        {open ? (
          <Toolbar
            hiddenItemIds={hiddenItemIds}
            onItemClick={close}
            variant="list"
            visibleItemIds={visibleItemIds}
          />
        ) : null}
      </Popover.Panel>
    </Portal>
  )
}
