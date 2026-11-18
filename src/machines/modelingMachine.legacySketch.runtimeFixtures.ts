import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createHash } from 'crypto'
import {
  emptyExecState,
  recast,
  type Artifact,
  type ExecState,
  type Program,
} from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { recordedSketchEngineResults } from '@src/machines/modelingMachine.legacySketch.engineResults'

/** A projection of a real execution's values and artifact relationships consumed by sketch editing. */
export interface RecordedSketchEngineResult {
  key: string
  code: string
  result: {
    variables: ExecState['variables']
    artifacts: Artifact[]
    defaultPlanes: ExecState['defaultPlanes']
  }
}

// Include source locations: parsing formatted and unformatted text must not reuse
// each other's source ranges, even when recast produces the same program text.
// A partial redraw also includes its surrounding bindings in the lookup key.
export function sketchEngineFixtureKey(
  ast: Node<Program>,
  context?: Node<Program>
): string {
  const request = createHash('sha256').update(JSON.stringify(ast)).digest('hex')
  return context
    ? createHash('sha256')
        .update(`${request}:${sketchEngineFixtureKey(context)}`)
        .digest('hex')
    : request
}

export function recordSketchEngineResult(
  ast: Node<Program>,
  state: ExecState,
  instance: ModuleType,
  context?: Node<Program>
): RecordedSketchEngineResult | Error {
  const code = recast(ast, instance)
  if (isErr(code)) return code
  return {
    key: sketchEngineFixtureKey(ast, context),
    code,
    result: {
      variables: state.variables,
      artifacts: [...state.artifactGraph.values()],
      defaultPlanes: state.defaultPlanes,
    },
  }
}

export function replaySketchEngineResult(
  fixture: RecordedSketchEngineResult
): ExecState {
  const result = structuredClone(fixture.result)
  return {
    ...emptyExecState(),
    variables: result.variables,
    artifactGraph: new Map(result.artifacts.map((a) => [a.id, a])),
    defaultPlanes: result.defaultPlanes,
  }
}

export function findSketchEngineResult(
  ast: Node<Program>,
  context?: Node<Program>
) {
  const key = sketchEngineFixtureKey(ast, context)
  const fixture = recordedSketchEngineResults.find((f) => f.key === key)
  if (!fixture) return new Error(`Unrecorded engine program: ${key}`)
  return fixture
}

/** Compare geometry and source relationships, independently of engine-assigned identifiers. */
export function sketchEngineResultContract(
  fixture: RecordedSketchEngineResult
): unknown {
  const reference = (artifact: Artifact) =>
    `${artifact.type}:${'codeRef' in artifact ? JSON.stringify(artifact.codeRef?.range) : ''}`
  const ids = new Map(fixture.result.artifacts.map((a) => [a.id, reference(a)]))
  const projection = {
    ...fixture.result,
    artifacts: [...fixture.result.artifacts].sort((a, b) =>
      reference(a).localeCompare(reference(b))
    ),
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const result: unknown = JSON.parse(
    JSON.stringify(projection, (key, value: unknown) => {
      if (key === 'objectId') return undefined
      if (typeof value === 'string' && uuid.test(value))
        return ids.get(value) ?? 'engine-id'
      return value
    })
  )
  return result
}
