import { Button, Panel } from '@kittycad/ui-kit'
import type { AreaDefinition } from '@src/contracts/layout'
import './layout.css'

interface AreaHostProps {
  area: AreaDefinition
  nodeId: string
  /** Supplied when the area sits in a rail and can therefore be dismissed. */
  onClose?: () => void
}

/**
 * Wraps one area in its chrome.
 *
 * Areas declare whether they want a panel or the bare region, so the layout
 * never has to special-case the viewport and the editor the way a hard-coded
 * arrangement would.
 *
 * Lives in its own module because both `LayoutView` and `Rail` need it, and
 * having them import each other is how a render tree acquires a cycle.
 */
export function AreaHost({ area, nodeId, onClose }: AreaHostProps) {
  const content = area.render({ nodeId })

  if (area.chrome === 'bare') {
    return <div class="zds-layout__bare">{content}</div>
  }

  return (
    <Panel
      heading={area.title}
      headerActions={
        onClose ? (
          <Button
            variant="ghost"
            size="small"
            iconOnly
            icon="close"
            label={`Close ${area.title}`}
            onClick={onClose}
          />
        ) : undefined
      }
    >
      {content}
    </Panel>
  )
}
