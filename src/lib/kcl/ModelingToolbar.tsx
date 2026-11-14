import { ResponsiveToolbar } from '@src/components/Toolbar/ResponsiveToolbar'
import { groupToolbarItems } from '@src/components/Toolbar/groups'
import { useSignals } from '@preact/signals-react/runtime'
import { lazy, Suspense, useId } from 'react'
import { type ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'
import { ErrorBanner } from '@src/components/ErrorBanner'
import usePlatform from '@src/hooks/usePlatform'
import {
  modelingStdLibCommandSummary,
  modelingStdLibCommandDocsLink,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { isErr, reportRejection } from '@src/lib/trap'
const Dialog = lazy(() => import('@src/lib/kcl/ModelingToolDialog'))

/** Adapt one view's command host to the same toolbar used by the file route. */
export function ModelingToolbar({ context }: { context: ModelingViewContext }) {
  useSignals()
  const idPrefix = useId() + '-'
  const platform = usePlatform()
  const tools = context.tools
  const interaction = context.interactions.active.value
  const scene = context.session.resource.value
  const disabled =
    context.executor.editor.readOnly.value ||
    context.executor.output.value.running ||
    !scene?.selection.model.value ||
    tools.opening.value ||
    context.interactions.busy.value
  const items: ToolbarViewItem[] = tools.definitions.value.map((tool) => {
    const docs = modelingStdLibCommandDocsLink(tool.name)
    return {
      id: tool.id,
      groupId: tool.groupId,
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
  const entries: ToolbarViewItem[] = context.interactions.definitions.value
    .flatMap((definition) => definition.entries)
    .map((entry) => ({
      id: entry.id,
      groupId: entry.groupId,
      title: entry.name,
      icon: entry.icon,
      status: 'available',
      description: '',
      links: [],
      ...entry.presentation?.(context),
      disabled,
      onClick: () => {
        context.interactions.enter(entry.id).catch(reportRejection)
      },
    }))
  const shownItems = interaction
    ? [...interaction.toolbar.value]
    : [...entries, ...items]
  const grouped = groupToolbarItems(shownItems, context.toolGroups.value)
  const error =
    (isErr(grouped) ? grouped : undefined) ??
    interaction?.error.value ??
    context.interactions.error.value ??
    tools.error.value
  return (
    <>
      <div className="toolbar-container pointer-events-none absolute inset-x-0 top-0 z-[19]">
        <ResponsiveToolbar
          items={isErr(grouped) ? shownItems : grouped}
          mode={interaction ? 'sketching' : 'modeling'}
          platform={platform}
          idPrefix={idPrefix}
        >
          {interaction && (
            <p
              role="status"
              className="pointer-events-auto mt-2 bg-2 px-3 py-1 text-xs"
            >
              {interaction.prompt.value}
            </p>
          )}
          {error && (
            <div className="mt-2">
              <ErrorBanner
                title="Unable to open tool"
                message={error.message}
              />
            </div>
          )}
        </ResponsiveToolbar>
      </div>
      {tools.active.value && (
        <Suspense fallback={null}>
          <Dialog dialog={tools.active.value} />
        </Suspense>
      )}
    </>
  )
}
