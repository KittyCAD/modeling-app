/* @zds-plugin
id = "personal-logo"
name = "Personal workshop logo"
description = "An authored SVG logo and wordmark in the app header. Select it to return Home."
api_version = 1
permissions = []
*/
import type { Activate } from '@zoo/zds-plugin'

const activate: Activate = (zds) => {
  zds.contribute('app.logoLink', {
    id: 'home',
    label: 'My workshop - Home',
    text: 'My workshop',
    logo: {
      viewBox: [0, 0, 24, 24],
      // Replace these monochrome SVG paths with your own mark.
      paths: ['M4 3H20V7H8V11H18V15H8V21H4Z'],
    },
  })
}

export default activate
