import {
  computed,
  effect,
  signal,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import type {
  EditorSelectionBridgeDefinition,
  EditorSelectionConnection,
  EditorSelectionEndpoint,
  EditorSelectionEndpoints,
  EditorSelectionLinks,
} from '@src/lib/editors/selectionBridges/contract'

/** Selection payloads remain with their views; this owner handles only typed connection metadata and destination intent. */
export function createEditorSelectionBridges(
  definitions: ReadonlySignal<readonly EditorSelectionBridgeDefinition[]>
) {
  const endpoints = signal<readonly EditorSelectionEndpoint[]>([])
  const explicit = signal<
    readonly { bridgeId: string; source: symbol; target: symbol }[]
  >([])
  const targets = signal<ReadonlyMap<string, ReadonlyMap<symbol, symbol>>>(
    new Map()
  )
  let disposed = false
  const definition = (id: string) =>
    definitions.peek().find((item) => item.id === id)
  const endpoint = (viewId: symbol, kind: string) =>
    endpoints
      .peek()
      .find((item) => item.viewId === viewId && item.kind === kind)
  const connections = computed<readonly EditorSelectionConnection[]>(() => {
    const result: EditorSelectionConnection[] = []
    for (const bridge of definitions.value)
      for (const source of endpoints.value) {
        if (
          source.kind !== bridge.sourceKind ||
          source.enabled?.value === false
        )
          continue
        for (const target of endpoints.value) {
          if (source.viewId === target.viewId) continue
          if (
            target.kind !== bridge.targetKind ||
            target.enabled?.value === false
          )
            continue
          if (
            (bridge.linkSameEditor && source.editorId === target.editorId) ||
            explicit.value.some(
              (link) =>
                link.bridgeId === bridge.id &&
                link.source === source.viewId &&
                link.target === target.viewId
            )
          )
            result.push({ bridgeId: bridge.id, source, target })
        }
      }
    return result
  })
  const stop = effect(() => {
    const live = new Set(definitions.value.map((item) => item.id))
    untracked(() => {
      explicit.value = explicit.peek().filter((link) => live.has(link.bridgeId))
      targets.value = new Map(
        [...targets.peek()].filter(([id]) => live.has(id))
      )
    })
  })
  const links: EditorSelectionLinks = {
    endpoints,
    connections,
    link: (bridgeId, source, target) => {
      const bridge = definition(bridgeId)
      if (
        disposed ||
        source === target ||
        !bridge ||
        !endpoint(source, bridge.sourceKind) ||
        !endpoint(target, bridge.targetKind)
      )
        return new Error(
          'Both endpoint kinds must be registered for this selection bridge.'
        )
      const link = { bridgeId, source, target }
      explicit.value = [...explicit.peek(), link]
      return () => {
        explicit.value = explicit.peek().filter((item) => item !== link)
      }
    },
    setPickingTarget: (bridgeId, source, target) => {
      if (disposed) return new Error('The selection bridge owner closed.')
      if (target === undefined) {
        const next = new Map(targets.peek())
        const choices = new Map(next.get(bridgeId))
        choices.delete(source)
        next.set(bridgeId, choices)
        targets.value = next
        return undefined
      }
      if (
        !connections
          .peek()
          .some(
            (link) =>
              link.bridgeId === bridgeId &&
              link.source.viewId === source &&
              link.target.viewId === target
          )
      )
        return new Error('The picking target must be an enabled linked view.')
      const next = new Map(targets.peek())
      const choices = new Map(next.get(bridgeId))
      choices.set(source, target)
      next.set(bridgeId, choices)
      targets.value = next
      return undefined
    },
    pickingTarget: (bridgeId, source) => {
      if (disposed) return undefined
      const eligible = connections.value.filter(
        (link) => link.bridgeId === bridgeId && link.source.viewId === source
      )
      const target = targets.value.get(bridgeId)?.get(source)
      return target
        ? eligible.find((link) => link.target.viewId === target)?.target.viewId
        : eligible.length === 1
          ? eligible[0].target.viewId
          : undefined
    },
  }
  const registrations: EditorSelectionEndpoints = {
    register: (value) => {
      if (disposed || endpoint(value.viewId, value.kind))
        return new Error(
          'This selection endpoint is already registered or its owner closed.'
        )
      endpoints.value = [...endpoints.peek(), value]
      let closed = false
      return () => {
        if (closed) return
        closed = true
        endpoints.value = endpoints.peek().filter((item) => item !== value)
        for (const bridge of definitions.peek()) {
          explicit.value = explicit
            .peek()
            .filter(
              (link) =>
                link.bridgeId !== bridge.id ||
                !(
                  (bridge.sourceKind === value.kind &&
                    link.source === value.viewId) ||
                  (bridge.targetKind === value.kind &&
                    link.target === value.viewId)
                )
            )
          const next = new Map(targets.peek())
          const choices = new Map(next.get(bridge.id))
          if (bridge.sourceKind === value.kind) choices.delete(value.viewId)
          if (bridge.targetKind === value.kind)
            for (const [source, target] of choices)
              if (target === value.viewId) choices.delete(source)
          next.set(bridge.id, choices)
          targets.value = next
        }
      }
    },
  }
  return {
    links,
    registrations,
    dispose: () => {
      disposed = true
      stop()
      endpoints.value = []
      explicit.value = []
      targets.value = new Map()
    },
  }
}
