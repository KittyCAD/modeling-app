import { useMemo } from 'react'
import type { EventFrom } from 'xstate'

import { Toggle } from '@src/components/Toggle/Toggle'
import type { Setting } from '@src/lib/settings/initialSettings'
import type {
  SetEventTypes,
  SettingsLevel,
  WildcardSetEvent,
} from '@src/lib/settings/settingsTypes'
import { getSettingInputType } from '@src/lib/settings/settingsUtils'
import { settingsActor, useSettings } from '@src/lib/singletons'

interface SettingsFieldInputProps {
  // We don't need the fancy types here,
  // it doesn't help us with autocomplete or anything
  category: string
  settingName: string
  settingsLevel: SettingsLevel
  setting: Setting<unknown>
}

export function SettingsFieldInput({
  category,
  settingName,
  settingsLevel,
  setting,
}: SettingsFieldInputProps) {
  const context = useSettings()
  const send = settingsActor.send
  const options = useMemo(() => {
    return setting.commandConfig &&
      'options' in setting.commandConfig &&
      setting.commandConfig.options
      ? setting.commandConfig.options instanceof Array
        ? setting.commandConfig.options
        : setting.commandConfig.options(
            {
              argumentsToSubmit: {
                level: settingsLevel,
              },
            },
            context
          )
      : []
  }, [setting, settingsLevel, context])
  const inputType = getSettingInputType(setting)

  switch (inputType) {
    case 'component':
      return (
        setting.Component && (
          <setting.Component
            value={setting[settingsLevel] || setting.getFallback(settingsLevel)}
            updateValue={(newValue) => {
              send({
                type: `set.${category}.${settingName}`,
                data: {
                  level: settingsLevel,
                  value: newValue,
                },
              } as unknown as EventFrom<WildcardSetEvent>)
            }}
          />
        )
      )
    case 'boolean':
      return (
        <Toggle
          offLabel="Off"
          onLabel="On"
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: Boolean(e.target.checked),
              },
            } as SetEventTypes)
          }
          checked={Boolean(
            setting[settingsLevel] !== undefined
              ? setting[settingsLevel]
              : setting.getFallback(settingsLevel)
          )}
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
        />
      )
    case 'options':
      return (
        <select
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full"
          value={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                // undefined is the only special string due to no way to
                // encode it in the string-only options.
                value:
                  e.target.value === 'undefined' ? undefined : e.target.value,
              },
            } as unknown as EventFrom<WildcardSetEvent>)
          }
        >
          {options &&
            options.length > 0 &&
            options.map((option) => (
              <option key={option.name} value={String(option.value)}>
                {option.name}
              </option>
            ))}
        </select>
      )
    case 'string': {
      const effectiveValue =
        setting[settingsLevel] !== undefined
          ? setting[settingsLevel]
          : setting.getFallback(settingsLevel)
      return (
        <input
          // When reverting to default value then the input doesn't update without a key change.
          // Another fix for this would be to make this a controlled component.
          key={`${category}-${settingName}-${settingsLevel}-${String(
            effectiveValue
          )}`}
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          type="text"
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full"
          defaultValue={String(effectiveValue)}
          onBlur={(e) => {
            if (
              setting[settingsLevel] === undefined
                ? setting.getFallback(settingsLevel) !== e.target.value
                : setting[settingsLevel] !== e.target.value
            ) {
              send({
                type: `set.${category}.${settingName}`,
                data: {
                  level: settingsLevel,
                  value: e.target.value,
                },
              } as unknown as EventFrom<WildcardSetEvent>)
            }
          }}
        />
      )
    }
    case 'number': {
      const effectiveValue =
        setting[settingsLevel] !== undefined
          ? setting[settingsLevel]
          : setting.getFallback(settingsLevel)
      return (
        <input
          // When reverting to default value then the input doesn't update without a key change.
          // Another fix for this would be to make this a controlled component.
          key={`${category}-${settingName}-${settingsLevel}-${String(
            effectiveValue
          )}`}
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          type="number"
          step="any"
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full disabled:opacity-50 disabled:pointer-events-none"
          defaultValue={Number(effectiveValue)}
          min={
            setting.commandConfig && 'min' in setting.commandConfig
              ? setting.commandConfig.min
              : undefined
          }
          disabled={!setting.isEnabled(context)}
          onBlur={(e) => {
            const numValue = parseFloat(e.target.value)
            if (!Number.isNaN(numValue)) {
              const currentValue = effectiveValue
              if (currentValue !== numValue) {
                send({
                  type: `set.${category}.${settingName}`,
                  data: {
                    level: settingsLevel,
                    value: numValue,
                  },
                } as unknown as EventFrom<WildcardSetEvent>)
              }
            }
          }}
        />
      )
    }
  }
  return (
    <p className="text-destroy-70 dark:text-destroy-20">
      No component or input type found for setting {settingName} in category{' '}
      {category}
    </p>
  )
}
