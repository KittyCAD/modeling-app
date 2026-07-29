import { useRef } from 'react'
import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  MouseEventHandler,
  RefObject,
  ReactNode,
} from 'react'

import { classNames as joinClassNames } from '../../lib/classNames'

export type ProjectCardClassNameSlot =
  | 'root'
  | 'openLink'
  | 'openLinkEnabled'
  | 'openLinkDisabled'
  | 'thumbnailFrame'
  | 'thumbnail'
  | 'badges'
  | 'body'
  | 'title'

export type ProjectCardClassNames = Partial<
  Record<ProjectCardClassNameSlot, string>
>

export type ProjectCardOpenLinkRenderProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className' | 'children' | 'onClick'
> & {
  className: string
  children: ReactNode
  'data-testid': string
  onClick: MouseEventHandler<HTMLAnchorElement>
}

export interface ProjectCardContextMenuRenderProps {
  menuTargetElement: RefObject<HTMLLIElement | null>
}

export interface ProjectCardProps
  extends Omit<HTMLAttributes<HTMLLIElement>, 'title'> {
  title: ReactNode
  titleText?: string
  canOpen?: boolean
  href?: string
  isEditing?: boolean
  thumbnailUrl?: string
  thumbnailAlt?: string
  thumbnailFallback?: ReactNode
  badges?: ReactNode
  details?: ReactNode
  renderContextMenu?: (props: ProjectCardContextMenuRenderProps) => ReactNode
  renameForm?: ReactNode
  dialogs?: ReactNode
  openLinkTestId?: string
  classNames?: ProjectCardClassNames
  onOpen?: MouseEventHandler<HTMLAnchorElement>
  renderOpenLink?: (props: ProjectCardOpenLinkRenderProps) => ReactNode
}

export const defaultProjectCardClassNames: Record<
  ProjectCardClassNameSlot,
  string
> = {
  root: 'group relative flex flex-col rounded-sm border border-chalkboard-50 dark:border-chalkboard-80 hover:!border-primary',
  openLink:
    'flex flex-col flex-1 !no-underline !text-chalkboard-110 dark:!text-chalkboard-10 min-h-[5em] divide-y divide-chalkboard-50 dark:divide-chalkboard-80',
  openLinkEnabled: 'group-hover:!divide-primary group-hover:!hue-rotate-0',
  openLinkDisabled: 'cursor-not-allowed',
  thumbnailFrame:
    'h-36 relative overflow-hidden bg-gradient-to-b from-transparent to-primary/10 rounded-t-sm',
  thumbnail:
    'h-full w-full transition-transform group-hover:scale-105 object-cover',
  badges:
    'absolute top-2 right-2 z-10 flex flex-col items-end gap-1 pointer-events-none',
  body: 'pb-2 flex flex-col flex-grow flex-auto gap-2 rounded-b-sm',
  title: 'font-sans relative z-0 p-2 truncate',
}

function getProjectCardClassNames(overrides?: ProjectCardClassNames) {
  return { ...defaultProjectCardClassNames, ...overrides }
}

function defaultRenderOpenLink({
  children,
  ...props
}: ProjectCardOpenLinkRenderProps) {
  return <a {...props}>{children}</a>
}

/**
 * A mostly headless project card shell.
 *
 * The component owns only the stable card structure and state-dependent slots.
 * Callers provide routing, actions, badges, dialogs, project metadata, and
 * styling overrides so app-specific behavior does not leak into the shared
 * component package.
 */
export function ProjectCard({
  title,
  titleText = typeof title === 'string' ? title : undefined,
  canOpen = true,
  href,
  isEditing = false,
  thumbnailUrl,
  thumbnailAlt = '',
  thumbnailFallback,
  badges,
  details,
  renderContextMenu,
  renameForm,
  dialogs,
  openLinkTestId = 'project-link',
  classNames,
  className,
  onOpen,
  renderOpenLink = defaultRenderOpenLink,
  ...props
}: ProjectCardProps) {
  const rootRef = useRef<HTMLLIElement>(null)
  const classes = getProjectCardClassNames(classNames)
  const openLinkClassName = joinClassNames(
    classes.openLink,
    canOpen ? classes.openLinkEnabled : classes.openLinkDisabled
  )

  const openLink = renderOpenLink({
    href,
    className: openLinkClassName,
    'data-testid': openLinkTestId,
    onClick: (event) => {
      if (!canOpen) {
        event.preventDefault()
      }
      onOpen?.(event)
    },
    children: (
      <>
        <div className={classes.thumbnailFrame}>
          {badges && <div className={classes.badges}>{badges}</div>}
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={thumbnailAlt}
              className={classes.thumbnail}
            />
          ) : (
            thumbnailFallback
          )}
        </div>
        <div className={classes.body}>
          {isEditing ? (
            renameForm
          ) : (
            <h3
              className={classes.title}
              data-testid="project-title"
              title={titleText}
            >
              {title}
            </h3>
          )}
          {details}
        </div>
      </>
    ),
  })

  return (
    <li
      {...props}
      ref={rootRef}
      className={joinClassNames(classes.root, className)}
    >
      {openLink}
      {!isEditing && renderContextMenu?.({ menuTargetElement: rootRef })}
      {dialogs}
    </li>
  )
}
