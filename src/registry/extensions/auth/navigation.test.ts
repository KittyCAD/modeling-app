import type { AppUrlService } from '@src/registry/contracts/appUrl'
import { createStartSignInIntentContribution } from './navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
const getLocation = vi.fn(() => ({
  pathname: '/file/project',
  search: '?pool=alpha',
  hash: '',
  state: null,
  key: 'test',
}))
const startDesktopSignIn = vi.fn().mockResolvedValue(undefined)
const redirectToHostedSignIn = vi.fn()

function contribution({
  desktop = true,
  mobile = false,
}: {
  desktop?: boolean
  mobile?: boolean
} = {}) {
  return createStartSignInIntentContribution({
    getAppUrl: () => ({ navigate, getLocation }) as unknown as AppUrlService,
    startDesktopSignIn,
    isDesktop: () => desktop,
    isMobile: () => mobile,
    redirectToHostedSignIn,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('startSignInIntent contribution', () => {
  it('enters sign-in and starts desktop auth for an expired session', async () => {
    await contribution().dispatch({ reason: 'session-expired' })

    expect(navigate).toHaveBeenCalledWith('/signin?pool=alpha')
    expect(startDesktopSignIn).toHaveBeenCalledWith(undefined)
  })

  it('redirects web sign-in through the auth provider', async () => {
    await contribution({ desktop: false }).dispatch({ reason: 'logged-out' })

    expect(redirectToHostedSignIn).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps unsupported mobile users on the local sign-in destination', async () => {
    await contribution({ desktop: false, mobile: true }).dispatch({
      reason: 'logged-out',
    })

    expect(redirectToHostedSignIn).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
