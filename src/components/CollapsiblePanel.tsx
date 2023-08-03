import { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ActionIcon } from './ActionIcon'
import styles from './CollapsiblePanel.module.css'
import { MouseEventHandler, useRef, useState } from 'react'

export interface CollapsiblePanelProps
  extends React.PropsWithChildren,
    React.HTMLAttributes<HTMLDetailsElement> {
  title: string
  icon?: IconDefinition
  open?: boolean
  iconClassNames?: {
    bg?: string
    icon?: string
  }
  onDrag?: React.MouseEventHandler<HTMLElement>
}

const DragHandle = ({
  onDrag,
}: {
  onDrag?: MouseEventHandler<HTMLElement>
}) => {
  const elem = useRef<HTMLElement>(null)
  const handleMouseDown: React.MouseEventHandler<HTMLElement> = (e) => {
    if (elem.current && onDrag) {
      document.addEventListener('mousemove', onDrag as any)
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onDrag as any)
      })
    }
  }
  return (
    <span
      ref={elem}
      className="absolute right-0 top-0 bottom-0 w-1 bg-liquid-30 opacity-0 hover:opacity-100 cursor-ew-resize z-10"
      onMouseDown={handleMouseDown}
    />
  )
}

export const PanelHeader = ({
  title,
  icon,
  iconClassNames,
  onDrag,
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
  onDrag,
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
