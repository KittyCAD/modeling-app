import { useSignals } from '@preact/signals-react/runtime'
import { LegacyPublishButton } from '@src/lib/publishing/LegacyPublishButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute, type InputOf } from 'plankton'
import { createElement } from 'react'

function PublishHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()
  if (!app.projectSignal.value) {
    return null
  }
  return createElement(LegacyPublishButton, {
    app,
  })
}
const publishHeaderItem = [
  contribute(
    appHeaderEndItemsFacet,
    () =>
      ({
        id: 'publish.open',
        order: 100,
        Component: PublishHeaderItem,
      }) satisfies InputOf<typeof appHeaderEndItemsFacet>
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
