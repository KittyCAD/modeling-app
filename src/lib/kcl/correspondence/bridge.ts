import type { EntityReference } from '@kittycad/lib'
import { computed, effect, signal, type Signal } from '@preact/signals-core'
import type {
  EditorSelectionLinks,
  EditorSelectionEndpoints,
} from '@src/lib/editors/selectionBridges/contract'
import {
  kclSelectionBridge,
  type CodeCorrespondenceEndpoint,
  type ModelingCorrespondenceEndpoint,
  type KclCorrespondenceEndpoints,
  type KclCorrespondenceStatus,
} from '@src/lib/kcl/correspondence/contract'
import type { SourceRange } from '@src/lang/wasm'
import {
  createArtifactCorrespondence,
  resolvePickingCandidates,
} from '@src/lang/std/correspondence'
import { entityReferenceKey } from '@src/lib/scene/entityReference'
import fsZds from '@src/lib/fs-zds'

interface CodeRegistration extends CodeCorrespondenceEndpoint {
  ranges: Signal<readonly SourceRange[]>
}

/** Explicit links connect view instances, with same-buffer links as the initial policy. No global active-editor lookup. */
export function createCorrespondenceBridge(routing: {
  links: EditorSelectionLinks
  registrations: EditorSelectionEndpoints
}) {
  const codes = signal<readonly CodeRegistration[]>([])
  const models = signal<readonly ModelingCorrespondenceEndpoint[]>([])
  const error = signal<Error | undefined>(undefined)
  let disposed = false
  let generation = 0
  const linked = (
    code: CodeRegistration,
    model: ModelingCorrespondenceEndpoint
  ) =>
    routing.links.connections.value.some(
      (link) =>
        link.bridgeId === kclSelectionBridge.id &&
        link.source.viewId === code.id &&
        link.target.viewId === model.id
    )
  const execution = (endpoint: ModelingCorrespondenceEndpoint) => {
    const run = endpoint.execution.value
    return (
      run && {
        ...run,
        query: createArtifactCorrespondence(run.state.artifactGraph),
      }
    )
  }
  const sourceModule = (
    code: CodeRegistration,
    run: NonNullable<ReturnType<typeof execution>>
  ) => {
    const src = code.editor.src.value
    if (!src)
      return code.editor.contents.value === run.output.contents &&
        !run.output.src
        ? 0
        : undefined
    const normalized = fsZds.join(src)
    if (normalized === fsZds.join(run.output.src))
      return code.editor.contents.value === run.output.contents ? 0 : undefined
    const bytes = run.sources?.files.get(normalized)
    if (
      !bytes ||
      new TextDecoder().decode(bytes) !== code.editor.contents.value
    )
      return undefined
    const module = Object.entries(run.state.filenames).find(
      ([, path]) =>
        path?.type === 'Local' && fsZds.join(path.value) === normalized
    )
    return module ? Number(module[0]) : undefined
  }
  const projected = computed(() => {
    const codeRanges = new Map<symbol, SourceRange[]>()
    const geometry = new Map<
      symbol,
      {
        run: NonNullable<ReturnType<typeof execution>>
        entities: EntityReference[]
      }
    >()
    for (const model of models.value) {
      const run = execution(model)
      if (!run) continue
      const entities = new Map<string, EntityReference>()
      for (const code of codes.value) {
        if (!linked(code, model)) continue
        const module = sourceModule(code, run)
        if (module === undefined) continue
        const ranges = codeRanges.get(code.id) ?? []
        for (const item of model.selection.items.value) {
          if (item.kind === 'model' && item.value.model === run.model)
            ranges.push(
              ...run.query
                .forEntity(item.value.reference)
                .filter((item) => item.range[2] === module)
                .map((item) => item.range)
            )
          // TODO: Project native sketch solver source references here once an execution-qualified sketch correspondence endpoint is exposed.
        }
        codeRanges.set(code.id, ranges)
        // Native sketch interaction owns its surface and must not receive engine selection projections.
        if (model.interacting.value) continue
        for (const range of code.ranges.value)
          for (const item of run.query.forCode([range[0], range[1], module])) {
            const key = entityReferenceKey(item.entity)
            if (key) entities.set(key, item.entity)
          }
      }
      geometry.set(model.id, { run, entities: [...entities.values()] })
    }
    return { codeRanges, geometry, codes: codes.value, models: models.value }
  })
  const stop = effect(() => {
    const projection = projected.value
    const ticket = ++generation
    // CodeMirror cannot be dispatched from inside its update listener. Coalesce projections after the update completes.
    queueMicrotask(() => {
      if (disposed || ticket !== generation) return
      for (const code of projection.codes)
        code.decorate(projection.codeRanges.get(code.id) ?? [])
      for (const model of projection.models) {
        const geometry = projection.geometry.get(model.id)
        model.project(geometry?.run, geometry?.entities ?? [])
      }
    })
  })
  const cleanups = new Set<() => void>()
  const registrations: KclCorrespondenceEndpoints = {
    registerCode: (endpoint) => {
      if (disposed) return new Error('The correspondence owner closed.')
      const unregister = routing.registrations.register({
        viewId: endpoint.id,
        editorId: endpoint.editor.id,
        kind: kclSelectionBridge.sourceKind,
        enabled: endpoint.enabled,
      })
      if (unregister instanceof Error) return unregister
      const code = { ...endpoint, ranges: signal<readonly SourceRange[]>([]) }
      codes.value = [...codes.peek(), code]
      let closed = false
      const dispose = () => {
        if (closed) return
        closed = true
        codes.value = codes.peek().filter((item) => item !== code)
        unregister()
        endpoint.decorate([])
        cleanups.delete(dispose)
      }
      cleanups.add(dispose)
      return {
        select: (ranges) => {
          if (!closed) selectCode(code, ranges)
        },
        invalidate: () => {
          if (!closed) code.ranges.value = []
        },
        dispose,
      }
    },
    registerModel: (endpoint) => {
      if (disposed) return new Error('The correspondence owner closed.')
      const unregister = routing.registrations.register({
        viewId: endpoint.id,
        editorId: endpoint.editorId,
        kind: kclSelectionBridge.targetKind,
        enabled: endpoint.enabled,
      })
      if (unregister instanceof Error) return unregister
      models.value = [...models.peek(), endpoint]
      let closed = false
      const dispose = () => {
        if (closed) return
        closed = true
        endpoint.project(undefined, [])
        models.value = models.peek().filter((item) => item !== endpoint)
        unregister()
        cleanups.delete(dispose)
      }
      cleanups.add(dispose)
      return dispose
    },
  }
  /** Only intentional Code selections enter this path. Decoration updates cannot echo into picking. */
  const selectCode = (
    code: CodeRegistration,
    ranges: readonly SourceRange[]
  ) => {
    if (disposed) return
    code.ranges.value = ranges
    error.value = undefined
    const targetId = routing.links.pickingTarget(kclSelectionBridge.id, code.id)
    const destination = models.peek().find((item) => item.id === targetId)
    if (!destination) return
    const run = execution(destination)
    const argument = destination.pickingArgument.peek()
    if (!run || !argument) return
    const module = sourceModule(code, run)
    if (module === undefined) return
    const candidates = resolvePickingCandidates(
      ranges.map((range) => run.query.forCode([range[0], range[1], module])),
      argument.accepts,
      argument.multiple
    )
    if (candidates instanceof Error) {
      error.value = candidates
      return
    }
    error.value = destination.offer(run, candidates)
  }
  const service: KclCorrespondenceStatus = { error }
  return {
    service,
    registrations,
    // TODO: Add opt-in navigation independently of correspondence highlighting and selection promotion.
    // TODO: A feature-tree endpoint should offer direct entity candidates to the same execution-bound picking session.
    // TODO: Add a view-link/picking-destination UI; never resolve multiple destinations through global focus or open-dialog order.
    dispose: () => {
      if (disposed) return
      disposed = true
      generation++
      stop()
      for (const cleanup of [...cleanups]) cleanup()
      codes.value = []
      models.value = []
    },
  }
}
