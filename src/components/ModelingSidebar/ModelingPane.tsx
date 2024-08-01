import styles from './ModelingPane.module.css'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { ActionButton } from 'components/ActionButton'
import Tooltip from 'components/Tooltip'
import { CustomIconName } from 'components/CustomIcon'
import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from 'components/ActionIcon'

export interface ModelingPaneProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDivElement> {
  icon?: CustomIconName | IconDefinition
  title: string
  Menu?: React.ReactNode | React.FC
  detailsTestId?: string
  onClose: () => void
}

export const ModelingPaneHeader = ({
  icon,
  title,
  Menu,
  onClose,
}: Pick<ModelingPaneProps, 'icon' | 'title' | 'Menu' | 'onClose'>) => {
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
        <span>{title}</span>
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
        onClick={onClose}
      >
        <Tooltip position="bottom-right" delay={750}>
          Close
        </Tooltip>
      </ActionButton>
    </div>
  )
}

export const ModelingPane = ({
  title,
  icon,
  id,
  children,
  className,
  Menu,
  detailsTestId,
  onClose,
  ...props
}: ModelingPaneProps) => {
  const { settings } = useSettingsAuthContext()
  const onboardingStatus = settings.context.app.onboardingStatus
  const { context } = useModelingContext()
  const pointerEventsCssClass =
    context.store?.buttonDownInStream || onboardingStatus.current === 'camera'
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  return (
    <section
      {...props}
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
      <ModelingPaneHeader
        icon={icon}
        title={title}
        Menu={Menu}
        onClose={onClose}
      />
      <div className="relative w-full">{children}</div>
    </section>
  )
}
