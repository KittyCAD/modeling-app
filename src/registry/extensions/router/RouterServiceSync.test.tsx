import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createRouterRegistryService } from '.'
import { RouterServiceSync } from './RouterServiceSync'

describe('RouterServiceSync', () => {
  it('seeds the router service from React Router hooks', async () => {
    const router = createRouterRegistryService()

    render(
      <MemoryRouter initialEntries={['/initial?tab=unit#anchor']}>
        <RouterServiceSync router={router} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(router.isReady.value).toBe(true)
      expect(router.location.value.pathname).toBe('/initial')
    })

    expect(router.location.value.search).toBe('?tab=unit')
    expect(router.location.value.hash).toBe('#anchor')

    void router.navigate('/next')

    await waitFor(() => {
      expect(router.location.value.pathname).toBe('/next')
    })
  })
})
