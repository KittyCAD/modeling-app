import {
  assignCodeCadPaneContent,
  CODE_CAD_PANE_OPTIONS,
  type CodeCadPaneAssignments,
  updateSceneFeatureTreeVisibility,
} from '@src/lib/aiFirstCad/context'
import { describe, expect, it } from 'vitest'

const defaultAssignments: CodeCadPaneAssignments = {
  left: 'files',
  center: 'code',
  right: 'scene',
}

describe('CODE_CAD_PANE_OPTIONS', () => {
  it('includes only top-level workspace surfaces', () => {
    expect(CODE_CAD_PANE_OPTIONS).toEqual([
      {
        id: 'projects',
        label: 'Projects',
        areaType: 'aiProjectSwitcher',
      },
      { id: 'chat', label: 'Chat', areaType: 'ttc' },
      { id: 'scene', label: 'Scene', areaType: 'modeling' },
      { id: 'canvas', label: 'Canvas', areaType: 'modeling' },
      { id: 'code', label: 'Code Editor', areaType: 'codeEditor' },
      { id: 'files', label: 'Project Files', areaType: 'files' },
    ])
  })
})

describe('assignCodeCadPaneContent', () => {
  it('keeps the current assignments when the selected content is unchanged', () => {
    expect(assignCodeCadPaneContent(defaultAssignments, 'center', 'code')).toBe(
      defaultAssignments
    )
  })

  it('changes only the selected slot when another slot has the same content', () => {
    expect(
      assignCodeCadPaneContent(defaultAssignments, 'center', 'scene')
    ).toEqual({
      left: 'files',
      center: 'scene',
      right: 'scene',
    })
  })

  it('replaces the slot when the selected content is not currently visible', () => {
    expect(
      assignCodeCadPaneContent(defaultAssignments, 'center', 'canvas')
    ).toEqual({
      left: 'files',
      center: 'canvas',
      right: 'scene',
    })
  })

  it('allows the same pane content in every slot', () => {
    const leftAssigned = assignCodeCadPaneContent(
      defaultAssignments,
      'left',
      'code'
    )
    const rightAssigned = assignCodeCadPaneContent(
      leftAssigned,
      'right',
      'code'
    )

    expect(rightAssigned).toEqual({
      left: 'code',
      center: 'code',
      right: 'code',
    })
  })
})

describe('updateSceneFeatureTreeVisibility', () => {
  it('remembers visibility independently for TradCAD and CodeCAD', () => {
    const visibility = { manual: true, code: true }

    const hiddenInTradCad = updateSceneFeatureTreeVisibility(
      visibility,
      'manual',
      false
    )
    const hiddenInBoth = updateSceneFeatureTreeVisibility(
      hiddenInTradCad,
      'code',
      false
    )

    expect(hiddenInTradCad).toEqual({ manual: false, code: true })
    expect(hiddenInBoth).toEqual({ manual: false, code: false })
  })

  it('keeps the current object when visibility is unchanged', () => {
    const visibility = { manual: false, code: true }

    expect(updateSceneFeatureTreeVisibility(visibility, 'manual', false)).toBe(
      visibility
    )
  })
})
