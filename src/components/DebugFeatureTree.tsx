import { useMemo } from "react"
import {
  kclManager,
  engineCommandManager,
} from 'lib/singletons'
import { ArtifactId } from "wasm-lib/kcl/bindings/ArtifactId"
import { Artifact } from "wasm-lib/kcl/bindings/Artifact"
import { ArtifactGraph, expandPlane, PlaneArtifact, PlaneArtifactRich } from "lang/std/artifactGraph"
import { DisplayArray, GenericObj } from "./DisplayObj"
import { KclValue, SketchGroup } from "lang/wasm"
import { UserVal } from "wasm-lib/kcl/bindings/UserVal"

export function DebugFeatureTree() {
  const featureTree = useMemo(() => {
    return computeTree(engineCommandManager.artifactGraph, kclManager.execState.artifacts)
  }, [engineCommandManager.artifactGraph, kclManager.execState.artifacts])

  // console.warn('artifactGraph', engineCommandManager.artifactGraph)
  console.warn('artifacts', kclManager.execState.artifacts)
  console.warn('featureTree', featureTree)
  const filterKeys: string[] = ['__meta']
  return (
    <div id="debug-feature-tree" className="relative">
      <h1>Feature Tree</h1>
      {featureTree.length > 0 ? (
        <pre className="text-xs">
          <DisplayArray
            arr={featureTree}
            filterKeys={filterKeys}
          />
        </pre>
      ) : (
        <p>(Empty)</p>
      )}
    </div>
  )
}

interface Artifacts {
  [key: ArtifactId]: Artifact
}

interface SketchGroupKclValue extends UserVal {
  value: SketchGroup
}

function isKclValueSketchGroup(value: KclValue): value is SketchGroupKclValue {
  return value.type === 'UserVal' && value.value.type === 'SketchGroup'
}

function computeTree(artifactGraph: ArtifactGraph, artifacts: Artifacts): GenericObj[] {
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
    for (const path of plane.paths) {
      const pathArtifact = artifacts[path.id]
      if (!pathArtifact) {
        console.warn('Path artifact not found', path.id)
        continue
      } else {
        console.warn('Path artifact found', path.id)
      }
      const kclValue = pathArtifact.value
      if (isKclValueSketchGroup(kclValue)) {
        (path as any).sketch = kclValue.value
      }
    }
    return plane as any as GenericObj
  })
  items = items.concat(extraRichPlanes)

  return items
}
