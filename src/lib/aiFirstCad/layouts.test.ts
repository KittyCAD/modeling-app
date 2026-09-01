import {
  AI_PROJECTS_AREA_TYPE,
  aiFirstLayoutConfig,
  CODE_CAD_STREAM_PANEL_ID,
  codeCadLayoutConfig,
  manualFirstLayoutConfig,
} from '@src/lib/aiFirstCad/layouts'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'
import { describe, expect, it } from 'vitest'

function collectAreaTypes(layout: Layout): string[] {
  if (layout.type === LayoutType.Simple) {
    return [layout.areaType]
  }
  return layout.children.flatMap(collectAreaTypes)
}

describe('AI-first CAD layouts', () => {
  it('keeps projects and Zookeeper open in adjacent columns', () => {
    expect(collectAreaTypes(aiFirstLayoutConfig)).toEqual([
      AI_PROJECTS_AREA_TYPE,
      AreaType.TTC,
      AreaType.ModelingScene,
    ])
    expect(aiFirstLayoutConfig).toMatchObject({
      sizes: [16, 34, 50],
      children: [
        {
          areaType: AI_PROJECTS_AREA_TYPE,
          label: 'Projects',
          type: LayoutType.Simple,
        },
        { areaType: AreaType.TTC, label: 'Chat', type: LayoutType.Simple },
        {
          areaType: AreaType.ModelingScene,
          label: 'Canvas',
          type: LayoutType.Simple,
        },
      ],
    })
  })

  it('keeps TradCAD visual and removes both code and Zookeeper', () => {
    const areaTypes = collectAreaTypes(manualFirstLayoutConfig)
    expect(areaTypes).toContain(AreaType.ModelingScene)
    expect(areaTypes).not.toContain(AreaType.Code)
    expect(areaTypes).not.toContain(AreaType.TTC)
    expect(areaTypes).not.toContain(AreaType.Variables)
    expect(areaTypes).not.toContain(AreaType.Logs)
    expect(areaTypes).not.toContain(AreaType.Files)
    expect(areaTypes).not.toContain(AreaType.Debug)
    expect(manualFirstLayoutConfig).toMatchObject({
      children: [
        {
          areaType: AreaType.ModelingScene,
          id: 'manual-modeling-scene',
          type: LayoutType.Simple,
        },
      ],
      sizes: [100],
    })
  })

  it('uses a full-width Canvas beneath the CodeCAD editor overlay', () => {
    const areaTypes = collectAreaTypes(codeCadLayoutConfig)
    expect(areaTypes).toEqual([AreaType.ModelingScene])
    expect(areaTypes).not.toContain(AreaType.Code)
    expect(areaTypes).not.toContain(AreaType.FeatureTree)
    expect(areaTypes).not.toContain(AreaType.TTC)
    expect(codeCadLayoutConfig.sizes).toEqual([100])
    expect(codeCadLayoutConfig.children.at(0)).toMatchObject({
      areaType: AreaType.ModelingScene,
      id: CODE_CAD_STREAM_PANEL_ID,
      label: 'Canvas',
      type: LayoutType.Simple,
    })
  })
})
