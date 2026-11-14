import { EntityStylingRenderer } from '@src/clientSideScene/localRenderer/EntityStylingRenderer'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import type {
  EntityStyle,
  EntityStyleGroup,
} from '@src/lib/scene/entityStyling'
import { Color, SRGBColorSpace, type Mesh } from 'three'

const hover = Symbol('hover'),
  selection = Symbol('selection')
function interactionStyle(color: number, priority: number): EntityStyle {
  const rgb = new Color(color).getRGB(new Color(), SRGBColorSpace)
  return {
    color: [rgb.r, rgb.g, rgb.b],
    priority,
    fillOpacity: 0.2,
    outlineOpacity: 1,
    lineWidth: 2,
  }
}
/** Application policy adapts ordinary interaction highlights to the generic styling renderer. */
export class SelectionHighlightRenderer extends EntityStylingRenderer {
  private customGroups = new Set<symbol>()
  setHover(targets: Mesh[]) {
    this.setGroup(hover, targets, interactionStyle(SKETCH_HIGHLIGHT_COLOR, 90))
  }
  setSelection(targets: Iterable<Mesh>) {
    this.setGroup(
      selection,
      targets,
      interactionStyle(SKETCH_SELECTION_COLOR, 100)
    )
  }
  setEntityStyles(
    groups: readonly { group: EntityStyleGroup; targets: readonly Mesh[] }[]
  ) {
    const current = new Set(groups.map(({ group }) => group.id))
    for (const id of this.customGroups)
      if (!current.has(id)) this.clearGroup(id)
    for (const { group, targets } of groups)
      this.setGroup(group.id, targets, group.style)
    this.customGroups = current
  }
  override clearModel() {
    super.clearModel()
    this.customGroups.clear()
  }
}
