import { useMemo } from 'react'
import { engineCommandManager } from 'lib/singletons'
import { expandPlane, PlaneArtifactRich } from 'lang/std/artifactGraph'
import { ArtifactGraph } from 'lang/wasm'
import { DebugDisplayArray, GenericObj } from './DebugDisplayObj'

export function DebugArtifactGraph() {
  const artifactGraphTree = useMemo(() => {
    return computeTree(engineCommandManager.artifactGraph)
  }, [engineCommandManager.artifactGraph])

  const filterKeys: string[] = ['__meta', 'codeRef', 'pathToNode']
  return (
    <details data-testid="debug-feature-tree" className="relative">
      <summary>Artifact Graph</summary>
      {artifactGraphTree.length > 0 ? (
        <pre className="text-xs">
          <DebugDisplayArray arr={artifactGraphTree} filterKeys={filterKeys} />
        </pre>
      ) : (
        <p>(Empty)</p>
      )}
    </details>
  )
}

function computeTree(artifactGraph: ArtifactGraph): GenericObj[] {
  let items: GenericObj[] = []

  const planes: PlaneArtifactRich[] = []
  for (const artifact of artifactGraph.values()) {
    if (artifact.type === 'plane') {
      planes.push(expandPlane(artifact, artifactGraph))
    }
  }
  const extraRichPlanes: GenericObj[] = planes.map((plane) => {
    return plane as any as GenericObj
  })
  items = items.concat(extraRichPlanes)

  return items
}
