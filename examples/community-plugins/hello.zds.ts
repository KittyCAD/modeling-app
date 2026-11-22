/* @zds-plugin
id = "hello"
name = "Hello plugin"
api_version = 1
permissions = ["ui.notify"]
*/
import type { Activate } from '@zoo/zds-plugin'

const activate: Activate = (zds) => {
  zds.contribute('settings', {
    fields: {
      greeting: {
        type: 'string',
        title: 'Greeting',
        description: 'The message shown by Say hello.',
        default: 'Hello from a local plugin!',
        maxLength: 1000,
      },
    },
  })
  zds.contribute('command', {
    id: 'hello',
    title: 'Say hello',
    run: () => zds.ui.notify(zds.settings.getString('greeting')),
  })
}

export default activate
