import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import {
  Artifact,
  getBodiesFromArtifactGraph,
} from '@src/lang/std/artifactGraph'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { useState } from 'react'

export function BodiesPane(props: AreaTypeComponentProps) {
  const artifactGraph = kclManager.artifactGraph
  const bodies = artifactGraph
    ? getBodiesFromArtifactGraph(artifactGraph)
    : undefined
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="model"
        title={props.layout.label}
      />
      {bodies && <BodiesList bodies={bodies} />}
    </LayoutPanel>
  )
}

/**
 * Temporary function to toggle visibility directly through engine.
 * Visibility ultimately should be written to KCL via a codemod API.
 */
async function setEngineVisibility(artifact: Artifact, isVisible: boolean) {
  let id = artifact.id
  if (artifact.type === 'sweep' && artifact.pathId) {
    id = artifact.pathId
  }

  return engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'object_visible',
      object_id: id,
      hidden: isVisible,
    },
  })
}

function BodiesList({ bodies }: { bodies: Map<string, Artifact> }) {
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {bodies.entries().map(([id, artifact], i) => (
          <BodyItem key={id || i} label={`Body ${i + 1}`} artifact={artifact} />
        ))}
      </ul>
    </section>
  )
}

function BodyItem({ label, artifact }: { label: string; artifact: Artifact }) {
  const [visible, setVisible] = useState(true)

  return (
    <li className="flex px-1 py-0.5 group/visibilityToggle">
      <CustomIcon name="body" className="w-6 h-6" />
      <span className="flex-1">{label}</span>
      <VisibilityToggle
        visible={visible}
        onVisibilityChange={() => {
          /** no-op for now **/
          setVisible((curr) => !curr)
          void setEngineVisibility(artifact, visible).catch(reportRejection)
        }}
      />
    </li>
  )
}
