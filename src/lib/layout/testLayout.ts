import type { Layout } from '@src/lib/layout/types'

export const testLayout: Layout = {
  id: 'test',
  label: 'root',
  type: 'splits',
  orientation: 'block',
  sizes: [30, 20, 30, 20],
  children: [
    {
      id: crypto.randomUUID(),
      label: 'split',
      type: 'splits',
      sizes: [50, 25, 25],
      orientation: 'inline',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: 'simple',
          areaType: 'modeling',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: 'simple',
          areaType: 'variables',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: 'simple',
          areaType: 'modeling',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      label: 'middle-split',
      type: 'splits',
      sizes: [75, 25],
      orientation: 'inline',
      children: [
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: 'simple',
          areaType: 'modeling',
        },
        {
          id: crypto.randomUUID(),
          label: 'modeling-scene',
          type: 'simple',
          areaType: 'variables',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      label: 'right-toolbar',
      type: 'panes',
      side: 'block-start',
      activeIndices: [0, 2, 3],
      sizes: [20, 20, 60],
      children: [
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: 'simple',
          areaType: 'ttc',
          icon: 'sparkles',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: 'simple',
          areaType: 'variables',
          icon: 'make-variable',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: 'simple',
          areaType: 'codeEditor',
          icon: 'code',
        },
        {
          id: crypto.randomUUID(),
          label: crypto.randomUUID(),
          type: 'simple',
          areaType: 'featureTree',
          icon: 'revolve',
        },
      ],
    },
  ],
}
