import type { ComponentChildren, JSX } from 'preact'
import { type BaseProps, type MaybeSignal, cx } from './shared'
import './sheetCard.css'

export interface SheetField {
  /** Field name, e.g. `REV`, `MODIFIED`, `FILES`. */
  label: string
  value: MaybeSignal<string>
}

export interface SheetCardProps extends BaseProps {
  name: MaybeSignal<string>
  /** Thumbnail, preview canvas, or nothing. */
  preview?: ComponentChildren
  /** Title-block fields, laid out left to right. Three is usually the limit. */
  fields?: SheetField[]
  onOpen?: JSX.MouseEventHandler<HTMLButtonElement>
  /** Controls that sit above the card's own hit target. */
  actions?: ComponentChildren
  selected?: MaybeSignal<boolean>
}

/**
 * A project, drawn as a drawing sheet.
 *
 * The bottom strip is a real title block: hairline-divided fields, names in
 * mono, values in tabular figures. Engineers already read a sheet corner to
 * find out what a drawing is and how current it is, so borrowing the
 * convention means the card needs no explaining — and it looks like nothing
 * else, which is the point.
 */
export function SheetCard({
  name,
  preview,
  fields = [],
  onOpen,
  actions,
  selected,
  class: className,
  ...rest
}: SheetCardProps) {
  return (
    <article
      {...rest}
      class={cx('zds-sheet', className)}
      data-selected={selected ?? false}
    >
      <div class="zds-sheet__plate">
        {preview ?? (
          <span class="zds-label zds-sheet__no-preview">No preview</span>
        )}
      </div>
      <div class="zds-sheet__block">
        <h3 class="zds-sheet__name-row">
          <button class="zds-sheet__name" type="button" onClick={onOpen}>
            {name}
          </button>
        </h3>
        {fields.length > 0 ? (
          <dl class="zds-sheet__fields">
            {fields.map((field) => (
              <div class="zds-sheet__field" key={field.label}>
                <dt class="zds-label">{field.label}</dt>
                <dd class="zds-value zds-numeric">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div class="zds-sheet__actions">{actions}</div> : null}
    </article>
  )
}
