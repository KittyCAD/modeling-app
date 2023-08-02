import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'
import styles from './CollapsiblePanel.module.css'

interface CollapsiblePanelProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDetailsElement> {
  title: string
  icon?: IconDefinition
  open?: boolean
  iconClassNames?: {
    bg?: string
    icon?: string
  }
}

export const PanelHeader = ({
  title,
  icon,
  iconClassNames,
}: CollapsiblePanelProps) => {
  return (
    <summary className={styles.header}>
      <ActionIcon
        icon={icon}
        bgClassName={
          'bg-chalkboard-30 dark:bg-chalkboard-90 group-open:bg-chalkboard-80 rounded ' +
          (iconClassNames?.bg || '')
        }
        iconClassName={
          'text-chalkboard-90 dark:text-chalkboard-40 group-open:text-liquid-10 ' +
          (iconClassNames?.icon || '')
        }
      />
      {title}
    </summary>
  )
}

export const CollapsiblePanel = ({
  title,
  icon,
  children,
  className,
  iconClassNames,
  ...props
}: CollapsiblePanelProps) => {
  return (
    <details
      {...props}
      className={styles.panel + ' group ' + (className || '')}
    >
      <PanelHeader title={title} icon={icon} iconClassNames={iconClassNames} />
      {children}
    </details>
  )
}
