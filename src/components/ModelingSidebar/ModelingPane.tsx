import { useStore } from 'useStore'
import styles from './ModelingPane.module.css'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'

export interface ModelingPaneProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDivElement> {
  title: string
  Menu?: React.ReactNode | React.FC
  detailsTestId?: string
}

export const ModelingPaneHeader = ({
  title,
  Menu,
}: Pick<ModelingPaneProps, 'title' | 'Menu'>) => {
  return (
    <div className={styles.header}>
      <div className="flex gap-2 items-center flex-1">{title}</div>
      {Menu instanceof Function ? <Menu /> : Menu}
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
  ...props
}: ModelingPaneProps) => {
  const { settings } = useSettingsAuthContext()
  const onboardingStatus = settings.context.app.onboardingStatus
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const pointerEventsCssClass =
    buttonDownInStream || onboardingStatus.current === 'camera'
      ? 'pointer-events-none '
      : 'pointer-events-auto '
  return (
    <section
      {...props}
      data-testid={detailsTestId}
      id={id}
      className={
        pointerEventsCssClass + styles.panel + ' group ' + (className || '')
      }
    >
      <ModelingPaneHeader title={title} Menu={Menu} />
      <div className="relative w-full">{children}</div>
    </section>
  )
}
