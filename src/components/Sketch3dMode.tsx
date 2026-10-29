import { useSignals } from '@preact/signals-react/runtime'
import type {
  Segment3d,
  ApiSourceRef,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { SketchBlock } from '@rust/kcl-lib/bindings/SketchBlock'
import { undo, redo } from '@codemirror/commands'
import { toUtf16 } from '@src/lang/errors'
import { useSingletons } from '@src/lib/boot'
import { isErr } from '@src/lib/trap'
import { sketch3dEditRequest } from '@src/lib/sketch3dMode'
import {
  sampleSegment3d,
  sketch3dConstructor,
  sketch3dPlanes,
  sketch3dVariableMask,
  sketch3dConstraintStatement,
  sketch3dDeleteRanges,
  fitSketch3dView,
} from '@src/machines/sketchSolve/sketch3d'
import type {
  Position3d,
  Sketch3dTool,
} from '@src/machines/sketchSolve/sketch3d'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'

const inputClass =
  'border rounded px-2 py-1 bg-chalkboard-10 dark:bg-chalkboard-90 w-full'
const buttonClass =
  'border rounded px-2 py-1 enabled:hover:bg-primary/20 disabled:opacity-40'
const emptyPoints: Position3d[] = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 10, 0],
]
const emptySpatialSketches: ApiObject[] = []
const dimensionNames = [
  'distance',
  'horizontalDistance',
  'verticalDistance',
  'depthDistance',
  'radius',
  'diameter',
  'angle',
]
const constraintNames = [
  ...dimensionNames,
  'coincident',
  'fixed',
  'horizontal',
  'vertical',
  'depth',
  'equalLength',
  'equalRadius',
  'parallel',
  'perpendicular',
  'tangent',
  'midpoint',
  'symmetric',
]

function simpleRange(source: ApiSourceRef) {
  return source.type === 'Simple' && source.range[2] === 0 ? source.range : null
}

