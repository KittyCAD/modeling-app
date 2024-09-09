import { Toggle } from 'components/Toggle/Toggle'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Setting } from 'lib/settings/initialSettings'
import {
  SetEventTypes,
  SettingsLevel,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'
import { getSettingInputType } from 'lib/settings/settingsUtils'
import { useMemo } from 'react'
import { EventFrom } from 'xstate'

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
  const {
    settings: { context, send },
  } = useSettingsAuthContext()
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
                value: e.target.value,
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
    case 'string':
      return (
        <input
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          type="text"
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full"
          defaultValue={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
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
  return (
    <p className="text-destroy-70 dark:text-destroy-20">
      No component or input type found for setting {settingName} in category{' '}
      {category}
    </p>
  )
}
