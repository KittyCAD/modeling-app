import type { WebSocketResponse } from '@kittycad/lib/dist/types/src'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import {
  Artifact,
  filterArtifacts,
  getBodiesFromArtifactGraph,
} from '@src/lang/std/artifactGraph'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

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
async function setEngineVisibility(id: string, isVisible: boolean) {
  return engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'object_visible',
      object_id: id,
      hidden: !isVisible,
    },
  })
}

function BodiesList({ bodies }: { bodies: Map<string, Artifact> }) {
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {bodies.entries().map(([id, _artifact], i) => (
          <li key={id || i} className="flex px-1 py-0.5 group/visibilityToggle">
            <CustomIcon name="body" className="w-6 h-6" />
            <span className="flex-1">Body {i}</span>
            <VisibilityToggle
              visible={true}
              onVisibilityChange={() => {
                /** no-op for now **/
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
