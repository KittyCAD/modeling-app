import type { WebSocketResponse } from '@kittycad/lib/dist/types/src'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { engineCommandManager } from '@src/lib/singletons'
import { useEffect, useRef } from 'react'

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

function BodiesList() {
  const bodies = useRef<WebSocketResponse[]>([])

  // subscribe to the bodies list and show what's up
  useEffect(() => {
    async function getBodies() {
      const newBodies = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'scene_get_entity_ids',
          filter: ['solid3d'],
          skip: 0,
          take: 5,
        },
      })
      if (newBodies !== null) {
        bodies.current = newBodies instanceof Array ? newBodies : [newBodies]
      }
    }

    getBodies().catch(() => console.error('failed to get bodies!'))
  }, [])

  // add a click handler to send a request to toggle a body's visibility

  return (
    <ul>
      {bodies.current.map((item, i) => (
        <li key={item.request_id || i}>{JSON.stringify(item)}</li>
      ))}
    </ul>
  )
}
