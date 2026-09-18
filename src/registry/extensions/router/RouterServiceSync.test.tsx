import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createAppUrlService } from '.'
import { AppUrlServiceSync } from './RouterServiceSync'

describe('AppUrlServiceSync', () => {
  it('seeds the app URL service from React Router hooks', async () => {
    const appUrl = createAppUrlService()

    render(
      <MemoryRouter initialEntries={['/initial?tab=unit#anchor']}>
        <AppUrlServiceSync appUrl={appUrl} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(appUrl.isReady.value).toBe(true)
      expect(appUrl.location.value.pathname).toBe('/initial')
    })

    expect(appUrl.location.value.search).toBe('?tab=unit')
    expect(appUrl.location.value.hash).toBe('#anchor')

    void appUrl.navigate('/next')

    await waitFor(() => {
      expect(appUrl.location.value.pathname).toBe('/next')
    })
  })
})
