import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'

export const AI_PROJECTS_AREA_TYPE = 'aiProjectSwitcher'
export const AI_PROJECTS_PANEL_ID = 'ai-projects'
export const AI_CANVAS_PANEL_ID = 'ai-first-modeling-scene'
export const CODE_CAD_STREAM_PANEL_ID = 'code-cad-stream'

export const aiFirstLayoutConfig = {
  id: 'ai-first-root',
  label: 'AI workspace',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [16, 34, 50],
  children: [
    {
      id: AI_PROJECTS_PANEL_ID,
      label: 'Projects',
      type: LayoutType.Simple,
      areaType: AI_PROJECTS_AREA_TYPE,
    },
    {
      id: 'ttc',
      label: 'Chat',
      type: LayoutType.Simple,
      areaType: AreaType.TTC,
    },
    {
      id: AI_CANVAS_PANEL_ID,
      label: 'Canvas',
      type: LayoutType.Simple,
      areaType: AreaType.ModelingScene,
    },
  ],
} satisfies Layout

const traditionalCadScene = {
  id: 'manual-modeling-scene',
  label: 'Modeling scene',
  type: LayoutType.Simple,
  areaType: AreaType.ModelingScene,
} satisfies Layout

const codeCadStream = {
  id: CODE_CAD_STREAM_PANEL_ID,
  label: 'Canvas',
  type: LayoutType.Simple,
  areaType: AreaType.ModelingScene,
} satisfies Layout

export const manualFirstLayoutConfig = {
  id: 'manual-first-root',
  label: 'TradCAD workspace',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [100],
  children: [traditionalCadScene],
} satisfies Layout

export const codeCadLayoutConfig = {
  id: 'code-cad-root',
  label: 'CodeCAD workspace',
  type: LayoutType.Splits,
  orientation: 'inline',
  sizes: [100],
  children: [codeCadStream],
} satisfies Layout
