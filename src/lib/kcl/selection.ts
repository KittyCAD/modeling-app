import type { ModelingTarget } from '@src/lib/kcl/modelingTarget'
import { currentModel } from '@src/lib/kcl/modelingTarget'
import type { KclModelSnapshot } from '@src/lib/kcl/stdlibExtrude'
import type { CommandArgument } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { parse, resultIsOk } from '@src/lang/wasm'
import { resolveToCodeRef } from '@src/lang/queryAst'
import {
  getEngineRegionSelectionFromPoint,
  normalizeEntityReference,
  getSelectionCountByType,
  canSubmitSelectionArg,
} from '@src/lib/selections'
import { isModelingResponse } from '@src/lib/kcSdkGuards'

/** A collector owns only its listeners; both palette and Form mode use the same viewer lookup. */
export function watchViewerSelection({
  target,
  snapshot,
  wasm,
  arg,
  onSelect,
  onError,
}: {
  target: ModelingTarget
  snapshot: KclModelSnapshot
  wasm: ModuleType
  arg: Extract<CommandArgument<unknown>, { inputType: 'selection' }>
  onSelect: (selection: Selections, add: boolean) => void
  onError: (message: string) => void
}) {
  let active = true
  let queue = Promise.resolve()
  const click = (event: MouseEvent) => {
    const video = target.session.element.querySelector('video')
    if (!video || !video.contains(event.target as Node)) return
    const rect = video.getBoundingClientRect()
    queue = queue
      .then(async () => {
        if (!active || currentModel(target) !== snapshot) return
        const result = await target.session.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: crypto.randomUUID(),
          cmd: {
            type: 'query_entity_type_with_point',
            selected_at_window: {
              x: ((event.clientX - rect.left) / rect.width) * video.videoWidth,
              y: ((event.clientY - rect.top) / rect.height) * video.videoHeight,
            },
            selection_type: 'add',
          },
        })
        if (
          !isModelingResponse(result) ||
          result.resp.data.modeling_response.type !==
            'query_entity_type_with_point'
        )
          return
        const reference = normalizeEntityReference(
          result.resp.data.modeling_response.data.reference
        )
        if (!reference)
          return Promise.reject(new Error('Select geometry in this model'))
        let next: Selections
        if (reference.type === 'region') {
          const parsed = parse(snapshot.contents, wasm)
          if (parsed instanceof Error || !resultIsOk(parsed)) return
          const region = await getEngineRegionSelectionFromPoint(
            reference.region_id,
            snapshot.execState.artifactGraph,
            parsed.program,
            target.session,
            wasm
          )
          if (!region)
            return Promise.reject(
              new Error('Unable to resolve the selected region')
            )
          next = { graphSelections: [], otherSelections: [region] }
        } else {
          const resolved = resolveToCodeRef(
            { entityRef: reference },
            snapshot.execState.artifactGraph
          )
          if (!resolved)
            return Promise.reject(
              new Error('The selected geometry has no editable source')
            )
          next = {
            graphSelections: [{ ...resolved, entityRef: reference }],
            otherSelections: [],
          }
        }
        const parsed = parse(snapshot.contents, wasm)
        if (parsed instanceof Error || !resultIsOk(parsed)) return
        const counts = getSelectionCountByType(
          parsed.program,
          next,
          snapshot.execState.artifactGraph
        )
        if (!canSubmitSelectionArg(counts, arg, next))
          return Promise.reject(
            new Error('This argument does not accept that geometry')
          )
        if (!active || currentModel(target) !== snapshot) return
        onSelect(next, arg.multiple && event.shiftKey)
      })
      .catch((cause: unknown) => {
        if (active)
          onError(
            cause instanceof Error ? cause.message : 'Unable to select geometry'
          )
      })
  }
  target.session.element.addEventListener('click', click)
  return () => {
    active = false
    target.session.element.removeEventListener('click', click)
  }
}
