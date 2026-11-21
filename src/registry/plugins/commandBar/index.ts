import { CommandBarOpenButton } from '@src/components/CommandBarOpenButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute, type InputOf } from 'plankton'
import { createElement } from 'react'

function CommandBarHeaderItem({ app }: AppHeaderItemProps) {
  return createElement(CommandBarOpenButton, {
    app,
  })
}
const commandBarHeaderItem = [
  contribute(
    appHeaderEndItemsFacet,
    () =>
      ({
        id: 'command-bar.open',
        order: 10,
        Component: CommandBarHeaderItem,
      }) satisfies InputOf<typeof appHeaderEndItemsFacet>
  ),
]
const commandBar = createZdsPlugin({
  id: 'command-bar',
  title: 'Command bar',
  description: 'Command bar controls.',
  items: [commandBarHeaderItem],
  defaultSetting: 'core',
})
export default commandBar
