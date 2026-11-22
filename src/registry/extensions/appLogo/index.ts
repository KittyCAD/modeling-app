import { appHeaderStartItemsFacet } from '@src/registry/contracts/appHeader'
import { contribute } from 'plankton'
import { AppLogoHeaderItem } from './AppLogoHeaderItem'

/** Default branding and Home navigation can be omitted independently of shell menus. */
const appLogoExtension = contribute(appHeaderStartItemsFacet, () => ({
  id: 'app.home',
  order: -100,
  Component: AppLogoHeaderItem,
}))

export default appLogoExtension
