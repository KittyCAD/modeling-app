import {
  act,
  renderHook,
  waitFor as waitForAssertion,
} from '@testing-library/react'
import type * as ReactRouterDom from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as XState from 'xstate'

const mocks = vi.hoisted(() => ({
  filePath: vi.fn<() => string | undefined>(
    () => '/file/tutorial-project/main.kcl'
  ),
  navigate: vi.fn(),
  settingsActor: {},
  settingsSend: vi.fn(),
  settingsWaitFor: vi.fn(() => Promise.resolve()),
}))

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: () => mocks.filePath(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    settings: {
      actor: mocks.settingsActor,
      send: mocks.settingsSend,
    },
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterDom>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('xstate', async (importOriginal) => ({
  ...(await importOriginal<typeof XState>()),
  waitFor: mocks.settingsWaitFor,
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
}))

import { useDismiss, useNextClick } from '@src/routes/Onboarding/utils'

function createDeferred() {
  let resolve = () => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('onboarding navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.filePath.mockReturnValue('/file/tutorial-project/main.kcl')
    mocks.settingsWaitFor.mockResolvedValue(undefined)
  })

  it('returns home after completing onboarding', async () => {
    const idleBeforeUpdate = createDeferred()
    const idleAfterUpdate = createDeferred()
    mocks.settingsWaitFor
      .mockReturnValueOnce(idleBeforeUpdate.promise)
      .mockReturnValueOnce(idleAfterUpdate.promise)
    const { result } = renderHook(() => useDismiss())

    act(() => {
      result.current('completed')
    })

    expect(mocks.settingsSend).not.toHaveBeenCalled()
    idleBeforeUpdate.resolve()
    await waitForAssertion(() => {
      expect(mocks.settingsSend).toHaveBeenCalledWith({
        type: 'set.app.onboardingStatus',
        data: { level: 'user', value: 'completed' },
      })
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
    idleAfterUpdate.resolve()
    await waitForAssertion(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true })
    })
    expect(mocks.settingsWaitFor).toHaveBeenCalledTimes(2)
  })

  it('returns home after onboarding is dismissed', async () => {
    const { result } = renderHook(() => useDismiss())

    act(() => {
      result.current()
    })

    await waitForAssertion(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true })
    })
    expect(mocks.settingsSend).toHaveBeenCalledWith({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: 'dismissed' },
    })
  })

  it('can dismiss onboarding when no file path is available', async () => {
    mocks.filePath.mockReturnValue(undefined)
    const { result } = renderHook(() => useDismiss())

    act(() => {
      result.current('dismissed')
    })

    await waitForAssertion(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true })
    })
  })

  it('replaces onboarding steps in browser history', () => {
    const { result } = renderHook(() => useNextClick('/desktop/scene'))

    act(() => {
      result.current()
    })

    expect(mocks.navigate).toHaveBeenCalledWith(
      `${mocks.filePath()}/onboarding/desktop/scene`,
      { replace: true }
    )
  })
})
