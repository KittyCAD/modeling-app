import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import {
  createCodeChangesPreview,
  type CodeChangesPreviewController,
} from '@src/lib/codeChangesPreview'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { getOpenPanes, togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  codeChangesPreviewService,
  type CodeChangesPreviewService,
} from '@src/registry/contracts/codeChangesPreview'
import { layoutService } from '@src/registry/contracts/layout'
import { projectSession } from '@src/registry/contracts/projectSession'

export default defineRegistryItemFactory((ctx) => {
  const session = ctx.services.signal(projectSession)
  let preview: CodeChangesPreviewController | undefined
  // Effects read services immediately, so start observing only after graph assembly.
  const ensurePreview = () =>
    (preview ??= createCodeChangesPreview(
      () => session.value?.project.value?.executingEditor.value
    ))
  const service: CodeChangesPreviewService = {
    get current() {
      return ensurePreview().current
    },
    clear: (owner) => preview?.clear(owner),
    open(editor, snapshot) {
      const publish = ensurePreview().open(editor, snapshot)
      if (!publish) return
      const layout = ctx.services.get(layoutService)
      const rootLayout = layout.get()
      if (!getOpenPanes({ rootLayout }).includes(DefaultLayoutPaneID.Code)) {
        layout.set(
          togglePaneLayoutNode({
            rootLayout: structuredClone(rootLayout),
            targetNodeId: DefaultLayoutPaneID.Code,
            shouldExpand: true,
          })
        )
      }
      return publish
    },
  }

  return {
    id: 'code-changes-preview',
    providesServices: [provideService(codeChangesPreviewService, service)],
    dispose: () => preview?.dispose(),
  }
}, 'code-changes-preview')
