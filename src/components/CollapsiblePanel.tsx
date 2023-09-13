import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'
import styles from './CollapsiblePanel.module.css'

export interface CollapsiblePanelProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDetailsElement> {
  title: string
  icon?: IconDefinition
  open?: boolean
  menu?: React.ReactNode
  iconClassNames?: {
    bg?: string
    icon?: string
  }
}

export const PanelHeader = ({
  title,
  icon,
  iconClassNames,
  menu,
}: CollapsiblePanelProps) => {
  return (
    <summary className={styles.header}>
      <div className="flex gap-2 align-center flex-1">
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
      </div>
      <div className="group-open:opacity-100 opacity-0 group-open:pointer-events-auto pointer-events-none">
        {menu}
      </div>
    </summary>
  )
}

export const CollapsiblePanel = ({
  title,
  icon,
  children,
  className,
  iconClassNames,
  menu,
  ...props
}: CollapsiblePanelProps) => {
  return (
    <details
      {...props}
      className={styles.panel + ' group ' + (className || '')}
    >
      <PanelHeader
        title={title}
        icon={icon}
        iconClassNames={iconClassNames}
        menu={menu}
      />
      {children}
    </details>
  )
}
