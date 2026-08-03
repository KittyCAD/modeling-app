import { Registry } from '@kittycad/registry'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import getDesktopAppExtension from '.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('get desktop app extension', () => {
  it('contributes links to Home and the project menu', () => {
    const registry = new Registry()
    registry.configure([getDesktopAppExtension])

    expect(registry.get(homeSidebarItemsValueSpec)).toMatchObject([
      { id: 'get-desktop-app.home-sidebar' },
    ])
    expect(
      registry.get(projectExplorerProjectMenuItemsValueSpec)
    ).toMatchObject([{ id: 'get-desktop-app.project-menu' }])

    registry[Symbol.dispose]()
  })

  it('shows its contributions only on web', () => {
    const registry = new Registry()
    registry.configure([getDesktopAppExtension])
    const homeItem = registry.get(homeSidebarItemsValueSpec)[0]
    const projectMenuItem = registry.get(
      projectExplorerProjectMenuItemsValueSpec
    )[0]

    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Chrome')
    expect(homeItem.isVisible?.()).toBe(true)
    expect(projectMenuItem.isVisible?.({} as never)).toBe(true)

    userAgent.mockReturnValue('Electron')
    expect(homeItem.isVisible?.()).toBe(false)
    expect(projectMenuItem.isVisible?.({} as never)).toBe(false)

    registry[Symbol.dispose]()
  })

  it('renders the same download link in both slots', () => {
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
