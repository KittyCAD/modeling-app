import { DefaultPlanesKclManager, FrontPlane } from 'lang/KclSingleton'
import { computeFeatureTree } from 'lib/computeFeatureTree'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { useEffect, useMemo, useState } from 'react'

export const FeatureTreePane = () => {
  const featureTree = useMemo(() => {
    return computeFeatureTree(engineCommandManager.artifactGraph)
  }, [engineCommandManager.artifactGraph])

  return (
    <section
      data-testid="debug-panel"
      className="absolute inset-0 p-2 box-border overflow-auto"
    >
      <FeatureTreeDefaultPlaneItem name="xy" />
      <FeatureTreeDefaultPlaneItem name="xz" />
      <FeatureTreeDefaultPlaneItem name="yz" />
      <hr />
      <pre>{JSON.stringify(featureTree, null, 2)}</pre>
    </section>
  )
}

const FeatureTreeDefaultPlaneItem = (props: { name: FrontPlane }) => {
  const [plane, setPlane] = useState<
    DefaultPlanesKclManager[keyof DefaultPlanesKclManager] | null
  >(null)
  useEffect(() => {
    if (!kclManager.defaultPlanes) {
      return
    }
    const p = kclManager.defaultPlanes[props.name]
    console.log('getting plane', props.name, p)
    setPlane(p)
  }, [kclManager.defaultPlanes, kclManager.defaultPlanesVisibility])

  function handleToggleHidden() {
    if (!plane) {
      return
    }

    kclManager
      .setPlaneVisibility(props.name, !plane.visible)
      .catch(reportRejection)
  }

  return (
    plane && (
      <div className="flex items-center">
        <span>{props.name}</span>
        <button onClick={() => console.log('what the fuck?')}>
          Do you do anything?
        </button>
        <button onClick={handleToggleHidden}>
          {plane.visible ? 'Hide' : 'Show'}
        </button>
      </div>
    )
  )
}
