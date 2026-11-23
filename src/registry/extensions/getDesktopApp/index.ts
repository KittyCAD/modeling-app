import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
import { REGEXP_UUIDV4 } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { homeSidebarItemsFacet } from '@src/registry/contracts/homeSidebar'
import { projectExplorerProjectMenuItemsFacet } from '@src/registry/contracts/projectExplorer'
import { contribute, factory, type InputOf } from 'plankton'
import {
  HomeGetDesktopApp,
  ProjectMenuGetDesktopApp,
  ProjectMenuOpenInDesktopApp,
} from './GetDesktopApp'

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
  factory({
    dependencies: { cloud: cloudProjectsObservations },
    create: ({ cloud: { cloudStorageService } }) => ({
      items: [
        contribute(projectExplorerProjectMenuItemsFacet, () => ({
          id: 'open-desktop-app.project-menu',
          order: 19,
          placement: 'footer' as const,
          isVisible: ({ project, projectPath }) => {
            const id = project.cloudProjectId
            return (
              isWeb() &&
              !!id &&
              REGEXP_UUIDV4.test(id) &&
              cloudStorageService.current.value?.pathFor(id) === projectPath
            )
          },
          Component: ProjectMenuOpenInDesktopApp,
        })),
      ],
    }),
  }),
]
export default getDesktopAppExtension
