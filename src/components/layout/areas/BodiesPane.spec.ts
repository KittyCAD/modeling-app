import { describe, expect, it } from 'vitest'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { NodePath } from '@rust/kcl-lib/bindings/NodePath'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import {
  getBodyItemPropsFromArtifactGraph,
  type SolidArtifact,
} from '@src/components/layout/areas/BodiesPane'
import type { ArtifactGraph } from '@src/lang/wasm'
import { defaultNodePath } from '@src/lang/wasm'
import { defaultSourceRange } from '@src/lang/sourceRange'

function compositeSolidArtifact({
  id,
  sourceRange = defaultSourceRange(),
  outputIndex,
}: {
  id: string
  sourceRange?: SourceRange
  outputIndex?: number
}): SolidArtifact {
  return {
    type: 'compositeSolid',
    id,
    consumed: false,
    subType: 'split',
    outputIndex,
    solidIds: [],
    toolIds: [],
    codeRef: {
      range: sourceRange,
      nodePath: defaultNodePath(),
      pathToNode: [],
    },
  }
}

function hideOperation(searchId: string): Operation {
  return {
    type: 'StdLibCall',
    name: 'hide',
    unlabeledArg: {
      sourceRange: defaultSourceRange(),
      value: {
        type: 'Solid',
        value: { artifactId: searchId },
      },
    },
    labeledArgs: {},
    nodePath: defaultNodePath() as NodePath,
    sourceRange: defaultSourceRange(),
    isError: false,
  }
}

function toArtifactGraph(artifacts: SolidArtifact[]): ArtifactGraph {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

describe('getBodyItemPropsFromArtifactGraph', () => {
  it('lists multiple body artifacts and detects per-body hide operations', () => {
    const firstBody = compositeSolidArtifact({
      id: 'split-result-0',
      outputIndex: 0,
    })
    const secondBody = compositeSolidArtifact({
      id: 'split-result-1',
      outputIndex: 1,
    })

    const bodyProps = getBodyItemPropsFromArtifactGraph({
      artifactGraph: toArtifactGraph([firstBody, secondBody]),
      operations: [hideOperation(secondBody.id)],
    })

    expect([...bodyProps.keys()]).toEqual(['split-result-0', 'split-result-1'])
    expect(bodyProps.get(firstBody.id)?.hideOperation).toBeUndefined()
    expect(bodyProps.get(secondBody.id)?.hideOperation?.name).toBe('hide')
  })
})
