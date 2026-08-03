import { Registry } from '@kittycad/registry'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import getDesktopAppExtension from '.'

describe('get desktop app extension', () => {
  it('contributes the download link to both slots', () => {
    const registry = new Registry()
    registry.configure([getDesktopAppExtension])
    const HomeComponent = registry.get(homeSidebarItemsValueSpec)[0].Component
    const ProjectMenuComponent = registry.get(
      projectExplorerProjectMenuItemsValueSpec
    )[0].Component
    const close = vi.fn()

    render(
      <>
        <HomeComponent className="home-class" />
        {ProjectMenuComponent ? (
          <ProjectMenuComponent
            className="project-menu-class"
            close={close}
            context={{} as never}
          />
        ) : null}
      </>
    )

    const links = screen.getAllByRole('link', { name: 'Get desktop app' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute(
        'href',
        expect.stringContaining('/design-studio/download')
      )
    }
    expect(
      within(screen.getByTestId('home-get-desktop-app')).getByLabelText(
        'download'
      )
    ).toBeVisible()
    expect(
      within(
        screen.getByTestId('project-menu-get-desktop-app')
      ).queryByLabelText('download')
    ).not.toBeInTheDocument()

    fireEvent.mouseUp(screen.getByTestId('project-menu-get-desktop-app'))
    expect(close).toHaveBeenCalledOnce()

    registry[Symbol.dispose]()
  })
})
