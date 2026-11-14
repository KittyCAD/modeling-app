import { isDesktop } from '@src/lib/isDesktop'
import { homeSidebarItemsFacet } from '@src/registry/contracts/homeSidebar'
import { projectExplorerProjectMenuItemsFacet } from '@src/registry/contracts/projectExplorer'
import { contribute, type InputOf } from 'plankton'
import { HomeGetDesktopApp, ProjectMenuGetDesktopApp } from './GetDesktopApp'

const isWeb = () => !isDesktop()
const getDesktopAppExtension = [
  contribute(
    homeSidebarItemsFacet,
    () =>
      ({
        id: 'get-desktop-app.home-sidebar',
        order: 100,
        isVisible: isWeb,
        Component: HomeGetDesktopApp,
      }) satisfies InputOf<typeof homeSidebarItemsFacet>,
    {
      key: 'get-desktop-app.home-sidebar',
    }
  ),
  contribute(
    projectExplorerProjectMenuItemsFacet,
    () =>
      ({
        id: 'get-desktop-app.project-menu',
        order: 20,
        placement: 'footer' as const,
        isVisible: isWeb,
        Component: ProjectMenuGetDesktopApp,
      }) satisfies InputOf<typeof projectExplorerProjectMenuItemsFacet>,
    {
      key: 'get-desktop-app.project-menu',
    }
  ),
]
export default getDesktopAppExtension