export function Sketch3dMode({
  disabled,
  onActiveChange,
}: {
  disabled: boolean
  onActiveChange: (active: boolean) => void
}) {
  useSignals()
  const { kclManager } = useSingletons()
  const [active, setActive] = useState(false)
  const [label, setLabel] = useState('')
  const [tool, setTool] = useState<Sketch3dTool>('line')
  const [drawing, setDrawing] = useState(false)
  const [plane, setPlane] = useState<keyof typeof sketch3dPlanes>('XY')
  const [offset, setOffset] = useState(0)
  const [points, setPoints] = useState<Position3d[]>(emptyPoints)
  const [clicks, setClicks] = useState<Position3d[]>([])
  const [construction, setConstruction] = useState(false)
  const [normal, setNormal] = useState<Position3d>([0, 0, 1])
  const [clockwise, setClockwise] = useState(false)
  const [editing, setEditing] = useState<Segment3d | null>(null)
  const [variableMask, setVariableMask] = useState<boolean[][] | undefined>()
  const [selected, setSelected] = useState<string[]>([])
  const [constraint, setConstraint] = useState('distance')
  const [dimension, setDimension] = useState('10')
  const [message, setMessage] = useState('')
  const hasFramed = useRef(false)
  const code = kclManager.code
  const blocks: { label: string; block: Node<SketchBlock> }[] = []
  for (const item of kclManager.ast.body) {
    if (
      item.type === 'VariableDeclaration' &&
      item.declaration.init.type === 'SketchBlock' &&
      item.declaration.init.spatial
    ) {
      blocks.push({
        label: item.declaration.id.name,
        block: item.declaration.init,
      })
    }
  }
  const current = blocks.find((b) => b.label === label)
  const firstLabel = blocks[0]?.label ?? ''
  const objects = kclManager.execState.spatialSketches ?? emptySpatialSketches
  const object = objects.find((o) => o.label === label && simpleRange(o.source))
  const sketch = object?.kind.type === 'Sketch3d' ? object.kind : null
  const busy = disabled || kclManager.isExecuting
  const editRequest = sketch3dEditRequest.value

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawing(false)
        setClicks([])
        setEditing(null)
        event.preventDefault()
        event.stopPropagation()
      } else if (
        !event.ctrlKey &&
        !event.metaKey &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement) &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest('.cm-editor')
        )
      ) {
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])
  useEffect(() => () => onActiveChange(false), [onActiveChange])
  useEffect(() => {
    setActive(false)
    setLabel('')
    setSelected([])
    setClicks([])
    setEditing(null)
    hasFramed.current = false
  }, [kclManager.id, kclManager.path])
  useEffect(() => {
    if (editRequest?.editor !== kclManager || busy) return
    setLabel(editRequest.label || firstLabel)
    setActive(true)
    setSelected([])
    setEditing(null)
    sketch3dEditRequest.value = null
  }, [editRequest, kclManager, busy, firstLabel])

  const isExecuting = kclManager.isExecuting
  useEffect(() => {
    const segments = objects.flatMap((o) =>
      o.kind.type === 'Sketch3d' ? o.kind.segments : []
    )
    if (!segments.length) {
      hasFramed.current = false
      return
    }
    if (isExecuting || hasFramed.current) return
    hasFramed.current = fitSketch3dView(
      segments,
      kclManager.sceneInfra.camControls
    )
  }, [objects, kclManager, isExecuting])

  useEffect(() => {
    if (
      !active &&
      !objects.some((o) => o.kind.type === 'Sketch3d' && o.kind.segments.length)
    )
      return
    return kclManager.sceneInfra.retainRendering()
  }, [objects, kclManager, active])

  // World-space sketches render alongside the engine scene, also after leaving sketch mode.
  useEffect(() => {
    const scene = kclManager.sceneInfra
    const group = new Group()
    group.name = 'sketch3d'
    const scale = () => group.scale.setScalar(1 / scene.baseUnitMultiplier)
    scale()
    scene.baseUnitChange.add(scale)
    for (const object of objects) {
      if (object.kind.type !== 'Sketch3d') continue
      for (const segment of object.kind.segments) {
        const geometry = new BufferGeometry().setFromPoints(
          sampleSegment3d(segment)
        )
        const color =
          selected.includes(segment.label) && active && object.label === label
            ? 0xffcc44
            : segment.construction
              ? 0x999999
              : 0xab6dff
        const shape =
          segment.kind === 'point'
            ? new Points(
                geometry,
                new PointsMaterial({
                  color,
                  size: 7,
                  sizeAttenuation: false,
                  depthTest: false,
                })
              )
            : new Line(
                geometry,
                new LineBasicMaterial({ color, depthTest: false })
              )
        shape.renderOrder = 10
        group.add(shape)
        if (active && object.label === label && segment.kind !== 'point') {
          const handles = new Points(
            new BufferGeometry().setFromPoints(
              segment.points.map((p) => new Vector3(...p))
            ),
            new PointsMaterial({
              color: 0xffcc44,
              size: 6,
              sizeAttenuation: false,
              depthTest: false,
            })
          )
          handles.renderOrder = 11
          group.add(handles)
        }
      }
    }
    if (active && clicks.length) {
      group.add(
        new Points(
          new BufferGeometry().setFromPoints(
            clicks.map((p) => new Vector3(...p))
          ),
          new PointsMaterial({
            color: 0xffcc44,
            size: 9,
            sizeAttenuation: false,
            depthTest: false,
          })
        )
      )
    }
    scene.scene.add(group)
    return () => {
      scene.scene.remove(group)
      scene.baseUnitChange.remove(scale)
      for (const shape of group.children) {
        if (shape instanceof Line || shape instanceof Points) {
          shape.geometry.dispose()
          shape.material.dispose()
        }
      }
    }
  }, [objects, kclManager, active, label, clicks, selected])

  function update(next: string) {
    if (busy || kclManager.code !== code) {
      setMessage('Wait for the current edit to finish.')
      return
    }
    kclManager.updateCodeEditor(next, {
      shouldExecute: true,
      shouldSyncRust: true,
      shouldWriteToDisk: true,
      shouldAddToHistory: true,
      shouldResetCamera: false,
    })
    setMessage('')
  }
  function append(statement: string) {
    if (!current) {
      setMessage('Select or create a 3D sketch.')
      return
    }
    const end = toUtf16(current.block.end, code) - 1
    if (code[end] !== '}') {
      setMessage('The sketch changed. Wait for it to finish rendering.')
      return
    }
    update(`${code.slice(0, end)}  ${statement}\n${code.slice(end)}`)
  }
  function createSketch() {
    let n = 1
    while (
      blocks.some((b) => b.label === `sketch3d${n}`) ||
      new RegExp(`\\bsketch3d${n}\\b`).test(code)
    )
      n++
    const nextLabel = `sketch3d${n}`
    const settings = code.trim()
      ? ''
      : '@settings(kclVersion = 3.0, experimentalFeatures = allow)\n'
    update(`${settings}${code}\n${nextLabel} = sketch3d() {\n}\n`)
    setLabel(nextLabel)
    setActive(true)
  }
  function addGeometry(drawn?: Position3d[]) {
    const count = tool === 'point' ? 1 : tool === 'arc' ? 3 : 2
    const constructor = sketch3dConstructor(
      tool,
      drawn ?? points.slice(0, count),
      normal,
      construction,
      clockwise,
      editing ? variableMask : undefined
    )
    if (isErr(constructor)) {
      setMessage(constructor.message)
      return
    }
    if (editing) {
      const range = simpleRange(editing.source)
      if (!range) {
        setMessage('Edit imported geometry in its source file.')
        return
      }
      update(
        code.slice(0, toUtf16(range[0], code)) +
          constructor +
          code.slice(toUtf16(range[1], code))
      )
      setEditing(null)
    } else {
      let n = 1
      while (new RegExp(`\\b${tool}${n}\\b`).test(code)) n++
      append(`${tool}${n} = ${constructor}`)
    }
    setClicks([])
  }
  useEffect(() => {
    if (!active || busy || !current) return
    const scene = kclManager.sceneInfra
    let down: [number, number] | null = null
    const inViewport = (event: MouseEvent) => {
      const target = event.target
      if (
        !(target instanceof HTMLElement) ||
        target.closest(
          'button,input,select,textarea,[role="dialog"],.cm-editor'
        )
      )
        return false
      const rect = scene.renderer.domElement.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
    }
    const onDown = (event: MouseEvent) => {
      if (event.button === 0 && inViewport(event))
        down = [event.clientX, event.clientY]
    }
    const onUp = (event: MouseEvent) => {
      if (!down || event.button !== 0 || !inViewport(event)) return
      const movement = Math.hypot(
        event.clientX - down[0],
        event.clientY - down[1]
      )
      down = null
      if (movement > 4) return
      const rect = scene.renderer.domElement.getBoundingClientRect()
      if (!drawing) {
        const screenPoint = (p: Vector3) => {
          const projected = p.clone().project(scene.camControls.camera)
          return new Vector2(
            rect.left + ((projected.x + 1) * rect.width) / 2,
            rect.top + ((1 - projected.y) * rect.height) / 2
          )
        }
        const mouse = new Vector2(event.clientX, event.clientY)
        let best = 9
        let ref: string | null = null
        for (const segment of sketch?.segments ?? []) {
          const names =
            segment.kind === 'point'
              ? [segment.label]
              : segment.kind === 'line'
                ? [`${segment.label}.start`, `${segment.label}.end`]
                : segment.kind === 'arc'
                  ? [
                      `${segment.label}.start`,
                      `${segment.label}.end`,
                      `${segment.label}.center`,
                    ]
                  : [`${segment.label}.start`, `${segment.label}.center`]
          segment.points.forEach((p, i) => {
            const distance = screenPoint(new Vector3(...p)).distanceTo(mouse)
            if (distance < best) {
              best = distance
              ref = names[i]
            }
          })
        }
        if (!ref)
          for (const segment of sketch?.segments ?? []) {
            const samples = sampleSegment3d(segment).map(screenPoint)
            for (let i = 1; i < samples.length; i++) {
              const a = samples[i - 1]
              const b = samples[i]
              const delta = b.clone().sub(a)
              const t = Math.max(
                0,
                Math.min(
                  1,
                  mouse.clone().sub(a).dot(delta) /
                    Math.max(delta.lengthSq(), 1e-12)
                )
              )
              const distance = a
                .clone()
                .addScaledVector(delta, t)
                .distanceTo(mouse)
              if (distance < best) {
                best = distance
                ref = segment.label
              }
            }
          }
        if (ref) {
          const hitRef: string = ref
          setSelected((previous) =>
            previous.includes(hitRef)
              ? previous.filter((r) => r !== hitRef)
              : [...previous, hitRef]
          )
        }
        return
      }
      const ray = new Raycaster()
      ray.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        ),
        scene.camControls.camera
      )
      const normal = new Vector3(...sketch3dPlanes[plane].normal)
      const origin = new Vector3().setComponent(
        sketch3dPlanes[plane].axis,
        offset
      )
      const hit = ray.ray.intersectPlane(
        new Plane().setFromNormalAndCoplanarPoint(normal, origin),
        new Vector3()
      )
      if (!hit) {
        setMessage('Rotate the view to face the drawing plane.')
        return
      }
      const next = [
        ...clicks,
        hit.toArray().map((n) => Math.round(n * 1000) / 1000) as Position3d,
      ]
      const count = tool === 'point' ? 1 : tool === 'arc' ? 3 : 2
      if (next.length === count) addGeometry(next)
      else setClicks(next)
    }
    const onClick = (event: MouseEvent) => {
      if (inViewport(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('click', onClick, true)
    }
  })

  function addConstraint() {
    const statement = sketch3dConstraintStatement(
      constraint,
      selected,
      sketch?.segments ?? [],
      Number(dimension)
    )
    if (isErr(statement)) {
      setMessage(statement.message)
      return
    }
    append(statement)
  }
  function edit(segment: Segment3d) {
    const declaration = current?.block.body.items.find(
      (item) =>
        item.type === 'VariableDeclaration' &&
        item.declaration.id.name === segment.label
    )
    if (
      declaration?.type !== 'VariableDeclaration' ||
      declaration.declaration.init.type !== 'CallExpressionKw'
    ) {
      setMessage('Edit this geometry in the code editor.')
      return
    }
    const mask = sketch3dVariableMask(
      declaration.declaration.init,
      segment.kind as Sketch3dTool
    )
    if (isErr(mask)) {
      setMessage(mask.message)
      return
    }
    setVariableMask(mask)
    setEditing(segment)
    setDrawing(false)
    setTool(segment.kind as Sketch3dTool)
    const p = segment.points as Position3d[]
    setPoints(
      segment.kind === 'arc'
        ? [p[2], p[0], p[1]]
        : segment.kind === 'circle'
          ? [p[1], p[0], emptyPoints[2]]
          : [...p, ...emptyPoints].slice(0, 3)
    )
    setConstruction(segment.construction)
    setClockwise(segment.clockwise)
    if (segment.normal) setNormal(segment.normal)
  }
  function deleteSelected() {
    if (!current || !sketch) return
    const labels = selected
      .map((ref) => ref.split('.')[0])
      .filter((ref) => sketch.segments.some((s) => s.label === ref))
    if (!labels.length) {
      setMessage('Select geometry to delete.')
      return
    }
    const ranges = sketch3dDeleteRanges(current.block, labels).sort(
      (a, b) => b[0] - a[0]
    )
    let next = code
    for (const [start, end] of ranges)
      next =
        next.slice(0, toUtf16(start, code)) + next.slice(toUtf16(end, code))
    update(next)
    setSelected([])
    setEditing(null)
    setDrawing(false)
    setClicks([])
  }
  const count = tool === 'point' ? 1 : tool === 'arc' ? 3 : 2
  const labels =
    tool === 'point'
      ? ['Position']
      : tool === 'line'
        ? ['Start', 'End']
        : tool === 'arc'
          ? ['Center', 'Start', 'End']
          : ['Center', 'Start']
  const pointRefs = [
    'ORIGIN',
    ...(sketch?.segments.flatMap((s) => [
      s.label,
      ...(s.kind === 'point'
        ? []
        : [
            `${s.label}.start`,
            ...(s.kind === 'line' || s.kind === 'arc'
              ? [`${s.label}.end`]
              : []),
            ...(s.kind === 'circle' || s.kind === 'arc'
              ? [`${s.label}.center`]
              : []),
          ]),
    ]) ?? []),
  ]
  return (
    <>
      {active &&
        createPortal(
          <section
            role="dialog"
            aria-label="3D sketch mode"
            className="absolute right-3 top-20 z-30 w-80 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-6rem)] overflow-auto border rounded bg-chalkboard-10 dark:bg-chalkboard-90 p-3 shadow-lg text-sm space-y-3"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between">
              <strong>3D sketch</strong>
              <button
                className={buttonClass}
                onClick={() => {
                  setActive(false)
                  setDrawing(false)
                  setClicks([])
                }}
              >
                Finish sketch
              </button>
            </div>
            <div className="flex gap-2">
              <select
                aria-label="3D sketch"
                className={inputClass}
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value)
                  setSelected([])
                  setEditing(null)
                }}
              >
                <option value="">Select sketch</option>
                {blocks.map((b) => (
                  <option key={b.label}>{b.label}</option>
                ))}
              </select>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={createSketch}
              >
                New
              </button>
            </div>
            {sketch && (
              <p>
                {sketch.degrees_of_freedom === 0
                  ? 'Fully constrained'
                  : `${sketch.degrees_of_freedom} degrees of freedom`}
              </p>
            )}
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={kclManager.isExecuting}
                onClick={() => undo(kclManager.editorView)}
              >
                Undo
              </button>
              <button
                className={buttonClass}
                disabled={kclManager.isExecuting}
                onClick={() => redo(kclManager.editorView)}
              >
                Redo
              </button>
              <button
                className={buttonClass}
                disabled={busy || !sketch?.segments.length}
                onClick={() => {
                  if (sketch)
                    fitSketch3dView(
                      sketch.segments,
                      kclManager.sceneInfra.camControls
                    )
                }}
              >
                Fit sketch
              </button>
            </div>
            <label className="block">
              Tool
              <select
                aria-label="3D geometry tool"
                className={inputClass}
                value={tool}
                onChange={(e) => {
                  setTool(e.target.value as Sketch3dTool)
                  setClicks([])
                  setEditing(null)
                }}
              >
                {(['point', 'line', 'arc', 'circle'] as const).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <label>
                Drawing plane
                <select
                  className={inputClass}
                  value={plane}
                  onChange={(e) => {
                    setPlane(e.target.value as typeof plane)
                    setNormal([
                      ...sketch3dPlanes[
                        e.target.value as keyof typeof sketch3dPlanes
                      ].normal,
                    ])
                    setClicks([])
                  }}
                >
                  {Object.keys(sketch3dPlanes).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Offset (mm)
                <input
                  className={inputClass}
                  type="number"
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                />
              </label>
            </div>
            {points.slice(0, count).map((p, i) => (
              <fieldset key={labels[i]}>
                <legend>{labels[i]} (mm)</legend>
                <div className="flex gap-1">
                  {p.map((n, axis) => (
                    <input
                      key={axis}
                      aria-label={`${labels[i]} ${'XYZ'[axis]}`}
                      className={inputClass}
                      type="number"
                      value={n}
                      onChange={(e) =>
                        setPoints(
                          points.map((p, j) =>
                            j === i
                              ? (p.map((v, k) =>
                                  k === axis ? Number(e.target.value) : v
                                ) as Position3d)
                              : p
                          )
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            {(tool === 'arc' || tool === 'circle') && (
              <fieldset>
                <legend>Plane normal</legend>
                <div className="flex gap-1">
                  {normal.map((n, i) => (
                    <input
                      key={i}
                      className={inputClass}
                      aria-label={`Normal ${'XYZ'[i]}`}
                      type="number"
                      value={n}
                      onChange={(e) =>
                        setNormal(
                          normal.map((v, j) =>
                            j === i ? Number(e.target.value) : v
                          ) as Position3d
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
            {tool === 'arc' && (
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={clockwise}
                  onChange={(e) => setClockwise(e.target.checked)}
                />
                Clockwise arc
              </label>
            )}
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={construction}
                onChange={(e) => setConstruction(e.target.checked)}
              />
              Construction geometry
            </label>
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={busy || !current}
                onClick={() => addGeometry()}
              >
                {editing ? 'Update geometry' : 'Add geometry'}
              </button>
              <button
                className={buttonClass}
                aria-pressed={drawing}
                disabled={busy || !current}
                onClick={() => {
                  setDrawing(!drawing)
                  setEditing(null)
                  setClicks([])
                }}
              >
                {drawing ? 'Stop drawing' : 'Draw in view'}
              </button>
            </div>
            {drawing && (
              <p>
                Click {labels[clicks.length]?.toLowerCase()} on {plane}. Orbit
                to change the view.
              </p>
            )}
            <fieldset>
              <legend>Geometry and points</legend>
              {pointRefs.map((ref) => (
                <label key={ref} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(ref)}
                    onChange={() =>
                      setSelected((previous) =>
                        previous.includes(ref)
                          ? previous.filter((v) => v !== ref)
                          : [...previous, ref]
                      )
                    }
                  />
                  {ref}
                </label>
              ))}
            </fieldset>
            <button
              className={buttonClass}
              disabled={busy || !current}
              title="Also removes dependent statements"
              onClick={deleteSelected}
            >
              Delete selected
            </button>
            {sketch?.segments.map((s, i) => (
              <button
                key={i}
                className={`${buttonClass} mr-1`}
                disabled={busy}
                onClick={() => edit(s)}
              >
                Edit {s.label}
              </button>
            ))}
            <label className="block">
              Constraint
              <select
                className={inputClass}
                value={constraint}
                onChange={(e) => setConstraint(e.target.value)}
              >
                {constraintNames.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {dimensionNames.includes(constraint) && (
              <label className="block">
                Value ({constraint === 'angle' ? 'degrees' : 'mm'})
                <input
                  className={inputClass}
                  type="number"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                />
              </label>
            )}
            <button
              className={buttonClass}
              disabled={busy || !current}
              onClick={addConstraint}
            >
              Apply constraint
            </button>
            <ul>
              {sketch?.constraints.map((c, i) => (
                <li key={i} className="flex justify-between">
                  {c.kind}
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => {
                      const r = simpleRange(c.source)
                      if (r)
                        update(
                          code.slice(0, toUtf16(r[0], code)) +
                            code.slice(toUtf16(r[1], code))
                        )
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {message && <p role="alert">{message}</p>}
          </section>,
          kclManager.sceneInfra.renderer.domElement.parentElement
            ?.parentElement ?? document.body
        )}
    </>
  )
}
