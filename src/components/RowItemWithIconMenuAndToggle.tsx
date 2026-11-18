import { ContextMenu } from '@src/components/ContextMenu'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import type { ComponentProps, ReactNode } from 'react'
import { useRef } from 'react'

export function RowItemWithIconMenuAndToggle({
  icon,
  children,
  LabelSecondary,
  Warning,
  Tooltip,
  Toggle,
  menuItems,
  isSelected,
  size = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: CustomIconName
  LabelSecondary?: ReactNode
  Warning?: ReactNode
  Tooltip?: ReactNode
  Toggle?: ReactNode
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  // The button element has onContextMenu already but the type is too narrow
  onContextMenu?: (e: MouseEvent) => void
  size?: 'default' | 'sm'
  isSelected?: boolean
}) {
  const menuRef = useRef(null)
  return (
    <div
      ref={menuRef}
      className={`flex select-none items-center group/visibilityToggle my-0 py-0.5 px-1 rounded-sm focus-within:ring-1 focus-within:ring-primary ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''} ${isSelected ? 'bg-primary/25 hover:bg-primary/25' : 'hover:bg-2'}`}
      data-testid="feature-tree-operation-item"
      data-selected={isSelected || undefined}
    >
      <button
        {...props}
        className={`reset min-w-[0px] py-0.5 flex-1 flex items-center gap-2 text-left text-base !border-transparent ${props.className}`}
      >
        {icon ? (
          <CustomIcon
            name={icon}
            className={`${size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} block shrink-0`}
            aria-hidden
          />
        ) : null}
        <div
          className={`${size === 'sm' ? 'text-xs' : 'text-sm'} flex-1 flex gap-x-2 overflow-x-hidden items-baseline align-baseline`}
        >
          <span className="min-w-0 truncate">{children}</span>
          {LabelSecondary ?? null}
        </div>
        {Warning ?? null}
        {Tooltip ?? null}
      </button>
      {Toggle ?? null}
      {menuItems ? (
        <ContextMenu
          menuTargetElement={menuRef}
          items={menuItems}
          callback={(e) => {
            props.onContextMenu?.(e)
          }}
        />
      ) : null}
    </div>
  )
}
