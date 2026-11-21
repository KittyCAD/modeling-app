import {
  ActionButton,
  type ActionButtonProps,
} from '@src/components/ActionButton'
import { Fragment, type ReactNode } from 'react'

/** Nonempty groups are separated once; custom contributions own their close behavior. */
export type HeaderMenuAction = ActionButtonProps & {
  id: string
  kind?: undefined
  'data-testid'?: string
}
export type HeaderMenuItem =
  | HeaderMenuAction
  | { id: string; kind: 'custom'; render: (close: () => void) => ReactNode }

export const headerMenuItemClassName =
  'relative !font-sans flex min-h-8 w-full items-center justify-start gap-2 rounded-sm px-2 py-1 cursor-pointer hover:bg-3 border-none text-left text-sm leading-5 text-default focus-visible:outline-appForeground disabled:cursor-default'
export const headerMenuPanelClassName =
  'z-30 absolute top-full mt-1 w-56 rounded border b-4 bg-2 p-0.5 shadow-lg text-default'

export function HeaderMenuItems({
  groups,
  close,
}: {
  groups: readonly (readonly HeaderMenuItem[])[]
  close: () => void
}) {
  return (
    <ul className="relative flex flex-col items-stretch">
      {groups
        .filter((group) => group.length > 0)
        .map((group, index) => (
          <Fragment key={group[0].id}>
            {index > 0 && (
              <li className="contents">
                <hr className="my-0 border-0 border-t b-4" />
              </li>
            )}
            {group.map((item) => {
              if (item.kind === 'custom')
                return <Fragment key={item.id}>{item.render(close)}</Fragment>
              const { id, className = '', children, ...props } = item
              return (
                <li key={id} className="contents" onClick={() => close()}>
                  <ActionButton
                    {...props}
                    tabIndex={0}
                    className={`${headerMenuItemClassName} ${className}`}
                  >
                    {children}
                  </ActionButton>
                </li>
              )
            })}
          </Fragment>
        ))}
    </ul>
  )
}
