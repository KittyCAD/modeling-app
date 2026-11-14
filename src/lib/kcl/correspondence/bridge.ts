import type { EntityReference } from '@kittycad/lib'
import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
  type Signal,
} from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { SourceRange } from '@src/lang/wasm'
import {
  createArtifactCorrespondence,
  resolvePickingCandidates,
} from '@src/lang/std/correspondence'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { entityReferenceKey } from '@src/lib/scene/entityReference'
import fsZds from '@src/lib/fs-zds'

export interface CodeCorrespondenceEndpoint {
  readonly id: symbol
  readonly editor: Editor
  readonly enabled?: ReadonlySignal<boolean>
  /** Decorations are delivered separately from the CodeMirror selection and never cause navigation. */
  decorate: (ranges: readonly SourceRange[]) => void
}
export interface ModelingCorrespondenceEndpoint {
  readonly id: symbol
  readonly context: ModelingViewContext
  readonly enabled?: ReadonlySignal<boolean>
}
interface CodeRegistration extends CodeCorrespondenceEndpoint {
  ranges: Signal<readonly SourceRange[]>
}

/** Explicit links connect view instances, with same-buffer links as the initial policy. No global active-editor lookup. */
export function createCorrespondenceBridge() {
  const codes = signal<readonly CodeRegistration[]>([])
  const models = signal<readonly ModelingCorrespondenceEndpoint[]>([])
  const links = signal<readonly { code: symbol; model: symbol }[]>([])
  const targets = new Map<symbol, symbol>()
  const error = signal<Error | undefined>(undefined)
  let disposed = false
  let generation = 0
  const linked = (
    code: CodeRegistration,
    model: ModelingCorrespondenceEndpoint
  ) =>
    code.enabled?.value !== false &&
    model.enabled?.value !== false &&
    (code.editor.id === model.context.executor.editor.id ||
      links.value.some(
        (link) => link.code === code.id && link.model === model.id
      ))
  const execution = (endpoint: ModelingCorrespondenceEndpoint) => {
    if (endpoint.enabled?.value === false) return undefined
    const { executor, session } = endpoint.context
    const scene = session.resource.value
    const output = executor.output.value
    const model = scene?.selection.model.value
    if (
      !scene ||
      !model ||
      output.running ||
      output.errors['kcl.execution'] ||
      scene.runtime.executing.value ||
      scene.runtime.failed.value ||
      executor.editor.contents.value !== output.contents ||
      (executor.editor.src.value ?? '') !== output.src
    )
      return undefined
    const state = scene.runtime.state.value
    return {
      scene,
      model,
      state,
      output,
      sources: scene.runtime.sources?.value,
      query: createArtifactCorrespondence(state.artifactGraph),
    }
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
        for (const item of model.context.selection.items.value) {
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
        if (model.context.interactions.active.value) continue
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
        const selection = model.context.session.resource.peek()?.selection
        if (geometry && selection?.model.peek() === geometry.run.model)
          selection.setCorrespondence(
            geometry.entities.map((reference) => ({
              model: geometry.run.model,
              reference,
            }))
          )
        else selection?.setCorrespondence([])
      }
    })
  })
  const unlink = (id: symbol) => {
    links.value = links
      .peek()
      .filter((link) => link.code !== id && link.model !== id)
    targets.delete(id)
    for (const [code, model] of targets) if (model === id) targets.delete(code)
  }
  return {
    error: error as ReadonlySignal<Error | undefined>,
    registerCode: (endpoint: CodeCorrespondenceEndpoint) => {
      const registration = {
        ...endpoint,
        ranges: signal<readonly SourceRange[]>([]),
      }
      codes.value = [...codes.peek(), registration]
      return () => {
        codes.value = codes.peek().filter((item) => item !== registration)
        unlink(endpoint.id)
        endpoint.decorate([])
      }
    },
    registerModel: (endpoint: ModelingCorrespondenceEndpoint) => {
      models.value = [...models.peek(), endpoint]
      return () => {
        endpoint.context.session.resource
          .peek()
          ?.selection.setCorrespondence([])
        models.value = models.peek().filter((item) => item !== endpoint)
        unlink(endpoint.id)
      }
    },
    link: (code: symbol, model: symbol) => {
      if (
        !codes.peek().some((item) => item.id === code) ||
        !models.peek().some((item) => item.id === model)
      )
        return new Error('Both linked views must be registered.')
      const edge = { code, model }
      links.value = [...links.peek(), edge]
      return () => {
        links.value = links.peek().filter((item) => item !== edge)
      }
    },
    setPickingTarget: (code: symbol, model: symbol | undefined) => {
      const source = codes.peek().find((item) => item.id === code)
      const target = models.peek().find((item) => item.id === model)
      if (model === undefined) {
        targets.delete(code)
        return undefined
      }
      if (!source || !target || !linked(source, target))
        return new Error('The picking target must be a linked Modeling view.')
      targets.set(code, model)
      return undefined
    },
    /** Only intentional Code selections enter this path. Decoration updates cannot echo into picking. */
    selectCode: (id: symbol, ranges: readonly SourceRange[]) => {
      if (disposed) return
      const code = codes.peek().find((item) => item.id === id)
      if (!code) return
      code.ranges.value = ranges
      error.value = undefined
      const eligible = models.peek().filter((model) => linked(code, model))
      const explicit = targets.get(id)
      // One linked view is an unambiguous destination; multiple links require an explicit target, regardless of focus.
      const destination = explicit
        ? eligible.find((item) => item.id === explicit)
        : eligible.length === 1
          ? eligible[0]
          : undefined
      if (!destination) return
      const run = execution(destination)
      const argument = run?.scene.selection.pickingArgument.peek()
      if (!run || !argument || !run.scene.selection.pickingEnabled.peek())
        return
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
      error.value = run.scene.selection.offer(
        candidates.map((reference) => ({ reference, model: run.model }))
      )
    },
    invalidateCode: (id: symbol) => {
      const code = codes.peek().find((item) => item.id === id)
      if (code) code.ranges.value = []
    },
    // TODO: Add opt-in navigation independently of correspondence highlighting and selection promotion.
    // TODO: A feature-tree endpoint should offer direct entity candidates to the same execution-bound picking session.
    // TODO: Add a view-link/picking-destination UI; never resolve multiple destinations through global focus or open-dialog order.
    dispose: () => {
      if (disposed) return
      disposed = true
      generation++
      stop()
      for (const code of codes.peek()) code.decorate([])
      for (const model of models.peek())
        model.context.session.resource.peek()?.selection.setCorrespondence([])
      codes.value = []
      models.value = []
      links.value = []
      targets.clear()
    },
  }
}
export type CorrespondenceBridge = ReturnType<typeof createCorrespondenceBridge>
