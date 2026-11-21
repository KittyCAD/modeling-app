import type { ReadonlySignal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'

const UNRENDERED_CHANGES_DISABLED_REASON =
  'Render your changes before using modeling tools.'

type BooleanSettingSnapshot = {
  current?: unknown
  currentSignal?: ReadonlySignal<unknown>
}

export function getAutomaticallyRenderEnabledFromSettings(
  settings: Pick<SettingsType, 'textEditor'>,
  { reactive = false }: { reactive?: boolean } = {}
): boolean {
  const textEditorSettings = settings.textEditor as
    | Record<string, BooleanSettingSnapshot>
    | undefined

  const setting = textEditorSettings?.automaticallyRender
  return (
    (reactive
      ? (setting?.currentSignal?.value ?? setting?.current)
      : setting?.current) !== false
  )
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
