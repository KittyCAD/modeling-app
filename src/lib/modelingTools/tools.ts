import { type ReadonlySignal, signal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import type {
  ModelingTarget,
  ModelingTool,
  ModelingToolsService,
} from '@src/lib/modelingTools/registry/contract'
import type { CommandSystemService } from '@src/registry/contracts/commands'

/** Resolve contributions reactively; invocation repeats checks because an open menu can become stale. */
export function createModelingTools(
  contributions: ReadonlySignal<readonly ModelingTool[]>,
  commands: ReadonlySignal<readonly Command[]>,
  send: CommandSystemService['send']
): ModelingToolsService {
  const targets = signal<readonly ModelingTarget[]>([])
  const findCommand = (tool: ModelingTool) =>
    commands.value.find(
      (command) =>
        command.name === tool.command.name &&
        command.groupId === tool.command.groupId
    )
  const reason = (tool: ModelingTool, target: ModelingTarget) => {
    if (!targets.value.includes(target)) return 'This modeling view is closed'
    const command = findCommand(tool)
    if (!command) return 'This tool’s command is not registered'
    const unavailable =
      target.unavailableReason() ?? tool.unavailableReason?.(target)
    if (unavailable) return unavailable
    if (command.disabled) return 'This command is unavailable'
    return undefined
  }
  return {
    targets,
    attach: (editor, unavailableReason, commandArguments) => {
      const target = {
        id: crypto.randomUUID(),
        editor,
        unavailableReason,
        commandArguments,
      }
      targets.value = [...targets.peek(), target]
      return {
        target,
        dispose: () => {
          targets.value = targets.peek().filter((item) => item !== target)
        },
      }
    },
    getTarget: (id) => targets.value.find((target) => target.id === id),
    resolve: (target) =>
      contributions.value
        .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((tool) => {
          const command = findCommand(tool)
          return {
            tool,
            label: command?.displayName ?? tool.command.name,
            description: command?.description,
            unavailableReason: reason(tool, target),
          }
        }),
    unavailableReason: (id, target) => {
      const tool = contributions.value.find((tool) => tool.id === id)
      return tool ? reason(tool, target) : 'This tool is no longer registered'
    },
    invoke: (id, target) => {
      const tool = contributions.value.find((tool) => tool.id === id)
      if (!tool) return new Error('This tool is no longer registered')
      const unavailable = reason(tool, target)
      if (unavailable) return new Error(unavailable)
      const command = findCommand(tool)
      if (!command) return new Error('This tool’s command is not registered')
      send({
        type: 'Find and select command',
        data: {
          name: command.name,
          groupId: command.groupId,
          argDefaultValues: target.commandArguments(),
        },
      })
    },
  }
}
