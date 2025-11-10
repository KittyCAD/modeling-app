import type { WebSocketResponse } from '@kittycad/lib/dist/types/src'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { filterArtifacts } from '@src/lang/std/artifactGraph'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import { useEffect, useRef, useState } from 'react'

export function BodiesPane(props: AreaTypeComponentProps) {
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
      <BodiesList />
    </LayoutPanel>
  )
}

type BodyItem = {
  id: string
  isVisible: boolean
}

async function getBodiesFromEngine(skip = 0) {
  return engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'scene_get_entity_ids',
      filter: ['solid3d'],
      skip,
      take: 5,
    },
  })
}

function getBodiesFromArtifactGraph() {
  return filterArtifacts(
    { types: ['compositeSolid', 'sweep'] },
    kclManager.artifactGraph
  )
}

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

function BodiesList() {
  const [bodies, setBodies] = useState<Record<string, boolean>>({})

  // subscribe to the bodies list and show what's up

  // add a click handler to send a request to toggle a body's visibility
  const onClick = () => {
    const newBodiesFromArtifactGraph = getBodiesFromArtifactGraph()
    console.log(
      'BODIES ACCORDING TO ARTIFACT GRAPH',
      newBodiesFromArtifactGraph
    )
    getBodiesFromEngine()
      .then((resp) => {
        if (!resp) {
          console.warn('No response')
          return
        }

        if (isArray(resp)) {
          resp = resp[0]
        }
        const singleResp = resp

        if (isModelingResponse(singleResp)) {
          const mr = singleResp.resp.data.modeling_response
          if (mr?.type === 'scene_get_entity_ids') {
            const newIDs = mr.data.entity_ids as [string[]]
            console.log('BODIES ACCORDING TO ENGINE', newIDs)
            setBodies((current) => {
              const newBodies = Object.assign(
                {},
                current,
                Object.fromEntries(
                  newBodiesFromArtifactGraph.keys().map((id) => [id, true])
                )
              )
              return newBodies
            })
          }
        }
      })
      .catch(reportRejection)
  }

  function setVisibility(id: string, newValue: boolean) {
    setEngineVisibility(id, newValue)
      .then(() => {
        setBodies((current) => ({
          ...current,
          [id]: newValue,
        }))
      })
      .catch(reportRejection)
  }

  return (
    <section>
      <button onClick={onClick}>Get Bodies</button>
      <ul>
        {Object.entries(bodies).map(([id, isVisible], i) => (
          <li key={id || i} className="flex px-1 py-0.5 group/visibilityToggle">
            <CustomIcon name="body" className="w-6 h-6" />
            <span className="flex-1">Body {i}</span>
            <VisibilityToggle
              visible={isVisible}
              onVisibilityChange={() => setVisibility(id, !isVisible)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
