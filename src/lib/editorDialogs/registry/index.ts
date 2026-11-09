import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { editorViewValueSpec } from '@src/lib/editors/registry/contract'
import { executorCapabilityValueSpec } from '@src/lib/executors/registry/contract'
import { createEditorDialogs } from '@src/lib/editorDialogs/dialogs'
import { editorDialogsService } from '@src/lib/editorDialogs/registry/contract'

export const editorDialogsExtension = defineRegistryItemFactory(
  ({ valueSpecs }) => {
    const dialogs = createEditorDialogs(
      valueSpecs.signal(editorViewValueSpec),
      valueSpecs.signal(executorCapabilityValueSpec)
    )
    return {
      id: 'editor-dialogs',
      providesServices: [provideService(editorDialogsService, dialogs)],
      dispose: dialogs.close,
    }
  },
  'editor-dialogs'
)
