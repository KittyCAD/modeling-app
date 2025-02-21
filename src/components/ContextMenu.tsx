import toast from 'react-hot-toast'
import { ActionIcon, ActionIconProps } from './ActionIcon'
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog } from '@headlessui/react'

export interface ContextMenuProps
  extends Omit<React.HTMLAttributes<HTMLUListElement>, 'children'> {
  items?: React.ReactElement[]
  menuTargetElement?: RefObject<HTMLElement>
  guard?: (e: globalThis.MouseEvent) => boolean
  event?: 'contextmenu' | 'mouseup'
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
  guard,
  event = 'contextmenu',
  ...props
}: ContextMenuProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [windowSize, setWindowSize] = useState({
    width: globalThis?.window?.innerWidth,
    height: globalThis?.window?.innerHeight,
  })
  const [position, setPosition] = useState({ x: 0, y: 0 })
  useHotkeys('esc', () => setOpen(false), {
    enabled: open,
  })
  const handleContextMenu = useCallback(
    (e: globalThis.MouseEvent) => {
      if (guard && !guard(e)) return
      e.preventDefault()
      setPosition({ x: e.clientX, y: e.clientY })
      setOpen(true)
    },
    [guard, setPosition, setOpen]
  )

  const dialogPositionStyle = useMemo(() => {
    if (!dialogRef.current)
      return {
        top: 0,
        left: 0,
        right: 'auto',
        bottom: 'auto',
      }

    return {
      top:
        position.y + dialogRef.current.clientHeight > windowSize.height
          ? 'auto'
          : position.y,
      left:
        position.x + dialogRef.current.clientWidth > windowSize.width
          ? 'auto'
          : position.x,
      right:
        position.x + dialogRef.current.clientWidth > windowSize.width
          ? windowSize.width - position.x
          : 'auto',
      bottom:
        position.y + dialogRef.current.clientHeight > windowSize.height
          ? windowSize.height - position.y
          : 'auto',
    }
  }, [position, windowSize, dialogRef.current])

  // Listen for window resize to update context menu position
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: globalThis?.window?.innerWidth,
        height: globalThis?.window?.innerHeight,
      })
    }
    globalThis?.window?.addEventListener('resize', handleResize)
    return () => {
      globalThis?.window?.removeEventListener('resize', handleResize)
    }
  }, [])

  // Add context menu listener to target once mounted
  useEffect(() => {
    menuTargetElement?.current?.addEventListener(event, handleContextMenu)
    return () => {
      menuTargetElement?.current?.removeEventListener(event, handleContextMenu)
    }
  }, [menuTargetElement?.current])

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <div
        className="fixed inset-0 z-50 w-screen h-screen"
        onContextMenu={(e) => {
          e.preventDefault()
          setPosition({ x: e.clientX, y: e.clientY })
        }}
      >
        <Dialog.Backdrop className="fixed z-10 inset-0" />
        <Dialog.Panel
          ref={dialogRef}
          className={`w-48 fixed bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
          shadow-lg backdrop:fixed backdrop:inset-0 backdrop:bg-primary ${className}`}
          style={{
            ...dialogPositionStyle,
            ...props.style,
          }}
        >
          <ul
            {...props}
            className="relative flex flex-col gap-0.5 items-stretch content-stretch"
            onClick={() => setOpen(false)}
          >
            {...items}
          </ul>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export function ContextMenuDivider() {
  return <hr className="border-chalkboard-20 dark:border-chalkboard-80" />
}

interface ContextMenuItemProps {
  children: React.ReactNode
  icon?: ActionIconProps['icon']
  onClick?: () => void
  hotkey?: string
  'data-testid'?: string
  disabled?: boolean
}

export function ContextMenuItem(props: ContextMenuItemProps) {
  const { children, icon, onClick, hotkey, disabled } = props

  return (
    <button
      disabled={disabled}
      data-testid={props['data-testid']}
      className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
      onClick={disabled ? undefined : onClick}
    >
      {icon && <ActionIcon icon={icon} bgClassName="!bg-transparent" />}
      <div className="flex-1">{children}</div>
      {hotkey && <kbd className="hotkey">{hotkey}</kbd>}
    </button>
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
