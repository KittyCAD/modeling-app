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
  detailsTestId?: string
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
      <div className="flex gap-2 align-center items-center flex-1">
        <ActionIcon
          icon={icon}
          className="p-1"
          size="sm"
          bgClassName={
            'dark:!bg-chalkboard-100 group-open:bg-chalkboard-80 dark:group-open:!bg-chalkboard-90 group-open:border dark:group-open:border-chalkboard-60 rounded-sm ' +
            (iconClassNames?.bg || '')
          }
          iconClassName={
            'group-open:text-energy-10 ' + (iconClassNames?.icon || '')
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
  detailsTestId,
  ...props
}: CollapsiblePanelProps) => {
  return (
    <details
      {...props}
      data-testid={detailsTestId}
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
