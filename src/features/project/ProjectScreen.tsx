import { useSignalEffect } from '@preact/signals'
import { useService } from '@src/app/context'
import { layoutService } from '@src/contracts/layout'
import { LayoutView } from '@src/features/layout/LayoutView'
import { PROJECT_LAYOUT_PRESET } from '@src/features/project/areaIds'
import './project.css'

/**
 * The project workspace.
 *
 * All this does is mount the layout tree. Which panels exist, where they sit,
 * and how big they are is data owned by the layout service, so this component
 * has nothing to grow into as panels are added.
 */
export function ProjectScreen() {
  const layout = useService(layoutService)

  // Seed a layout on first use, and only then — a persisted arrangement must
  // survive a reload rather than being overwritten by the default on mount.
  useSignalEffect(() => {
    if (layout.root.value === null) {
      layout.applyPreset(PROJECT_LAYOUT_PRESET)
    }
  })

  return (
    <div class="zds-layout">
      <LayoutView node={layout.root.value} layout={layout} />
    </div>
  )
}
