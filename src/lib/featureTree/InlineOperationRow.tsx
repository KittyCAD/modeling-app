import { ContextMenu } from '@src/components/ContextMenu'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import type { VisibilityToggleProps } from '@src/components/VisibilityToggle'
import type { ComponentProps, ReactNode } from 'react'
import { useRef } from 'react'
import styles from './InlineOperationRow.module.css'

export interface CodeDisclosure {
  expanded: boolean
  onToggle: () => void
}

/** The editor owns its own compact presentation, while OperationItem owns all
 * modeling behavior. No feature-tree utility classes leak into CodeMirror. */
export function InlineOperationRow({
  icon,
  label,
  detail,
  visibility,
  disclosure,
  selected,
  errors = 0,
  menuItems,
  tooltip,
  onContextMenu,
  ...buttonProps
}: Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'onContextMenu'
> & {
  icon: CustomIconName
  label: string
  detail?: string
  visibility?: VisibilityToggleProps
  disclosure?: CodeDisclosure
  selected?: boolean
  errors?: number
  menuItems?: ComponentProps<typeof ContextMenu>['items']
  tooltip?: ReactNode
  onContextMenu?: (event: MouseEvent) => void
}) {
  const menuTarget = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={menuTarget}
      className={styles.row}
      data-selected={selected || undefined}
      data-disabled={buttonProps.disabled || undefined}
      data-testid="feature-tree-operation-item"
    >
      <button {...buttonProps} type="button" className={styles.main}>
        <CustomIcon name={icon} className={styles.icon} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
        {detail && (
          <span className={styles.detail} title={detail}>
            {detail}
          </span>
        )}
        {errors > 0 && (
          <span
            className={styles.error}
            role="img"
            aria-label={`${errors} feature errors`}
          />
        )}
        {tooltip}
      </button>
      <div className={styles.actions}>
        {visibility && (
          <button
            type="button"
            className={`${styles.action} ${visibility.visible ? styles.quiet : ''}`}
            aria-label={`${visibility.visible ? 'Hide' : 'Show'} ${label}`}
            title={`${visibility.visible ? 'Hide' : 'Show'} ${label}`}
            onClick={visibility.onVisibilityChange}
            data-testid="feature-tree-visibility-toggle"
          >
            <CustomIcon
              name={visibility.visible ? 'eyeOpen' : 'eyeCrossedOut'}
              aria-hidden="true"
            />
          </button>
        )}
        {disclosure && (
          <button
            type="button"
            className={styles.action}
            aria-label={`${disclosure.expanded ? 'Hide' : 'Show'} ${label} code`}
            title={`${disclosure.expanded ? 'Hide' : 'Show'} code`}
            aria-expanded={disclosure.expanded}
            onClick={disclosure.onToggle}
          >
            <CustomIcon name="code" aria-hidden="true" />
          </button>
        )}
      </div>
      {menuItems && (
        <ContextMenu
          menuTargetElement={menuTarget}
          items={menuItems}
          callback={onContextMenu}
        />
      )}
    </div>
  )
}
