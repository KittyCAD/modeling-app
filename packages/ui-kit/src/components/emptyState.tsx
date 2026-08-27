import type { ComponentChildren } from 'preact'
import type { IconName } from '../icons'
import { Icon } from './icon'
import { type BaseProps, type MaybeSignal, cx } from './shared'
import './emptyState.css'

export interface EmptyStateProps extends BaseProps {
  /** Mono eyebrow naming the surface that is empty, e.g. `EDITOR`. */
  eyebrow?: MaybeSignal<string>
  /** What is not here, stated plainly. Not an apology. */
  title: MaybeSignal<string>
  /** One sentence of direction: what this surface is for, and how to fill it. */
  description?: MaybeSignal<string>
  icon?: IconName
  /** A primary action, and at most one secondary. */
  actions?: ComponentChildren
  /** `panel` for a pane-sized blank, `page` for a whole screen. */
  scale?: 'panel' | 'page'
}

/**
 * The blank plate.
 *
 * Empty is a normal state in this app — no project open, no file open, no
 * connection, no diagnostics — so it gets a real component rather than an
 * afterthought per call site. Every empty state says what the surface is for
 * and what to do next. None of them apologise or say "nothing to see here".
 */
export function EmptyState({
  eyebrow,
  title,
  description,
  icon,
  actions,
  scale = 'panel',
  class: className,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} class={cx('zds-empty', `zds-empty--${scale}`, className)}>
      {icon ? (
        <div class="zds-empty__mark">
          <Icon name={icon} size={scale === 'page' ? 'large' : 'medium'} />
        </div>
      ) : null}
      {eyebrow ? <p class="zds-label zds-empty__eyebrow">{eyebrow}</p> : null}
      <p class="zds-empty__title">{title}</p>
      {description ? <p class="zds-empty__description">{description}</p> : null}
      {actions ? <div class="zds-empty__actions">{actions}</div> : null}
    </div>
  )
}
