import { createAppNavigationService } from '@src/lib/appNavigation'
import {
  defineAppNavigationIntent,
  defineAppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import { describe, expect, test, vi } from 'vitest'

describe('appNavigation', () => {
  test('dispatches a capability-contributed intent from the startup catalog', async () => {
    const openSettingsIntent = defineAppNavigationIntent<
      { tab: string },
      undefined
    >('settings.open', { placement: 'additional' })
    const openSettings = vi.fn(async (_input: { tab: string }) => undefined)
    const settingsContribution = defineAppNavigationIntentContribution(
      openSettingsIntent,
      openSettings
    )
    const navigation = createAppNavigationService([settingsContribution])

    await navigation.dispatch(openSettingsIntent, { tab: 'project' })

    expect(openSettings).toHaveBeenCalledWith({ tab: 'project' })
    expect(navigation.activeAdditionalIntent.value).toEqual({
      intent: openSettingsIntent,
      input: { tab: 'project' },
    })
  })

  test('rejects dispatch when more than one contribution claims an intent', async () => {
    const intent = defineAppNavigationIntent<Record<string, never>, undefined>(
      'duplicate.intent'
    )
    const first = defineAppNavigationIntentContribution(
      intent,
      async () => undefined
    )
    const second = defineAppNavigationIntentContribution(
      intent,
      async () => undefined
    )
    const navigation = createAppNavigationService([first, second])

    await expect(navigation.dispatch(intent, {})).rejects.toThrow(
      'Multiple application navigation intents handle duplicate.intent.'
    )
  })
})
