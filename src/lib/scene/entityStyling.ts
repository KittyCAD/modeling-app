import type { EntityReference } from '@kittycad/lib'
import { signal, type ReadonlySignal } from '@preact/signals-core'

/** Display-referred sRGB channels in [0, 1]; adapters convert their chosen color space before rendering. */
export type EntityStyleColor = readonly [number, number, number]
/** Generic overlay appearance. Higher priority wins for a shared entity; equal priorities use group creation order. */
export interface EntityStyle {
  readonly color: EntityStyleColor
  readonly fillOpacity: number
  readonly outlineOpacity: number
  readonly lineWidth: number
  readonly priority: number
}
export interface EntityStyleGroup {
  readonly id: symbol
  readonly style: EntityStyle
  readonly entities: readonly EntityReference[]
}
/** A lease can update only its own group. Resetting the scene expires existing leases. */
export interface EntityStyleHandle {
  set: (entities: readonly EntityReference[]) => Error | undefined
  clear: () => void
  dispose: () => void
}
export interface EntityStyling {
  readonly groups: ReadonlySignal<readonly EntityStyleGroup[]>
  createGroup: (style: EntityStyle) => EntityStyleHandle | Error
}
export function createEntityStyling() {
  const groups = signal<readonly EntityStyleGroup[]>([])
  let epoch = 0
  let closed = false
  const service: EntityStyling = {
    groups,
    createGroup: (style) => {
      const channels = [...style.color, style.fillOpacity, style.outlineOpacity]
      if (
        closed ||
        channels.some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1
        ) ||
        !Number.isFinite(style.priority) ||
        !Number.isFinite(style.lineWidth) ||
        style.lineWidth <= 0
      )
        return new Error(
          'Entity styling requires finite colors/opacities in [0, 1] and a positive line width.'
        )
      const id = Symbol('entity style group'),
        generation = epoch
      const appearance: EntityStyle = { ...style, color: [...style.color] }
      let disposed = false
      // Retain insertion order even while empty; equal-priority updates must not change precedence.
      groups.value = [...groups.peek(), { id, style: appearance, entities: [] }]
      const current = () => !closed && !disposed && epoch === generation
      const clear = () => {
        if (current())
          groups.value = groups
            .peek()
            .map((group) =>
              group.id === id ? { ...group, entities: [] } : group
            )
      }
      return {
        set: (entities) => {
          if (!current()) return new Error('The entity styling group expired.')
          groups.value = groups
            .peek()
            .map((group) =>
              group.id === id
                ? { ...group, entities: structuredClone(entities) }
                : group
            )
          return undefined
        },
        clear,
        dispose: () => {
          if (current())
            groups.value = groups.peek().filter((group) => group.id !== id)
          disposed = true
        },
      }
    },
  }
  return {
    service,
    reset: () => {
      epoch++
      groups.value = []
    },
    dispose: () => {
      closed = true
      epoch++
      groups.value = []
    },
  }
}
