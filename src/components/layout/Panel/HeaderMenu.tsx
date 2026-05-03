import { Menu, Portal } from '@headlessui/react'
import type { CSSProperties, MouseEvent, PropsWithChildren } from 'react'
import { useId, useLayoutEffect, useRef } from 'react'

import { ActionIcon } from '@src/components/ActionIcon'

const MENU_GAP_PX = 4

type AnchorPositionStyle = CSSProperties & {
  anchorName?: string
  positionAnchor?: string
  positionTry?: string
  positionTryFallbacks?: string
}

type PopoverElement = HTMLDivElement & {
  showPopover: () => void
  hidePopover: () => void
}

function isPopoverElement(element: HTMLDivElement): element is PopoverElement {
  return 'showPopover' in element && 'hidePopover' in element
}

function stopPanelMenuButtonClick(e: MouseEvent) {
  e.stopPropagation()
}

function stopPanelMenuItemsClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('a') === null) {
    e.stopPropagation()
    e.preventDefault()
  }
}

export const HeaderMenu = ({ children }: PropsWithChildren) => {
  return (
    <Menu>
      {({ open }) => (
        <HeaderMenuContents open={open}>{children}</HeaderMenuContents>
      )}
    </Menu>
  )
}

const HeaderMenuContents = ({
  children,
  open,
}: PropsWithChildren<{ open: boolean }>) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const anchorName = `--panel-header-menu-${id}`
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const items = itemsRef.current

    if (!open || !items || !isPopoverElement(items)) {
      return
    }

    if (!items.matches(':popover-open')) {
      items.showPopover()
    }

    return () => {
      if (items.matches(':popover-open')) {
        items.hidePopover()
      }
    }
  }, [open])

  const menuItemsStyle = {
    positionAnchor: anchorName,
    right: `anchor(${anchorName} right)`,
    top: `anchor(${anchorName} bottom)`,
    left: 'auto',
    bottom: 'auto',
    marginTop: MENU_GAP_PX,
    positionTry: 'flip-block, flip-inline, flip-block flip-inline',
    positionTryFallbacks: 'flip-block, flip-inline, flip-block flip-inline',
  } as AnchorPositionStyle

  return (
    <div className="relative">
      <Menu.Button
        ref={buttonRef}
        className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none"
        onClick={stopPanelMenuButtonClick}
        style={{ anchorName } as AnchorPositionStyle}
      >
        <ActionIcon
          icon="three-dots"
          className="p-1"
          size="sm"
          bgClassName="bg-transparent dark:bg-transparent"
          iconClassName={'!text-chalkboard-90 dark:!text-chalkboard-40'}
        />
      </Menu.Button>
      <Portal>
        <Menu.Items
          ref={itemsRef}
          popover="manual"
          className="fixed z-50 m-0 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50"
          onClick={stopPanelMenuItemsClick}
          style={menuItemsStyle}
        >
          {children}
        </Menu.Items>
      </Portal>
    </div>
  )
}
