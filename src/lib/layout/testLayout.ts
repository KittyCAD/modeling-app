import { LayoutType, type Layout } from '@src/lib/layout/types'

export const testLayout: Layout = {
  id: 'test',
  label: 'root',
  type: LayoutType.Splits,
  orientation: 'block',
  sizes: [30, 20, 30, 20],
  children: [
    {
      id: crypto.randomUUID(),
      label: 'split',
      type: LayoutType.Splits,
      sizes: [50, 25, 25],
      orientation: 'inline',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: LayoutType.Simple,
          areaType: 'modeling',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: LayoutType.Simple,
          areaType: 'variables',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: LayoutType.Simple,
          areaType: 'modeling',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      label: 'middle-split',
      type: LayoutType.Splits,
      sizes: [75, 25],
      orientation: 'inline',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: LayoutType.Simple,
          areaType: 'modeling',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: LayoutType.Simple,
          areaType: 'variables',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      label: 'right-toolbar',
      type: LayoutType.Panes,
      side: 'block-start',
      activeIndices: [0, 2, 3],
      sizes: [20, 20, 60],
      children: [
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: LayoutType.Simple,
          areaType: 'ttc',
          icon: 'sparkles',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: LayoutType.Simple,
          areaType: 'variables',
          icon: 'make-variable',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: LayoutType.Simple,
          areaType: 'codeEditor',
          icon: 'code',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: LayoutType.Simple,
          areaType: 'featureTree',
          icon: 'revolve',
        },
      ],
    },
  ],
}
