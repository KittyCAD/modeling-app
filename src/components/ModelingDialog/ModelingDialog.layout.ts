import type { ModelingDialogField } from '@src/components/ModelingDialog/ModelingDialog.arguments'
import { hasCommandArgumentValue } from '@src/lib/commandBarConfigs/modelingCommandUtils'
import type {
  CommandDialogGroup,
  CommandDialogLayout,
} from '@src/lib/commandTypes'

type ResolvedDialogGroup = Omit<CommandDialogGroup, 'args'> & {
  fields: ModelingDialogField[]
  defaultOpen: boolean
}

/** Layout is optional: it orders fields, never decides which arguments exist. */
export function resolveDialogGroups(
  fields: ModelingDialogField[],
  layout: CommandDialogLayout | undefined,
  values: Record<string, unknown>
): ResolvedDialogGroup[] {
  if (!layout?.length) {
    return []
  }

  const remaining = new Map(fields.map((field) => [field.argName, field]))
  const groups = layout.map(({ args, ...group }) => ({
    ...group,
    fields: args.flatMap((name) => {
      const field = remaining.get(name)
      remaining.delete(name)
      return field ? [field] : []
    }),
  }))

  if (remaining.size) {
    groups.push({ title: 'Parameters', fields: [...remaining.values()] })
  }

  return groups
    .filter((group) => group.fields.length > 0)
    .map((group) => ({
      ...group,
      defaultOpen: group.fields.some(({ argName }) => {
        const value = values[argName]
        return typeof value === 'boolean'
          ? value
          : hasCommandArgumentValue(value)
      }),
    }))
}
