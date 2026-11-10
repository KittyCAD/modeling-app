import { useSignals } from '@preact/signals-react/runtime'
import {
  fieldText,
  resolveArguments,
} from '@src/components/ModelingDialog/arguments'
import type { KclManager } from '@src/lang/KclManager'
import { runModelingCodemod } from '@src/lang/modifyAst/modelingCodemod'
import { useApp } from '@src/lib/boot'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { literalDistance } from '@src/lib/modelingPreview/distance'
import { createPreviewExecutor } from '@src/lib/modelingPreview/executor'
import { PreviewQueue } from '@src/lib/modelingPreview/queue'
import { isEngineRegionSelection, isSelections } from '@src/lib/selections'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

type PreviewResult = { files: ModelingAppFile[]; distance: string }

export function ExtrudePreview({
  kcl,
  context,
  draft,
  save,
  containerRef,
}: {
  kcl: KclManager
  context: CommandBarContext
  draft: Record<string, unknown>
  save: (name: string, value: unknown) => void
  containerRef: RefObject<HTMLElement | null>
}) {
  useSignals()
  const app = useApp()
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState('')
  const [invocation] = useState(() => context)
  const queue = useRef<
    PreviewQueue<Record<string, unknown>, PreviewResult> | undefined
  >(undefined)
  const [baseline] = useState(() => ({
    ast: structuredClone(kcl.ast),
    code: kcl.code,
    path: kcl.path,
    generation: kcl.engineSceneGenerationSignal.peek(),
  }))
  const source = kcl.codeSignal.value
  const engineSession = kcl.engineCommandManager.engineSessionId
  const generation = kcl.engineSceneGenerationSignal.value
  const executing = kcl.isExecutingSignal.value
  const validBaseline =
    source === baseline.code &&
    kcl.path === baseline.path &&
    generation === baseline.generation &&
    !executing
  const token = app.auth.actor.getSnapshot().context.token
  const renderer = kcl.sceneInfra.localRenderer
  const draftKey = JSON.stringify(draft)
  const sketches = draft.sketches
  const selection = isSelections(sketches) ? sketches : undefined
  const region = selection?.otherSelections.find(isEngineRegionSelection)
  const reference = selection?.graphSelections[0]?.entityRef
  const regionId =
    region?.id ??
    (reference?.type === 'region' ? reference.region_id : undefined)
  const count = selection
    ? selection.graphSelections.length + selection.otherSelections.length
    : 0
  const frame = regionId && renderer?.getExtrudeFrame(regionId)
  const supported =
    count === 1 &&
    !!frame &&
    !context.argumentsToSubmit.nodeToEdit &&
    !baseline.ast.body.some((statement) => statement.type === 'ImportStatement')
  const distance = literalDistance(
    fieldText(draft.length),
    kcl.fileSettings.defaultLengthUnit ?? 'mm'
  )

  useEffect(() => {
    if (!enabled || !renderer || !token || !validBaseline) return
    const abort = new AbortController()
    const executor = createPreviewExecutor(kcl, token, abort.signal)
    // The queue awaits the same promise; observe early connection failures too.
    void executor.catch(() => {})
    const current = () =>
      !abort.signal.aborted &&
      kcl.code === baseline.code &&
      kcl.path === baseline.path &&
      kcl.engineSceneGenerationSignal.peek() === baseline.generation &&
      !kcl.isExecuting &&
      kcl.engineCommandManager.engineSessionId === engineSession
    const pending = new PreviewQueue<Record<string, unknown>, PreviewResult>(
      async (values) => {
        if (!current())
          return Promise.reject(
            new Error('The model changed. Reopen Extrude to preview.')
          )
        const args = await resolveArguments(
          invocation,
          values,
          kcl.rustContext,
          baseline.ast,
          kcl.artifactGraph
        )
        if (isErr(args)) return Promise.reject(args)
        if (!isSelections(args.sketches) || !isKclCommandValue(args.length))
          return Promise.reject(
            new Error('Select one region and enter a distance.')
          )
        if (
          args.method !== 'NEW' ||
          (args.bodyType !== undefined && args.bodyType !== 'SOLID') ||
          [
            'to',
            'direction',
            'bidirectionalLength',
            'twistAngle',
            'twistAngleStep',
            'twistCenter',
            'draftAngle',
            'tagStart',
            'tagEnd',
          ].some((key) => args[key] !== undefined && args[key] !== '') ||
          args.symmetric === true
        )
          return Promise.reject(
            new Error('Preview supports a new solid with one distance.')
          )
        const wasm = await kcl.wasmInstancePromise
        const result = await runModelingCodemod({
          codemod: modelingCommandCodemods.Extrude,
          commandArgs: {
            sketches: args.sketches,
            length: args.length,
            method: 'NEW',
            bodyType: 'SOLID',
          },
          kclManager: kcl,
          wasmInstance: wasm,
          sourceSnapshot: baseline,
        })
        if (isErr(result)) return Promise.reject(result)
        if (!current()) return Promise.reject(new Error('Preview cancelled.'))
        return {
          files: await (await executor).render(
            JSON.stringify(result.modifiedAst)
          ),
          distance: fieldText(values.length),
        }
      },
      async ({ files, distance }, isCurrent) => {
        const file = files.find((file) => file.name.endsWith('.glb'))
        if (!file)
          return Promise.reject(new Error('No preview geometry was returned.'))
        await renderer.showOperationPreview(
          new Uint8Array(file.contents),
          () => current() && isCurrent()
        )
        if (current() && isCurrent()) setStatus(`Preview (${distance})`)
      },
      (error) => {
        if (!current()) return
        renderer.clearOperationPreview()
        setStatus(error instanceof Error ? error.message : String(error))
      }
    )
    queue.current = pending
    return () => {
      queue.current = undefined
      pending.close()
      abort.abort()
      renderer.clearOperationPreview()
      void executor.then(
        (executor) => executor.dispose(),
        () => {}
      )
    }
  }, [
    enabled,
    renderer,
    token,
    kcl,
    source,
    engineSession,
    generation,
    executing,
    invocation,
    baseline,
    validBaseline,
  ])

  useEffect(() => {
    const pending = queue.current
    if (!pending) return
    pending.invalidate()
    if (!supported) {
      renderer?.clearOperationPreview()
      setStatus('Select one closed region to preview.')
      return
    }
    setStatus('Updating preview...')
    pending.update(JSON.parse(draftKey))
  }, [draftKey, enabled, supported, renderer, source])

  if (!IS_STAGING_OR_DEBUG || !renderer || context.argumentsToSubmit.nodeToEdit)
    return null
  return (
    <div className="flex flex-col gap-1 border-t border-chalkboard-30 pt-2">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!enabled && (!supported || !validBaseline)}
          onChange={(event) => {
            if (event.target.checked) {
              save('method', 'NEW')
              save('bodyType', 'SOLID')
            }
            setEnabled(event.target.checked)
          }}
        />
        Live preview (experimental)
      </label>
      {enabled && (
        <output aria-live="polite">
          {!validBaseline
            ? 'The model changed. Reopen Extrude to preview.'
            : status}
        </output>
      )}
      {enabled &&
        validBaseline &&
        frame &&
        distance &&
        !(
          isKclCommandValue(draft.length) && 'variableName' in draft.length
        ) && (
          <DistanceHandle
            kcl={kcl}
            frame={frame}
            distance={distance}
            containerRef={containerRef}
            onChange={(millimeters) =>
              save(
                'length',
                `${Number((millimeters / distance.scale).toPrecision(8))}${distance.unit}`
              )
            }
          />
        )}
    </div>
  )
}

