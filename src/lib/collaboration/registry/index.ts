import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { createElement } from 'react'
import { createCollaboration } from '@src/lib/collaboration/collaboration'
import { collaborationService } from '@src/lib/collaboration/registry/contract'
import {
  editorCapabilityValueSpec,
  editorTabIndicatorValueSpec,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { editorOnSaveValueSpec } from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
/** Project-local collaboration history and its document binding ship together. */
const extension = defineRegistryItemFactory(({ services }) => {
  const collaboration = createCollaboration(
    () => services.optional(projectSessionService)?.currentSession.peek(),
    () => services.get(fileOperationsService)
  )
  function Indicator({ editor }: { editor: Editor }) {
    useSignals()
    const state = collaboration.service.state(editor).value
    if (state.status === 'ready' && !state.error) return null
    const label =
      state.status === 'loading'
        ? 'Loading collaboration history'
        : (state.error?.message ?? 'Collaboration error')
    return createElement('span', {
      title: label,
      role: 'img',
      'aria-label': label,
      className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-3',
    })
  }
  return {
    providesServices: [
      provideService(collaborationService, collaboration.service),
    ],
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.collaboration',
        matches: '*',
        setup: collaboration.setup,
      }),
      provide(editorTabIndicatorValueSpec, {
        id: 'editors.collaboration.status',
        component: Indicator,
      }),
      provide(editorOnSaveValueSpec, {
        id: 'collaboration.checkpoint',
        matches: '*',
        order: 2000,
        onSave: async ({ editor, src, contents }) => {
          await collaboration.checkpoint(editor, src, contents)
        },
      }),
    ],
    dispose: collaboration.dispose,
  }
}, 'collaboration')
export default withProjectShellFeature(extension, 'collaboration')
