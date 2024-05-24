import toast from 'react-hot-toast'
import { ActionIcon, ActionIconProps } from './ActionIcon'
import { RefObject, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Menu } from '@headlessui/react'

interface ContextMenuProps
  extends Omit<React.HTMLAttributes<HTMLUListElement>, 'children'> {
  items?: React.ReactElement[]
  menuTargetElement?: RefObject<HTMLElement>
}

const DefaultContextMenuItems = [
  <ContextMenuItemRefresh />,
  <ContextMenuItemCopy />,
  // add more default context menu items here
]

export function ContextMenu({
  items = DefaultContextMenuItems,
  menuTargetElement,
  className,
  ...props
}: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  useHotkeys('esc', () => setOpen(false), {
    enabled: open,
  })
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      console.log('context menu', e)
      e.preventDefault()
      setPosition({ x: e.clientX, y: e.clientY })
      setOpen(true)
    }

    menuTargetElement?.current?.addEventListener(
      'contextmenu',
      handleContextMenu
    )

    return () =>
      menuTargetElement?.current?.removeEventListener(
        'contextmenu',
        handleContextMenu
      )
  }, [menuTargetElement?.current])

  return (
    <Menu>
      {open && (
        <Menu.Items
          as="ul"
          static
          {...props}
          style={{ top: position.y, left: position.x, ...props.style }}
          className={`fixed z-50 flex-col gap-1bg-chalkboard-10 dark:bg-chalkboard-90 border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded shadow-lg ${className}`}
        >
          {items.map((Item, index) => (
            <Menu.Item key={index}>{Item}</Menu.Item>
          ))}
        </Menu.Items>
      )}
    </Menu>
  )
}

interface ContextMenuItemProps {
  children: React.ReactNode
  icon?: ActionIconProps['icon']
  onClick?: () => void
  hotkey?: string
}

function ContextMenuItem({
  children,
  icon,
  onClick,
  hotkey,
}: ContextMenuItemProps) {
  return (
    <div
      className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80"
      onClick={onClick}
    >
      {icon && <ActionIcon icon={icon} bgClassName="!bg-transparent" />}
      <div className="flex-1">{children}</div>
      {hotkey && (
        <kbd className="px-1.5 py-0.5 rounded bg-primary/10 text-primary dark:bg-chalkboard-80 dark:text-chalkboard-40">
          {hotkey}
        </kbd>
      )}
    </div>
  )
}

export function ContextMenuItemRefresh() {
  return (
    <ContextMenuItem
      icon="arrowRotateRight"
      onClick={() => globalThis?.window?.location.reload()}
    >
      Refresh
    </ContextMenuItem>
  )
}

interface ContextMenuItemCopyProps {
  toBeCopiedContent?: string
  toBeCopiedLabel?: string
}

export function ContextMenuItemCopy({
  toBeCopiedContent = globalThis.window?.getSelection()?.toString(),
  toBeCopiedLabel = 'selection',
}: ContextMenuItemCopyProps) {
  return (
    <ContextMenuItem
      icon="clipboardPlus"
      onClick={() => {
        if (toBeCopiedContent) {
          globalThis?.navigator?.clipboard
            .writeText(toBeCopiedContent)
            .then(() => toast.success(`Copied ${toBeCopiedLabel} to clipboard`))
            .catch(() =>
              toast.error(`Failed to copy ${toBeCopiedLabel} to clipboard`)
            )
        }
      }}
    >
      Copy
    </ContextMenuItem>
  )
}
