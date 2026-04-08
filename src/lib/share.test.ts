import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  createCreateFileUrl: vi.fn(() => new URL('https://app.dev.zoo.dev/share')),
  createShortlink: vi.fn(async () => ({
    key: 'share-key',
    url: 'https://zoo.dev/s/share-key',
  })),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(async () => {}),
}))

vi.mock('@src/lib/links', () => ({
  createCreateFileUrl: mockState.createCreateFileUrl,
  createShortlink: mockState.createShortlink,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockState.toastError,
    success: mockState.toastSuccess,
  },
}))

import { copyCurrentFileShareLink } from '@src/lib/share'

describe('copyCurrentFileShareLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockState.writeText,
      },
    })
  })

  it('creates a shortlink and copies it to the clipboard', async () => {
    const copied = await copyCurrentFileShareLink({
      token: 'token-123',
      code: 'part001 = startSketchOn(XY)',
      name: 'bracket',
      isRestrictedToOrg: true,
      password: 'secret',
    })

    expect(copied).toBe(true)
    expect(mockState.createCreateFileUrl).toHaveBeenCalledWith({
      token: 'token-123',
      code: 'part001 = startSketchOn(XY)',
      name: 'bracket',
      isRestrictedToOrg: true,
      password: 'secret',
    })
    expect(mockState.createShortlink).toHaveBeenCalledWith(
      'token-123',
      'https://app.dev.zoo.dev/share',
      true,
      'secret'
    )
    expect(mockState.writeText).toHaveBeenCalledWith(
      'https://zoo.dev/s/share-key'
    )
    expect(mockState.toastSuccess).toHaveBeenCalled()
  })

  it('rejects when there is no auth token', async () => {
    const copied = await copyCurrentFileShareLink({
      token: '',
      code: 'sketch001 = startSketchOn(XY)',
      name: 'bracket',
      isRestrictedToOrg: false,
    })

    expect(copied).toBe(false)
    expect(mockState.createShortlink).not.toHaveBeenCalled()
    expect(mockState.writeText).not.toHaveBeenCalled()
    expect(mockState.toastError).toHaveBeenCalledWith(
      'You need to be signed in to share a file.',
      { duration: 5000 }
    )
  })
})
