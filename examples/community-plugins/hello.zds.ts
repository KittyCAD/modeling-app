/* @zds-plugin
id = "hello"
name = "Hello plugin"
api_version = 1
permissions = ["ui.notify"]
*/
import type { Activate } from '@zoo/zds-plugin'

const activate: Activate = (zds) => {
  zds.contribute('command', {
    id: 'hello',
    title: 'Say hello',
    run: () => zds.ui.notify('Hello from a local plugin!'),
  })
}

export default activate
