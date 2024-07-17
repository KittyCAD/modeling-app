import styles from './ModelingPane.module.css'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { ActionButton } from 'components/ActionButton'
import Tooltip from 'components/Tooltip'

export interface ModelingPaneProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDivElement> {
  title: string
  Menu?: React.ReactNode | React.FC
  detailsTestId?: string
  onClose: () => void
}

export const ModelingPaneHeader = ({
  title,
  Menu,
  onClose,
}: Pick<ModelingPaneProps, 'title' | 'Menu' | 'onClose'>) => {
  return (
    <div className={styles.header}>
      <div className="flex gap-2 items-center flex-1">{title}</div>
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
        'group-focus-within:border-primary dark:group-focus-within:border-chalkboard-50 ' +
        pointerEventsCssClass +
        styles.panel +
        ' group ' +
        (className || '')
      }
    >
      <ModelingPaneHeader title={title} Menu={Menu} onClose={onClose} />
      <div className="relative w-full">{children}</div>
    </section>
  )
}
