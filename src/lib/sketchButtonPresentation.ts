import type { Selections } from '@src/machines/modelingSharedTypes'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import {
  getSelectedPlaneId,
  getSelectedSketchTarget as getSelectedSketchTargetId,
} from '@src/lang/queryAst'
import { getSelectedDefaultPlane } from '@src/lib/selections'
import {
  SKETCH_DEFAULT_PLANE_XY,
  SKETCH_DEFAULT_PLANE_XZ,
  SKETCH_DEFAULT_PLANE_YZ,
  SKETCH_SELECTION_RGB_STR,
} from '@src/lib/constants'

export const sketchButtonHelp = {
  description: 'Start drawing a 2D sketch.',
  links: [
    { label: 'KCL docs', url: withSiteBaseURL('/docs/kcl-lang/sketches') },
  ],
}

export function getSelectedSketchTarget(selectionRanges: Selections): {
  id: string
  title: string
} | null {
  const defaultPlane = getSelectedDefaultPlane(selectionRanges)
  if (defaultPlane) {
    return {
      id: defaultPlane.id,
      title: `Start Sketch on ${defaultPlane.name.toUpperCase()}`,
    }
  }

  const id = getSelectedSketchTargetId(selectionRanges)
  if (!id) return null

  return {
    id,
    title:
      getSelectedPlaneId(selectionRanges) === id
        ? 'Start Sketch on plane'
        : 'Start Sketch on face',
  }
}

export function getSelectedSketchIconColor(
  selectionRanges: Selections
): string | undefined {
  const defaultPlane = getSelectedDefaultPlane(selectionRanges)
  if (defaultPlane) {
    switch (defaultPlane.name.toLowerCase()) {
      case 'xy':
        return SKETCH_DEFAULT_PLANE_XY
      case 'xz':
        return SKETCH_DEFAULT_PLANE_XZ
      case 'yz':
        return SKETCH_DEFAULT_PLANE_YZ
    }
  }

  return getSelectedSketchTargetId(selectionRanges)
    ? `rgb(${SKETCH_SELECTION_RGB_STR})`
    : undefined
}

/** Both toolbar hosts resolve sketch context before passing this presentation to the shared button view. */
export function sketchButtonPresentation(
  editing: boolean,
  selections: Selections
) {
  const title = editing ? 'Edit Sketch' : 'Start Sketch'
  return {
    ...sketchButtonHelp,
    title,
    tooltipTitle: editing
      ? title
      : (getSelectedSketchTarget(selections)?.title ?? title),
    iconColor: getSelectedSketchIconColor(selections),
    showTitle: true,
  }
}
