import { ReactNode, ComponentProps, useRef } from 'react'
import { ContextMenu } from '@src/components/ContextMenu'
import { CustomIconName, CustomIcon } from '@src/components/CustomIcon'

export function RowItemWithIconMenuAndToggle({
  icon,
  children,
  LabelSecondary,
  Warning,
  Tooltip,
  Toggle,
  menuItems,
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
}) {
  const menuRef = useRef(null)
  return (
    <div
      ref={menuRef}
      className={`flex select-none items-center group/visibilityToggle my-0 py-0.5 px-1 ${props.disabled ? 'opacity-50 cursor-not-allowed' : 'focus-within:bg-primary/25 hover:bg-2 hover:focus-within:bg-primary/25'}`}
      data-testid="feature-tree-operation-item"
    >
      <button
        {...props}
        className={`reset min-w-[0px] py-1 flex-1 flex items-center gap-2 text-left text-base !border-transparent ${props.className}`}
      >
        {icon ? (
          <CustomIcon
            name={icon}
            className="w-6 h-6 block self-start"
            aria-hidden
          />
        ) : null}
        <div className="text-sm flex-1 flex gap-x-2 overflow-x-hidden items-baseline align-baseline">
          <span className="text-sm">{children}</span>
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
