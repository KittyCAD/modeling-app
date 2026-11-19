import { useSignals } from '@preact/signals-react/runtime'
import { PublishButton } from '@src/components/PublishButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute, type InputOf } from 'plankton'
import { createElement } from 'react'

function PublishHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()
  if (!app.projectSignal.value) {
    return null
  }
  return createElement(PublishButton, {
    app,
  })
}
const publishHeaderItem = [
  contribute(
    appHeaderItemsFacet,
    () =>
      ({
        id: 'publish.open',
        order: 100,
        Component: PublishHeaderItem,
      }) satisfies InputOf<typeof appHeaderItemsFacet>
  ),
]
const publish = createZdsPlugin({
  id: 'publish',
  title: 'Publish',
  description: 'Publish project controls.',
  items: [publishHeaderItem],
  defaultSetting: 'core',
})
export default publish
