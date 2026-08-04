import { Registry } from '@kittycad/registry'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import getDesktopAppExtension from '.'

describe('get desktop app extension', () => {
  it('contributes the download link to the Home sidebar', () => {
    const registry = new Registry()
    registry.configure([getDesktopAppExtension])
    const HomeComponent = registry.get(homeSidebarItemsValueSpec)[0].Component

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

    registry[Symbol.dispose]()
  })
})
