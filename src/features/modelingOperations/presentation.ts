import type {
  FieldGroup,
  FieldPresentation,
  OperationPresentation,
} from '@src/contracts/operationPresentation'

/** Every contribution for one operation, folded together. */
export interface OperationLayout {
  groups: readonly FieldGroup[]
  fields: Readonly<Record<string, FieldPresentation>>
}

/** One group and the arguments that belong to it, in the order to show them. */
export interface ArrangedGroup {
  /** Null for the fields that named no group. */
  group: FieldGroup | null
  names: readonly string[]
}

export const emptyLayout: OperationLayout = { groups: [], fields: {} }

/**
 * Fold every contribution for one operation into one layout.
 *
 * Merged per field rather than per operation, so a feature can add a hint to
 * one argument without restating a layout it does not own. Later contributions
 * win key by key, which is the same rule the registry's other value specs use.
 */
export function layoutFor(
  contributions: readonly OperationPresentation[],
  operationId: string
): OperationLayout {
  const mine = contributions.filter(
    (entry) => entry.operationId === operationId
  )
  if (mine.length === 0) return emptyLayout

  const groups: FieldGroup[] = []
  const fields: Record<string, FieldPresentation> = {}

  for (const entry of mine) {
    for (const group of entry.groups ?? []) {
      const existing = groups.findIndex(
        (candidate) => candidate.id === group.id
      )
      // Position comes from where a group was first declared; its contents from
      // whoever spoke last. Otherwise adding a description would move a section.
      if (existing === -1) groups.push(group)
      else groups[existing] = { ...groups[existing], ...group }
    }

    for (const [name, field] of Object.entries(entry.fields ?? {})) {
      fields[name] = { ...fields[name], ...field }
    }
  }

  return { groups, fields }
}

/**
 * Put a set of arguments into their groups, in display order.
 *
 * Takes the argument names rather than reading them off the layout, because the
 * operation decides which arguments exist and the layout only says where they
 * go. A field with no `order` keeps its declared position, so a layout that
 * says nothing about ordering changes nothing.
 */
export function arrangeFields(
  layout: OperationLayout,
  names: readonly string[]
): readonly ArrangedGroup[] {
  const declared = new Map(names.map((name, index) => [name, index]))

  const sorted = (members: readonly string[]) =>
    [...members].sort((a, b) => {
      const byOrder =
        (layout.fields[a]?.order ?? 0) - (layout.fields[b]?.order ?? 0)
      return byOrder !== 0
        ? byOrder
        : (declared.get(a) ?? 0) - (declared.get(b) ?? 0)
    })

  const groupOf = (name: string) => {
    const id = layout.fields[name]?.group
    // A field naming a group nobody declared is ungrouped rather than dropped:
    // losing an argument is worse than showing it above the first heading.
    return id && layout.groups.some((group) => group.id === id) ? id : null
  }

  const ungrouped = names.filter((name) => groupOf(name) === null)

  const arranged: ArrangedGroup[] = []
  if (ungrouped.length > 0) {
    arranged.push({ group: null, names: sorted(ungrouped) })
  }

  for (const group of layout.groups) {
    const members = names.filter((name) => groupOf(name) === group.id)
    // An empty section is a heading over nothing, which reads as a bug.
    if (members.length === 0) continue
    arranged.push({ group, names: sorted(members) })
  }

  return arranged
}
