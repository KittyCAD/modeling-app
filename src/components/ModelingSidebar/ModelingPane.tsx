import { useStore } from 'useStore'
import styles from './ModelingPane.module.css'

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
  children,
  className,
  Menu,
  detailsTestId,
  ...props
}: ModelingPaneProps) => {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  return (
    <section
      {...props}
      data-testid={detailsTestId}
      className={
        (buttonDownInStream ? 'pointer-events-none ' : 'pointer-events-auto ') +
        styles.panel +
        ' group ' +
        (className || '')
      }
    >
      <ModelingPaneHeader title={title} Menu={Menu} />
      <div className="relative w-full">{children}</div>
    </section>
  )
}
