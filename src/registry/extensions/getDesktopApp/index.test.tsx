import { homeSidebarItemsFacet } from '@src/registry/contracts/homeSidebar'
import { render, screen, within } from '@testing-library/react'
import { Registry } from 'plankton'
import { describe, expect, it } from 'vitest'
import getDesktopAppExtension from '.'

describe('get desktop app extension', () => {
  it('contributes the download link to the Home sidebar', async () => {
    const registry = new Registry()
    await registry.configure([getDesktopAppExtension])
    const HomeComponent = registry.get(homeSidebarItemsFacet)[0].Component

    render(<HomeComponent className="home-class" />)

    const link = screen.getByRole('link', { name: 'Get desktop app' })
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/design-studio/download')
    )
    expect(
      within(screen.getByTestId('home-get-desktop-app')).getByLabelText(
        'download'
      )
    ).toBeVisible()
    await registry.dispose()
  })
})
