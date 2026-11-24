import { SaveStatusHeaderItem } from '@src/components/SaveStatusHeaderItem'
import { appHeaderLeftItemsFacet } from '@src/registry/contracts/appHeader'
import { contribute } from 'plankton'

export default contribute(appHeaderLeftItemsFacet, () => ({
  id: 'file-save-status',
  order: 20,
  Component: SaveStatusHeaderItem,
}))
