import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  putPublicSupportForm: vi.fn(),
  createKCClient: vi.fn(() => ({ mocked: true })),
  kcCall: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('@kittycad/lib', () => ({
  users: {
    put_public_support_form: mockState.putPublicSupportForm,
  },
}))

vi.mock('@src/lib/kcClient', () => ({
  createKCClient: mockState.createKCClient,
  kcCall: mockState.kcCall,
}))

vi.mock('@src/routes/utils', () => ({
  APP_VERSION: 'test-version',
}))

import {
  getCoreDumpSupportContact,
  getCoreDumpSupportMessage,
  submitCoreDumpSupportTicket,
} from '@src/lib/coredump'

describe('coredump support ticket helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('derives support contact names from the user profile', () => {
    expect(
      getCoreDumpSupportContact({
        email: 'test@example.com',
        name: 'Test User',
      } as never)
    ).toEqual({
      firstName: 'Test',
      lastName: 'User',
    })

    expect(
      getCoreDumpSupportContact({
        email: 'fallback@example.com',
      } as never)
    ).toEqual({
      firstName: 'fallback',
      lastName: 'User',
    })
  })

  it('builds a support-ready message directly from the coredump', () => {
    const message = getCoreDumpSupportMessage({
      id: 'abc123',
      version: '1.2.3',
      git_rev: 'deadbeef',
      timestamp: '2026-03-30T00:00:00Z',
      desktop: true,
      kcl_code: '',
      os: {
        platform: 'macOS',
        arch: 'arm64',
        version: '15.4',
      },
      webrtc_stats: {},
      client_state: {},
    } as never)

    expect(message).toContain(
      'Automatic support report from Zoo Design Studio.'
    )
    expect(message).toContain('Reference ID: abc123')
    expect(message).toContain('Desktop: yes')
    expect(message).toContain('OS: macOS arm64 15.4')
    expect(message).toContain(
      'This support report includes the collected diagnostic context for this reference ID.'
    )
  })

  it('submits a technical support form with the coredump message', async () => {
    mockState.putPublicSupportForm.mockResolvedValue(undefined)

    await submitCoreDumpSupportTicket({
      dump: {
        id: 'abc123',
        version: '1.2.3',
        git_rev: 'deadbeef',
        timestamp: '2026-03-30T00:00:00Z',
        desktop: true,
        kcl_code: '',
        os: {},
        webrtc_stats: {},
        client_state: {},
      } as never,
      token: 'token-123',
      user: {
        company: 'Zoo',
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        phone: '555-0100',
      } as never,
    })

    expect(mockState.createKCClient).toHaveBeenCalledWith('token-123')
    expect(mockState.putPublicSupportForm).toHaveBeenCalledWith({
      client: { mocked: true },
      body: {
        company: 'Zoo',
        email: 'test@example.com',
        first_name: 'Test',
        inquiry_type: 'technical_support',
        last_name: 'User',
        message: `Automatic support report from Zoo Design Studio.

Reference ID: abc123
Version: 1.2.3
Git Revision: deadbeef
Desktop: yes

This support report includes the collected diagnostic context for this reference ID.`,
        phone: '555-0100',
      },
    })
  })
})
