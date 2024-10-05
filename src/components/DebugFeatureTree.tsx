import { useMemo } from 'react'
import { engineCommandManager } from 'lib/singletons'
import {
  ArtifactGraph,
  expandPlane,
  PlaneArtifactRich,
} from 'lang/std/artifactGraph'
import { DisplayArray, GenericObj } from './DisplayObj'

export function DebugFeatureTree() {
  const featureTree = useMemo(() => {
    return computeTree(engineCommandManager.artifactGraph)
  }, [engineCommandManager.artifactGraph])

  console.warn('artifactGraph', engineCommandManager.artifactGraph)
  console.warn('featureTree', featureTree)
  const filterKeys: string[] = ['__meta']
  return (
    <div id="debug-feature-tree" className="relative">
      <h1>Feature Tree</h1>
      {featureTree.length > 0 ? (
        <pre className="text-xs" data-testid="debug-feature-tree">
          <DisplayArray arr={featureTree} filterKeys={filterKeys} />
        </pre>
      ) : (
        <p>(Empty)</p>
      )}
    </div>
  )
}

function computeTree(artifactGraph: ArtifactGraph): GenericObj[] {
  // Deep clone so that we can freely mutate.
  let items: GenericObj[] = []

  const planes: PlaneArtifactRich[] = []
  for (const artifact of artifactGraph.values()) {
    if (artifact.type === 'plane') {
      planes.push(expandPlane(artifact, artifactGraph))
    }
  }
  const extraRichPlanes: GenericObj[] = planes.map((plane) => {
    console.warn('Paths', plane.paths)
    return plane as any as GenericObj
  })
  items = items.concat(extraRichPlanes)

  return items
}
