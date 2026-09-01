import { AI_PROJECTS_AREA_TYPE } from '@src/lib/aiFirstCad/layouts'
import type { LayoutAreaSelectorOption } from '@src/lib/layout/components'
import { AreaType } from '@src/lib/layout/types'

export type WorkspacePaneContent =
  | 'projects'
  | 'chat'
  | 'scene'
  | 'canvas'
  | 'code'
  | 'files'

export const WORKSPACE_PANE_OPTIONS: readonly LayoutAreaSelectorOption[] = [
  {
    id: 'projects',
    label: 'Projects',
    areaType: AI_PROJECTS_AREA_TYPE,
  },
  { id: 'chat', label: 'Chat', areaType: AreaType.TTC },
  { id: 'scene', label: 'Scene', areaType: AreaType.ModelingScene },
  { id: 'canvas', label: 'Canvas', areaType: AreaType.ModelingScene },
  { id: 'code', label: 'Code Editor', areaType: AreaType.Code },
  { id: 'files', label: 'Project Files', areaType: AreaType.Files },
]

export function getWorkspacePaneOption(content: WorkspacePaneContent) {
  return WORKSPACE_PANE_OPTIONS.find((option) => option.id === content)
}

export function getWorkspacePaneLabel(content: WorkspacePaneContent) {
  return getWorkspacePaneOption(content)?.label ?? content
}

export function getWorkspacePaneAreaType(content: WorkspacePaneContent) {
  return getWorkspacePaneOption(content)?.areaType ?? AreaType.ModelingScene
}

export function getWorkspacePaneLabelForArea(
  areaType: string | undefined,
  fallbackLabel: string
) {
  if (areaType === AreaType.ModelingScene && fallbackLabel === 'Canvas') {
    return fallbackLabel
  }
  return (
    WORKSPACE_PANE_OPTIONS.find((option) => option.areaType === areaType)
      ?.label ?? fallbackLabel
  )
}
