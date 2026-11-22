import { contribute } from 'plankton'
import {
  appHeaderStartItemsFacet,
  appHeaderEndItemsFacet,
} from '@src/registry/contracts/appHeader'
import { ProjectHeaderItem, AccountHeaderItem } from './HeaderItems'

export default [
  contribute(appHeaderStartItemsFacet, () => ({
    id: 'project.menu',
    order: 0,
    Component: ProjectHeaderItem,
  })),
  contribute(appHeaderEndItemsFacet, () => ({
    id: 'account.menu',
    order: 1000,
    Component: AccountHeaderItem,
  })),
]
