import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import type { ReactNode } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { ActionIcon } from '@src/components/ActionIcon'
import type { CustomIconName } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'

import styles from './index.module.css'

export interface LayoutPanelProps {
  id: string
  children: ReactNode | ReactNode[]
  className?: string
  icon?: CustomIconName | IconDefinition
  title: ReactNode
  Menu?: React.ReactNode | React.FC
  detailsTestId?: string
  onClose: () => void
}

export const LayoutPanelHeader = ({
  id,
  icon,
  title,
  Menu,
  onClose,
}: Pick<LayoutPanelProps, 'id' | 'icon' | 'title' | 'Menu' | 'onClose'>) => {
  return (
    <div className={styles.header}>
      <div className="flex gap-2 items-center flex-1">
        {icon && (
          <ActionIcon
            icon={icon}
            size="sm"
            iconClassName="!text-chalkboard-80 dark:!text-chalkboard-30"
            bgClassName="!bg-transparent"
          />
        )}
        <span data-testid={id + '-header'}>{title}</span>
      </div>
      {Menu instanceof Function ? <Menu /> : Menu}
      <ActionButton
        Element="button"
        iconStart={{
          icon: 'close',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent dark:bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none"
        onClick={() => onClose()}
      >
        <Tooltip position="bottom-right">Close</Tooltip>
      </ActionButton>
    </div>
  )
}

export const LayoutPanel = ({
  id,
  children,
  className,
  detailsTestId,
  onClose,
  title,
  ...props
}: LayoutPanelProps) => {
  return (
    <section
      {...props}
      aria-label={title && typeof title === 'string' ? title : ''}
      data-testid={detailsTestId}
      id={id}
      className={
        'focus-within:border-primary dark:focus-within:border-chalkboard-50 ' +
        styles.panel +
        ' group ' +
        (className || '')
      }
    >
      {children}
    </section>
  )
}
