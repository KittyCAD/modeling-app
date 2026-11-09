import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { CustomIconName } from '@src/components/CustomIcon'
import type { Editor } from '@src/lib/editors/registry/contract'

/** A tool advertises a command; argument collection and execution belong to that command. */
export interface ModelingTool {
  id: string
  command: { name: string; groupId: string }
  icon: CustomIconName
  group?: string
  order?: number
  unavailableReason?: (target: ModelingTarget) => string | undefined
}

/** A mode-owned target keeps a command tied to one editor through tab changes. */
export interface ModelingTarget {
  id: string
  editor: Editor
  unavailableReason: () => string | undefined
  /** Resolve invocation arguments at click time, including any execution identity owned by the host. */
  commandArguments: () => Record<string, unknown>
}

export interface ResolvedModelingTool {
  tool: ModelingTool
  label: string
  description?: string
  unavailableReason?: string
}

/** Targets live as long as their mode context, rather than the toolbar's React mount. */
export interface ModelingToolsService {
  targets: ReadonlySignal<readonly ModelingTarget[]>
  attach: (
    editor: Editor,
    unavailableReason: ModelingTarget['unavailableReason'],
    commandArguments: ModelingTarget['commandArguments']
  ) => {
    target: ModelingTarget
    dispose: () => void
  }
  getTarget: (id: string) => ModelingTarget | undefined
  resolve: (target: ModelingTarget) => readonly ResolvedModelingTool[]
  unavailableReason: (
    toolId: string,
    target: ModelingTarget
  ) => string | undefined
  invoke: (toolId: string, target: ModelingTarget) => Error | undefined
}

export const { modelingToolsValueSpec, modelingToolsService } = defineContract({
  modelingToolsValueSpec: appendValueSpec<ModelingTool>('modeling.tools'),
  modelingToolsService: defineService<ModelingToolsService>(
    'modeling.tools-service'
  ),
})
