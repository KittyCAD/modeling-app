import { useMemo } from 'preact/hooks'
import { type BaseProps, cx, type MaybeSignal, uniqueId } from './shared'
import './switch.css'

export interface SwitchProps extends BaseProps {
  /** Always required; pass `hideLabel` if it should not be drawn. */
  label: string
  hideLabel?: boolean
  checked: MaybeSignal<boolean>
  disabled?: MaybeSignal<boolean>
  onCheckedChange?: (checked: boolean) => void
}

/**
 * An on/off control.
 *
 * A real checkbox underneath, visually hidden. That is what keeps the label
 * association, the focus ring, and Space-to-toggle working without
 * reimplementing any of them — the styled track is decoration over a control the
 * platform already understands.
 */
export function Switch({
  label,
  hideLabel,
  checked,
  disabled,
  onCheckedChange,
  class: className,
  id,
  ...rest
}: SwitchProps) {
  const switchId = useMemo(() => id ?? uniqueId('switch'), [id])

  return (
    <div {...rest} class={cx('zds-switch', className)}>
      <input
        class="zds-switch__input"
        id={switchId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onCheckedChange?.((event.target as HTMLInputElement).checked)
        }}
      />
      <label class="zds-switch__label" for={switchId}>
        <span class="zds-switch__track">
          <span class="zds-switch__thumb" />
        </span>
        <span
          class={cx('zds-switch__text', hideLabel && 'zds-visually-hidden')}
        >
          {label}
        </span>
      </label>
    </div>
  )
}
