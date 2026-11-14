import { useSignals } from '@preact/signals-react/runtime'
import { lazy, Suspense, useId } from 'react'
import {
  ToolbarView,
  type ToolbarViewItem,
} from '@src/components/Toolbar/ToolbarView'
import { ErrorBanner } from '@src/components/ErrorBanner'
import usePlatform from '@src/hooks/usePlatform'
import {
  modelingStdLibCommandSummary,
  modelingStdLibCommandDocsLink,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { reportRejection } from '@src/lib/trap'
const Dialog = lazy(() => import('@src/lib/kcl/ModelingToolDialog'))

/** Adapt one view's command host to the same toolbar used by the file route. */
export function ModelingToolbar({ context }: { context: ModelingViewContext }) {
  useSignals()
  const idPrefix = useId() + '-'
  const platform = usePlatform()
  const tools = context.tools
  const scene = context.session.resource.value
  const disabled =
    context.executor.editor.readOnly.value ||
    context.executor.output.value.running ||
    !scene?.selection.model.value ||
    tools.opening.value
  const items: ToolbarViewItem[] = tools.definitions.value.map((tool) => {
    const docs = modelingStdLibCommandDocsLink(tool.name)
    return {
      id: tool.id,
      title: tool.name,
      icon: tool.icon,
      status: 'available',
      disabled,
      description: modelingStdLibCommandSummary(tool.name) ?? '',
      links: docs ? [docs] : [],
      isActive: tools.active.value?.command.id === tool.id,
      onClick: () => {
        tools.open(tool.id).catch(reportRejection)
      },
    }
  })
  return (
    <>
      <div className="toolbar-container pointer-events-none absolute inset-x-0 top-0 z-[19]">
        <ToolbarView
          items={items}
          mode="modeling"
          platform={platform}
          idPrefix={idPrefix}
        >
          {tools.error.value && (
            <div className="mt-2">
              <ErrorBanner
                title="Unable to open tool"
                message={tools.error.value.message}
              />
            </div>
          )}
        </ToolbarView>
      </div>
      {tools.active.value && (
        <Suspense fallback={null}>
          <Dialog dialog={tools.active.value} />
        </Suspense>
      )}
    </>
  )
}
