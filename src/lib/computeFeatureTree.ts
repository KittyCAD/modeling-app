import { GenericObj } from "components/DebugDisplayObj"
import { ArtifactGraph, expandPlane, PlaneArtifactRich } from "lang/std/artifactGraph"

export function computeFeatureTree(artifactGraph: ArtifactGraph): GenericObj[] {
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