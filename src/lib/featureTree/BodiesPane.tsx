import { useBodyItem } from '@src/lib/featureTree/useBodyItem'
import type { FeatureTreeBody } from '@src/lib/featureTree/model'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import type { PropsOf } from '@headlessui/react/dist/types'
import { useSignals } from '@preact/signals-react/runtime'
import { ContextMenuItem } from '@src/components/ContextMenu'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { VisibilityToggle } from '@src/components/VisibilityToggle'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useApp } from '@src/lib/boot'
import type { AreaTypeComponentProps } from '@src/lib/layout'

export function BodiesPane(props: AreaTypeComponentProps) {
  useSignals()
  const bodies = useApp().registry.get(featureTree).model.value.bodies
  const bodiesWithProps = new Map(bodies.map(({ id, ...body }) => [id, body]))

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
      {bodies && <BodiesList bodies={bodiesWithProps} />}
    </LayoutPanel>
  )
}

function BodiesList({
  bodies,
}: {
  bodies: Map<string, PropsOf<typeof BodyItem>>
}) {
  return (
    <section className="overflow-auto mr-1 pb-8">
      <ul>
        {Array.from(bodies.entries()).map(([id, props], i) => (
          <BodyItem key={id || i} {...props} />
        ))}
      </ul>
    </section>
  )
}

function BodyItem(body: Omit<FeatureTreeBody, 'id'>) {
  const { label, isSelected, onSelect, handleDelete, visibility } =
    useBodyItem(body)
  return (
    <li className="px-1 py-0.5 group/visibilityToggle">
      <RowItemWithIconMenuAndToggle
        icon="body"
        onClick={onSelect}
        onContextMenu={() => onSelect()}
        isSelected={isSelected}
        menuItems={[
          <ContextMenuItem
            onClick={handleDelete}
            data-testid="context-menu-delete"
          >
            Delete
          </ContextMenuItem>,
        ]}
        Toggle={<VisibilityToggle {...visibility} />}
      >
        {label}
      </RowItemWithIconMenuAndToggle>
    </li>
  )
}
