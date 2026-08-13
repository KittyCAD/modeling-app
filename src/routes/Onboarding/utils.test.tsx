import {
  act,
  renderHook,
  waitFor as waitForAssertion,
} from '@testing-library/react'
import type * as ReactRouterDom from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as XState from 'xstate'

const mocks = vi.hoisted(() => ({
  filePath: '/file/tutorial-project/main.kcl',
  navigate: vi.fn(),
  settingsActor: {},
  settingsSend: vi.fn(),
  settingsWaitFor: vi.fn(() => Promise.resolve()),
}))

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: () => mocks.filePath,
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

describe('onboarding navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns home after completing onboarding', async () => {
    const { result } = renderHook(() => useDismiss())

    act(() => {
      result.current('completed')
    })

    await waitForAssertion(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true })
    })
    expect(mocks.settingsWaitFor).toHaveBeenCalledTimes(2)
    expect(mocks.settingsWaitFor.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settingsSend.mock.invocationCallOrder[0]
    )
    expect(mocks.settingsSend.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settingsWaitFor.mock.invocationCallOrder[1]
    )
    expect(mocks.settingsWaitFor.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0]
    )
  })

  it('returns to the tutorial project when onboarding is dismissed', async () => {
    const { result } = renderHook(() => useDismiss())

    act(() => {
      result.current('dismissed')
    })

    await waitForAssertion(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(mocks.filePath, {
        replace: true,
      })
    })
  })

  it('replaces onboarding steps in browser history', () => {
    const { result } = renderHook(() => useNextClick('/desktop/scene'))

    act(() => {
      result.current()
    })

    expect(mocks.navigate).toHaveBeenCalledWith(
      `${mocks.filePath}/onboarding/desktop/scene`,
      { replace: true }
    )
  })
})
