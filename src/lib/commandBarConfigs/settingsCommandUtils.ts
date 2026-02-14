import type { CommandArgumentConfig } from '@src/lib/commandTypes'
import type {
  SetEventTypes,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import { hexToRgb } from '@src/lib/utils'

const getAlphaForCurrentColor = (value: unknown): number => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'a' in value &&
    typeof value.a === 'number'
  ) {
    return value.a
  }

  return 1
}

export function coerceSettingsCommandSubmitData({
  data,
  valueInputType,
  getCurrentValueForLevel,
}: {
  data: SetEventTypes['data']
  valueInputType: CommandArgumentConfig<unknown>['inputType']
  getCurrentValueForLevel: (level: SettingsLevel) => unknown
}): SetEventTypes['data'] | Error {
  if (!(valueInputType === 'color' && typeof data.value === 'string')) {
    return data
  }

  const rgb = hexToRgb(data.value)
  if (!rgb) {
    return new Error('Invalid color submitted to settings command')
  }

  const alpha = getAlphaForCurrentColor(getCurrentValueForLevel(data.level))
  return {
    ...data,
    value: { ...rgb, a: alpha },
  } as SetEventTypes['data']
}
