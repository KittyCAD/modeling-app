import { Button, Select, Switch, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import {
  type AnySetting,
  type SettingsLevel,
  settingsService,
} from '@src/contracts/settings'
import { useMemo } from 'preact/hooks'

/** How a value reads in prose, so an inherited value can be named. */
export function describeValue(setting: AnySetting, value: unknown): string {
  switch (setting.control.kind) {
    case 'boolean':
      return value ? 'on' : 'off'
    case 'options':
      return (
        setting.control.options.find(
          (option: { value: unknown }) => option.value === value
        )?.label ?? String(value)
      )
    case 'number':
      return setting.control.unit
        ? `${value} ${setting.control.unit}`
        : String(value)
    default:
      return value === '' ? 'empty' : String(value)
  }
}

interface SettingRowProps {
  setting: AnySetting
  /** A plain value, not a signal: the row is re-rendered when the level changes. */
  level: SettingsLevel
  disabled: boolean
}

/**
 * One setting, at one level.
 *
 * The control always shows the value that is actually in effect, even when this
 * level sets nothing — an empty control next to a running app is a lie. What
 * distinguishes "inherited" from "set here" is the line under the description
 * and the presence of a reset, not a blank field.
 */
export function SettingRow({ setting, level, disabled }: SettingRowProps) {
  const settings = useService(settingsService)

  // Keyed on the level because it is a plain prop: a `useComputed` would
  // capture the first level it saw and never notice the tab changing.
  const override = useMemo(
    () => settings.overrideAt(setting, level),
    [settings, setting, level]
  )
  const inherited = useMemo(
    () => settings.inheritedAt(setting, level),
    [settings, setting, level]
  )

  const overrideValue = override.value
  const inheritedValue = inherited.value
  const isSetHere = overrideValue !== undefined
  const shown = isSetHere ? overrideValue : inheritedValue

  const update = (value: unknown) => settings.set(setting, level, value)

  const control = () => {
    switch (setting.control.kind) {
      case 'boolean':
        return (
          <Switch
            label={setting.title}
            hideLabel
            checked={Boolean(shown)}
            disabled={disabled}
            onCheckedChange={update}
          />
        )
      case 'options':
        return (
          <Select
            label={setting.title}
            hideLabel
            value={String(shown)}
            disabled={disabled}
            options={setting.control.options.map(
              (option: { value: unknown; label: string }) => ({
                value: String(option.value),
                label: option.label,
              })
            )}
            onValueChange={update}
          />
        )
      case 'number':
        return (
          <TextField
            label={setting.title}
            hideLabel
            type="number"
            value={String(shown)}
            disabled={disabled}
            onSubmit={(value) => update(Number(value))}
          />
        )
      default:
        return (
          <TextField
            label={setting.title}
            hideLabel
            placeholder={setting.control.placeholder}
            value={String(shown)}
            disabled={disabled}
            onSubmit={update}
          />
        )
    }
  }

  return (
    <div class="zds-setting" data-set-here={isSetHere ? 'true' : undefined}>
      <div class="zds-setting__info">
        <p class="zds-setting__name">{setting.title}</p>
        {setting.description ? (
          <p class="zds-setting__description">{setting.description}</p>
        ) : null}
        <p class="zds-label zds-setting__provenance">
          {isSetHere
            ? `Set here — otherwise ${describeValue(setting, inheritedValue)}`
            : `Inherited — ${describeValue(setting, inheritedValue)}`}
        </p>
      </div>
      <div class="zds-setting__control">
        {control()}
        {/* Only offered when there is something to reset. A permanently
            present reset invites the question of what it would do. */}
        {isSetHere ? (
          <Button
            variant="ghost"
            size="small"
            icon="close"
            iconOnly
            label="Reset to inherited"
            disabled={disabled}
            onClick={() => settings.clear(setting, level)}
          />
        ) : (
          <span class="zds-setting__reset-spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}
