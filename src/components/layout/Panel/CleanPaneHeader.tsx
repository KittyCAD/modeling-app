import type { ReactNode } from 'react'
import { PaneContentSelector } from './PaneContentSelector'

export { cleanPaneHeaderButtonClassName } from './headerStyles'

export function CleanPaneHeader({
  centerContent,
  children,
  title,
}: {
  centerContent?: ReactNode
  children?: ReactNode
  title: string
}) {
  return (
    <div className="flex h-11 items-center gap-2 px-4">
      <div
        className={`flex min-w-0 items-center gap-1 ${
          centerContent ? 'flex-none' : 'flex-1'
        }`}
      >
        <h2 className="m-0 min-w-0 truncate text-base font-semibold leading-5">
          {title}
        </h2>
        <PaneContentSelector />
      </div>
      {centerContent ? (
        <div className="flex min-w-0 flex-1 items-center">{centerContent}</div>
      ) : null}
      {children ? (
        <div className="flex flex-none items-center gap-1">{children}</div>
      ) : null}
    </div>
  )
}
