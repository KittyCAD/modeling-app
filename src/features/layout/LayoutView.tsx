import { Split } from '@kittycad/ui-kit'
import type {
  DockNode,
  LayoutNode,
  LayoutService,
  SplitNode,
} from '@src/contracts/layout'
import { AreaHost } from '@src/features/layout/AreaHost'
import { Rail } from '@src/features/layout/Rail'
import './layout.css'

interface LayoutViewProps {
  node: LayoutNode | null
  layout: LayoutService
}

/**
 * Renders a layout tree.
 *
 * The tree is plain data, so this is the only place that knows how a node
 * becomes DOM. Adding a node type is a change here and nowhere else — and a
 * layout stays serialisable, diffable, and migratable, none of which is true
 * when an arrangement is expressed as nested JSX.
 */
export function LayoutView({ node, layout }: LayoutViewProps) {
  if (!node) return null

  switch (node.type) {
    case 'area': {
      const area = layout.area(node.areaId)
      // A layout can outlive the feature that contributed its area: after a
      // plugin is turned off, or when a persisted layout is restored against a
      // newer build. Rendering nothing is correct; throwing is not.
      if (!area) return null
      return <AreaHost area={area} nodeId={node.id} />
    }

    case 'split':
      return <SplitView node={node} layout={layout} />

    case 'rail':
      return <Rail node={node} layout={layout} />

    case 'dock':
      return <DockView node={node} layout={layout} />
  }
}

/**
 * Rails around a centre.
 *
 * The rails size to their own content and the centre takes the remainder, so
 * a panel keeps its width when the window resizes instead of scaling with it.
 */
function DockView({ node, layout }: { node: DockNode; layout: LayoutService }) {
  return (
    <div class="zds-dock">
      {node.start ? <Rail node={node.start} layout={layout} /> : null}
      <div class="zds-dock__center">
        <LayoutView node={node.center} layout={layout} />
      </div>
      {node.end ? <Rail node={node.end} layout={layout} /> : null}
    </div>
  )
}

function SplitView({
  node,
  layout,
}: {
  node: SplitNode
  layout: LayoutService
}) {
  const sizes = layout.sizesFor(node.id)

  // Built inline, not memoised: this derives from `node`, a plain prop, and a
  // `useComputed` would only invalidate on signal changes — leaving it stale
  // whenever the layout tree changed shape.
  const panes = node.children.map((child) => ({
    id: child.id,
    // A rail can collapse to just its strip, so it has no minimum of its own.
    minSize: child.type === 'rail' ? 0 : 120,
    content: <LayoutView node={child} layout={layout} />,
  }))

  return <Split orientation={node.orientation} panes={panes} sizes={sizes} />
}
