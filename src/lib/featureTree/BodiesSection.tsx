import { useBodyItem } from '@src/lib/featureTree/useBodyItem'
import type { FeatureTreeBody } from '@src/lib/featureTree/model'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  FeatureTreeRow,
  FeatureTreeNotice,
} from '@src/lib/featureTree/FeatureTreeView'
import { useApp } from '@src/lib/boot'

/** Body identity and actions stay in ZDS; the shared tree handles row interaction. */
export function BodiesSection({ sectionId }: { sectionId: string }) {
  useSignals()
  const bodies = useApp().registry.get(featureTree).model.value.bodies
  const bodiesWithProps = new Map(bodies.map(({ id, ...body }) => [id, body]))

  return (
    <>
      {Array.from(bodiesWithProps.entries()).map(([id, props]) => (
        <BodyItem key={id} nodeId={`body:${id}`} {...props} />
      ))}

      {!bodiesWithProps.size && (
        <FeatureTreeNotice parentId={sectionId}>
          <p className="feature-tree-empty">No bodies</p>
        </FeatureTreeNotice>
      )}
    </>
  )
}

function BodyItem({
  nodeId,
  ...body
}: Omit<FeatureTreeBody, 'id'> & { nodeId: string }) {
  const { label, onSelect, handleDelete, visibility } = useBodyItem(body)
  return (
    <FeatureTreeRow
      nodeId={nodeId}
      label={label}
      icon={<CustomIcon name="body" className="w-5 h-5" />}
      onSelect={onSelect}
      onContextMenu={onSelect}
      menuItems={[
        <ContextMenuItem
          key="delete"
          onClick={handleDelete}
          data-testid="context-menu-delete"
        >
          Delete
        </ContextMenuItem>,
      ]}
      visibility={visibility}
    />
  )
}
