import { type Glyph, type IconName, glyphs, iconPaths, isGlyph } from '../icons'
import { type BaseProps, cx } from './shared'
import './icon.css'

export interface IconProps extends BaseProps {
  name: IconName
  /** Defaults to `medium` (16px), the grid the set is drawn on. */
  size?: 'small' | 'medium' | 'large' | number
  /**
   * Icons are decorative by default and hidden from assistive tech. Pass a
   * label only when the icon is the sole carrier of meaning.
   */
  label?: string
}

function resolveSize(size: IconProps['size']): string {
  if (typeof size === 'number') return `${size}px`
  switch (size) {
    case 'small':
      return 'var(--zds-size-icon-sm)'
    case 'large':
      return 'var(--zds-size-icon-lg)'
    default:
      return 'var(--zds-size-icon-md)'
  }
}

/**
 * One icon, from either family.
 *
 * A caller names an icon and never says which set drew it — that is the whole
 * point of one `IconName`. The two are rendered differently because they *are*
 * different: the chassis set is stroked linework on a 16px grid, the CAD glyphs
 * are filled shapes on their own, and asking one to be the other would ruin
 * both.
 *
 * The glyph body is set as markup because that is how it is stored: checked-in
 * constant data ported from the existing app, with compound paths, a clip path
 * and the occasional circle. Nothing a user can reach goes through here.
 */
export function Icon({
  name,
  size,
  label,
  class: className,
  ...rest
}: IconProps) {
  const shared = {
    ...rest,
    style: { '--zds-icon-size': resolveSize(size) },
    'aria-hidden': label ? undefined : ('true' as const),
    'aria-label': label,
    role: label ? ('img' as const) : undefined,
    focusable: 'false' as const,
  }

  if (isGlyph(name)) {
    // Widened deliberately: the record is `as const` so the names form a union,
    // which also makes every viewBox and body a literal type — and a literal
    // type for a hundred markup strings is a type nobody can read in an error.
    const glyph: Glyph = glyphs[name]
    return (
      <svg
        {...shared}
        class={cx('zds-icon', 'zds-icon--filled', className)}
        viewBox={glyph.viewBox}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: constant icon
        // data from this package, not anything a caller can supply.
        dangerouslySetInnerHTML={{ __html: glyph.body }}
      />
    )
  }

  return (
    <svg {...shared} class={cx('zds-icon', className)} viewBox="0 0 16 16">
      <path
        d={iconPaths[name]}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
