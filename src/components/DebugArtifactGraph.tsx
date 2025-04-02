import { useMemo } from 'react'

import type { GenericObj } from '@src/components/DebugDisplayObj'
import { DebugDisplayArray } from '@src/components/DebugDisplayObj'
import type { PlaneArtifactRich } from '@src/lang/std/artifactGraph'
import { expandPlane } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { kclManager } from '@src/lib/singletons'

export function DebugArtifactGraph() {
  const artifactGraphTree = useMemo(() => {
    return computeTree(kclManager.artifactGraph)
  }, [kclManager.artifactGraph])

  const filterKeys: string[] = ['codeRef', 'pathToNode']
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
