import type { SettingsType } from '@src/lib/settings/initialSettings'

const UNRENDERED_CHANGES_DISABLED_REASON =
  'Render your changes before using modeling tools.'

type BooleanSettingSnapshot = {
  current?: unknown
}

export function getAutomaticallyRenderEnabledFromSettings(
  settings: Pick<SettingsType, 'textEditor'>
): boolean {
  const textEditorSettings = settings.textEditor as
    | Record<string, BooleanSettingSnapshot>
    | undefined

  return textEditorSettings?.automaticallyRender?.current !== false
}

export function shouldDisableModelingForUnrenderedChanges({
  settings,
  hasEditsSinceLastExecution,
}: {
  settings: Pick<SettingsType, 'textEditor'>
  hasEditsSinceLastExecution: boolean
}): boolean {
  return (
    !getAutomaticallyRenderEnabledFromSettings(settings) &&
    hasEditsSinceLastExecution
  )
}

export function getUnrenderedChangesDisabledReason(): string {
  return UNRENDERED_CHANGES_DISABLED_REASON
}