function DistanceHandle({
  kcl,
  frame,
  distance,
  containerRef,
  onChange,
}: {
  kcl: KclManager
  frame: { origin: Vector3; normal: Vector3 }
  distance: NonNullable<ReturnType<typeof literalDistance>>
  containerRef: RefObject<HTMLElement | null>
  onChange: (millimeters: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const drag = useRef<
    | { pointerId: number; plane: Plane; start: number; distance: number }
    | undefined
  >(undefined)
  const controls = kcl.sceneInfra.camControls
  const intersect = (x: number, y: number, plane: Plane) => {
    const rect = controls.domElement.getBoundingClientRect()
    const ray = new Raycaster()
    ray.setFromCamera(
      new Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        (-(y - rect.top) / rect.height) * 2 + 1
      ),
      controls.camera
    )
    return ray.ray.intersectPlane(plane, new Vector3())
  }
  useEffect(() => {
    let request = 0
    const position = () => {
      const button = ref.current
      const parent = containerRef.current
      if (button && parent) {
        const rect = controls.domElement.getBoundingClientRect()
        const bounds = parent.getBoundingClientRect()
        const point = frame.origin
          .clone()
          .addScaledVector(frame.normal, distance.millimeters)
          .project(controls.camera)
        button.style.left = `${rect.left - bounds.left + ((point.x + 1) * rect.width) / 2}px`
        button.style.top = `${rect.top - bounds.top + ((1 - point.y) * rect.height) / 2}px`
        button.style.visibility = Math.abs(point.z) <= 1 ? 'visible' : 'hidden'
      }
      request = requestAnimationFrame(position)
    }
    position()
    return () => cancelAnimationFrame(request)
  }, [controls, frame, distance.millimeters, containerRef])
  const parent = containerRef.current
  return (
    parent &&
    createPortal(
      <button
        ref={ref}
        type="button"
        aria-label="Drag extrusion distance"
        className="absolute z-50 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border border-primary bg-primary px-3 py-1 text-xs text-white"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          const direction = controls.camera.getWorldDirection(new Vector3())
          direction.addScaledVector(frame.normal, -direction.dot(frame.normal))
          if (direction.lengthSq() < 1e-8) return
          const plane = new Plane().setFromNormalAndCoplanarPoint(
            direction.normalize(),
            frame.origin
          )
          const point = intersect(event.clientX, event.clientY, plane)
          if (!point) return
          drag.current = {
            pointerId: event.pointerId,
            plane,
            start: point.sub(frame.origin).dot(frame.normal),
            distance: distance.millimeters,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const active = drag.current
          if (!active || event.pointerId !== active.pointerId) return
          event.stopPropagation()
          const point = intersect(event.clientX, event.clientY, active.plane)
          if (point)
            onChange(
              active.distance +
                point.sub(frame.origin).dot(frame.normal) -
                active.start
            )
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          drag.current = undefined
        }}
        onPointerCancel={() => {
          drag.current = undefined
        }}
        onLostPointerCapture={() => {
          drag.current = undefined
        }}
      >
        {Number((distance.millimeters / distance.scale).toPrecision(5))}
        {distance.unit} ↕
      </button>,
      parent
    )
  )
}
