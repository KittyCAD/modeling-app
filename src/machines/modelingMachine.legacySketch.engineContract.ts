import type { Artifact, ExecState } from '@src/lang/wasm'

/** Compare geometry and source relationships, independently of engine-assigned identifiers. */
export function sketchEngineResultContract(fixture: {
  result: {
    variables: ExecState['variables']
    artifacts: Artifact[]
    defaultPlanes: ExecState['defaultPlanes']
  }
}): unknown {
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
