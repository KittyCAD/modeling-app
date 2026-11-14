import type { ModelingToolDefinition } from '@src/lib/kcl/modelingTools'
import type { StdlibTool } from '@src/lib/kcl/stdlibTools'

/** Keep native command implementations lazy while capturing each tool's argument type. */
export function defineStdlibModelingTool<Args extends object>(
  metadata: Pick<ModelingToolDefinition, 'id' | 'name' | 'icon' | 'groupId'>,
  load: () => Promise<Pick<StdlibTool<Args>, 'arguments' | 'codemod'>>
): ModelingToolDefinition {
  return {
    ...metadata,
    createDialog: async (context, experimental, onClose, isCurrent) => {
      const [{ createModelingDialog }, implementation] = await Promise.all([
        import('@src/lib/kcl/modelingDialog'),
        load(),
      ])
      return createModelingDialog(
        context,
        { ...implementation, ...metadata },
        experimental,
        onClose,
        isCurrent
      )
    },
  }
}

export const defaultModelingTools = [
  defineStdlibModelingTool(
    {
      groupId: 'kcl.solids',
      id: 'kcl.extrude',
      name: 'Extrude',
      icon: 'extrude',
    },
    async () => (await import('@src/lib/kcl/stdlibTools')).extrudeTool
  ),
  defineStdlibModelingTool(
    { groupId: 'kcl.solids', id: 'kcl.loft', name: 'Loft', icon: 'loft' },
    async () => (await import('@src/lib/kcl/stdlibTools')).loftTool
  ),
]
