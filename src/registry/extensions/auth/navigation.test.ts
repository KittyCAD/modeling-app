import type { AppUrlService } from '@src/registry/contracts/appUrl'
import { createStartSignInIntentContribution } from './navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
const formatUrl = vi.fn(() => '/signin?pool=alpha')
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
    getAppUrl: () =>
      ({ navigate, formatUrl, getLocation }) as unknown as AppUrlService,
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

    expect(formatUrl).toHaveBeenCalledWith({
      destination: { type: 'sign-in' },
      search: '?pool=alpha',
      hash: '',
    })
    expect(navigate).toHaveBeenCalledWith('/signin?pool=alpha', {
      replace: false,
    })
    expect(startDesktopSignIn).toHaveBeenCalledWith(undefined)
  })

  it('restores desktop sign-in without automatically starting device auth', async () => {
    await contribution().dispatch({
      reason: 'startup',
      startup: { search: '?pool=alpha', hash: '#help' },
    })

    expect(navigate).toHaveBeenCalledWith('/signin?pool=alpha', {
      replace: true,
    })
    expect(startDesktopSignIn).not.toHaveBeenCalled()
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
