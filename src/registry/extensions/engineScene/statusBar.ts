import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID } from './constants'

type ModelingSettingsWithExecutingSpinner = SettingsType['modeling'] & {
  showExecutingSpinner?: { current: boolean }
}

function isExecutingSpinnerSettingEnabled(settingsValues: SettingsType) {
  return (
    (settingsValues.modeling as ModelingSettingsWithExecutingSpinner)
      .showExecutingSpinner?.current === true
  )
}

export function filterEngineSceneStatusBarItems(
  items: StatusBarItemType[],
  settingsValues: SettingsType
) {
  const showExecutingSpinner = isExecutingSpinnerSettingEnabled(settingsValues)

  return items.filter(
    (item) =>
      item.id !== ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID ||
      showExecutingSpinner
  )
}
