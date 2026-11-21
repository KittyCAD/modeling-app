import { useSignals } from '@preact/signals-react/runtime'
import { LegacyPublishButton } from '@src/lib/publishing/LegacyPublishButton'
import { ProjectSessionPublishButton } from '@src/lib/publishing/ProjectSessionPublishButton'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { contribute, type InputOf } from 'plankton'
import { createElement } from 'react'

function PublishHeaderItem({ app, context }: AppHeaderItemProps) {
  useSignals()
  switch (context.type) {
    case 'project':
      return createElement(ProjectSessionPublishButton, {
        app,
        session: context.session,
      })
    case 'legacy-project':
      return createElement(LegacyPublishButton, { app })
    case 'home':
      return null
  }
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
