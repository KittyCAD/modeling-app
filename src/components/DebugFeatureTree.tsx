import { useMemo } from 'react'
import { engineCommandManager } from 'lib/singletons'
import { DebugDisplayArray } from './DebugDisplayObj'
import { computeFeatureTree } from 'lib/computeFeatureTree'

export function DebugFeatureTree() {
  const featureTree = useMemo(() => {
    return computeFeatureTree(engineCommandManager.artifactGraph)
  }, [engineCommandManager.artifactGraph])

  const filterKeys: string[] = ['__meta', 'codeRef', 'pathToNode']
  return (
    <details data-testid="debug-feature-tree" className="relative">
      <summary>Feature Tree</summary>
      {featureTree.length > 0 ? (
        <pre className="text-xs">
          <DebugDisplayArray arr={featureTree} filterKeys={filterKeys} />
        </pre>
      ) : (
        <p>(Empty)</p>
      )}
    </details>
  )
}
