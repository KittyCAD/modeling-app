import type { ComponentChildren } from 'preact'
import { type BaseProps, type MaybeSignal, cx } from './shared'
import './panel.css'

export interface PanelProps extends BaseProps {
  /** Mono heading. Panels are named by what they contain, in a word or two. */
  heading?: MaybeSignal<string>
  /** Controls aligned to the end of the heading row. */
  headerActions?: ComponentChildren
  /** Marks the panel as the focused surface, lighting its datum stripe. */
  focused?: MaybeSignal<boolean>
  /** Bodies scroll by default; turn this off for a canvas or an editor. */
  scroll?: boolean
  children?: ComponentChildren
}

/**
 * A titled surface inside the main area.
 *
 * Panels supply the datum stripe, so any panel can indicate focus without
 * knowing how focus is tracked. They deliberately carry no padding of their
 * own: a file tree, a code editor, and a form all want different insets, and a
 * panel that guesses forces every one of them to undo it.
 */
export function Panel({
  heading,
  headerActions,
  focused,
  scroll = true,
  children,
  class: className,
  ...rest
}: PanelProps) {
  return (
    <section
      {...rest}
      class={cx('zds-panel', 'zds-datum', className)}
      data-focused={focused ?? false}
    >
      {heading || headerActions ? (
        <header class="zds-panel__header">
          {heading ? (
            <h2 class="zds-label zds-panel__heading">{heading}</h2>
          ) : null}
          {headerActions ? (
            <div class="zds-panel__actions">{headerActions}</div>
          ) : null}
        </header>
      ) : null}
      <div class={cx('zds-panel__body', scroll && 'zds-scroll')}>
        {children}
      </div>
    </section>
  )
}
