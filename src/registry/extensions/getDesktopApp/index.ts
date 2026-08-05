import { defineRegistryItem, provide } from '@kittycad/registry'
import { isDesktop } from '@src/lib/isDesktop'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import { projectExplorerProjectMenuItemsValueSpec } from '@src/registry/contracts/projectExplorer'
import { HomeGetDesktopApp, ProjectMenuGetDesktopApp } from './GetDesktopApp'

const isWeb = () => !isDesktop()

const getDesktopAppExtension = defineRegistryItem({
  id: 'get-desktop-app',
  provides: [
    provide(
      homeSidebarItemsValueSpec,
      {
        id: 'get-desktop-app.home-sidebar',
        order: 100,
        isVisible: isWeb,
        Component: HomeGetDesktopApp,
      },
      { key: 'get-desktop-app.home-sidebar' }
    ),
    provide(
      projectExplorerProjectMenuItemsValueSpec,
      {
        id: 'get-desktop-app.project-menu',
        order: 20,
        placement: 'footer',
        isVisible: isWeb,
        Component: ProjectMenuGetDesktopApp,
      },
      { key: 'get-desktop-app.project-menu' }
    ),
  ],
})

export default getDesktopAppExtension
