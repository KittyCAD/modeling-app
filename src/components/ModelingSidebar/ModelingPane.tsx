import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import type { ReactNode } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { ActionIcon } from '@src/components/ActionIcon'
import type { CustomIconName } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useSettings } from '@src/machines/appMachine'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import styles from './ModelingPane.module.css'

export interface ModelingPaneProps {
  id: string
  children: ReactNode | ReactNode[]
  className?: string
  icon?: CustomIconName | IconDefinition
  title: ReactNode
  Menu?: React.ReactNode | React.FC
  detailsTestId?: string
  onClose: () => void
}

export const ModelingPaneHeader = ({
  id,
  icon,
  title,
  Menu,
  onClose,
}: Pick<ModelingPaneProps, 'id' | 'icon' | 'title' | 'Menu' | 'onClose'>) => {
  return (
    <div className={styles.header}>
      <div className="flex gap-2 items-center flex-1">
        {icon && (
          <ActionIcon
            icon={icon}
            className="p-1"
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

export const ModelingPane = ({
  id,
  children,
  className,
  detailsTestId,
  onClose,
  title,
  ...props
}: ModelingPaneProps) => {
  const settings = useSettings()
  const onboardingStatus = settings.app.onboardingStatus
  const pointerEventsCssClass =
    onboardingStatus.current === onboardingPaths.CAMERA
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  return (
    <section
      {...props}
      aria-label={title && typeof title === 'string' ? title : ''}
      data-testid={detailsTestId}
      id={id}
      className={
        'focus-within:border-primary dark:focus-within:border-chalkboard-50 ' +
        pointerEventsCssClass +
        styles.panel +
        ' group ' +
        (className || '')
      }
    >
      {children}
    </section>
  )
}
