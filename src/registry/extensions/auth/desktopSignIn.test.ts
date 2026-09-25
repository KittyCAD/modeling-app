import type { IElectronAPI } from '@root/interface'
import { createDesktopSignIn } from './desktopSignIn'
import { describe, expect, it, vi } from 'vitest'

describe('desktop sign-in', () => {
  it('exposes verification state and logs in outside React', async () => {
    let finishLogin: ((token: string) => void) | undefined
    const loginWithDeviceFlow = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishLogin = resolve
        })
    )
    const electron = {
      startDeviceFlow: vi.fn().mockResolvedValue({
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://zoo.dev/device',
      }),
      loginWithDeviceFlow,
      cancelDeviceFlow: vi.fn().mockResolvedValue(undefined),
    } as unknown as IElectronAPI
    const send = vi.fn()
    const desktopSignIn = createDesktopSignIn({
      getElectron: () => electron,
      send,
    })

    const completed = desktopSignIn.start('staging.zoo.dev')
    await vi.waitFor(() => {
      expect(desktopSignIn.state.value).toEqual({
        status: 'verification',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://zoo.dev/device',
      })
    })

    finishLogin?.('fresh-token')
    await completed

    expect(desktopSignIn.state.value).toEqual({ status: 'idle' })
    expect(send).toHaveBeenCalledWith({ type: 'Log in', token: 'fresh-token' })
  })

  it('ignores completion after cancellation', async () => {
    let finishAuthorization:
      | ((authorization: { userCode: string; verificationUri: string }) => void)
      | undefined
    const electron = {
      startDeviceFlow: vi.fn(
        () =>
          new Promise<{ userCode: string; verificationUri: string }>(
            (resolve) => {
              finishAuthorization = resolve
            }
          )
      ),
      loginWithDeviceFlow: vi.fn(),
      cancelDeviceFlow: vi.fn().mockResolvedValue(undefined),
    } as unknown as IElectronAPI
    const send = vi.fn()
    const desktopSignIn = createDesktopSignIn({
      getElectron: () => electron,
      send,
    })

    const completed = desktopSignIn.start()
    await desktopSignIn.cancel()
    finishAuthorization?.({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://zoo.dev/device',
    })
    await completed

    expect(electron.loginWithDeviceFlow).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({ type: 'Log out' })
    expect(desktopSignIn.state.value).toEqual({ status: 'idle' })
  })
})
