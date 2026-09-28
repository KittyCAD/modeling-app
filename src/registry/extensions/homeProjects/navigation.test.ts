import { createAppNavigationService } from '@src/lib/appNavigation'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { createShowHomeIntentContribution } from '@src/registry/extensions/homeProjects/navigation'
import { describe, expect, test, vi } from 'vitest'

describe('home.show navigation contribution', () => {
  test('cancels a pending project open before entering Home', async () => {
    const cancelProjectOpen = vi.fn()
    const showHome = vi.fn(async () => undefined)
    const contribution = createShowHomeIntentContribution(
      { showHome },
      cancelProjectOpen
    )
    const navigation = createAppNavigationService([contribution])

    await navigation.dispatch(showHomeIntent, { libraryId: 'personal' })

    expect(cancelProjectOpen).toHaveBeenCalledOnce()
    expect(showHome).toHaveBeenCalledWith({ libraryId: 'personal' })
    expect(cancelProjectOpen).toHaveBeenCalledBefore(showHome)
  })
})
