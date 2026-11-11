import MasqueradeBanner from '@src/components/MasqueradeBanner'
import { hasMasqueradeHint } from '@src/lib/masquerade'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/withBaseURL', () => ({
  withAPIBaseURL: () => 'https://api.example.test',
}))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: () => false }))
vi.mock('@src/lib/masquerade', () => ({
  watchSessionIdentity: () => () => {},
  hasMasqueradeHint: vi.fn(() => true),
}))

afterEach(() => {
  vi.mocked(hasMasqueradeHint).mockReturnValue(true)
  cleanup()
  vi.unstubAllGlobals()
})

describe('MasqueradeBanner', () => {
  it('does not poll the API without a masquerade hint', () => {
    vi.mocked(hasMasqueradeHint).mockReturnValue(false)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MasqueradeBanner />)
    fireEvent.focus(window)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stays hidden when the API reports no active masquerade', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => null })
    vi.stubGlobal('fetch', fetch)
    render(<MasqueradeBanner />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(
      screen.queryByRole('complementary', { name: 'Masquerade' })
    ).toBeNull()
  })

  it('shows the customer and allows retry after an end request fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user_id: 'customer',
          display_name: 'Support Test',
          environment: 'Production',
          expires_at: '2030-01-01T00:00:00Z',
          expired: false,
        }),
      })
      .mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetch)
    render(<MasqueradeBanner />)
    expect(await screen.findByText('Masquerading as Support Test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'End masquerade' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to end masquerade'
    )
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.example.test/masquerade/end',
      {
        method: 'POST',
        credentials: 'include',
      }
    )
    expect(screen.getByRole('button', { name: 'End masquerade' })).toBeEnabled()
  })
})
