import { Menu, Portal } from '@headlessui/react'
import type { MouseEvent, PropsWithChildren } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { ActionIcon } from '@src/components/ActionIcon'

const MENU_GAP_PX = 4
const VIEWPORT_PADDING_PX = 8

type MenuPosition = {
  left: number
  top: number
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const updatePosition = useCallback(() => {
    if (!buttonRef.current || !itemsRef.current) {
      return
    }

    const buttonRect = buttonRef.current.getBoundingClientRect()
    const itemsRect = itemsRef.current.getBoundingClientRect()
    const maxLeft = window.innerWidth - itemsRect.width - VIEWPORT_PADDING_PX
    const preferredLeft = buttonRect.right - itemsRect.width
    const left = Math.max(VIEWPORT_PADDING_PX, Math.min(preferredLeft, maxLeft))
    let top = buttonRect.bottom + MENU_GAP_PX

    if (top + itemsRect.height > window.innerHeight - VIEWPORT_PADDING_PX) {
      const topAbove = buttonRect.top - itemsRect.height - MENU_GAP_PX
      top =
        topAbove >= VIEWPORT_PADDING_PX
          ? topAbove
          : Math.max(
              VIEWPORT_PADDING_PX,
              window.innerHeight - itemsRect.height - VIEWPORT_PADDING_PX
            )
    }

    setPosition((previous) =>
      previous?.left === left && previous.top === top ? previous : { left, top }
    )
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updatePosition)
    if (buttonRef.current) {
      resizeObserver?.observe(buttonRef.current)
    }
    if (itemsRef.current) {
      resizeObserver?.observe(itemsRef.current)
    }

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <div className="relative">
      <Menu.Button
        ref={buttonRef}
        className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none"
        onClick={stopPanelMenuButtonClick}
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
          className="fixed z-50 left-0 top-0 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50"
          onClick={stopPanelMenuItemsClick}
          style={
            position
              ? {
                  transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
                }
              : { visibility: 'hidden' }
          }
        >
          {children}
        </Menu.Items>
      </Portal>
    </div>
  )
}
