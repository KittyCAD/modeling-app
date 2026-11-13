import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

/** A centered invitation; the caller supplies its message, icon, and available action. */
export function EmptyState({
  icon,
  children,
  action,
}: {
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={styles.root}>
      {icon && (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className={styles.heading}>{children}</h2>
      {action}
    </div>
  )
}
