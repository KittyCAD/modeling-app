import type { Layout } from '@src/lib/layout/types'

/**
 * The default layout has:
 * - a left (in LTR languages) sidebar with:
 *   - Feature tree (open)
 *   - code
 *   - variables
 * - the modeling view
 * - a right (in LTR languages) sidebar with:
 *   - Text-to-CAD
 */
export const basicLayout: Layout = {
  id: 'a',
  label: 'root',
  type: 'splits',
  orientation: 'inline',
  sizes: [30, 50, 10],
  children: [
    {
      id: 'b',
      label: 'left-toolbar',
      type: 'toolbar',
      side: 'inline-start',
      activeIndices: [0],
      children: [
        {
          id: 'c',
          label: 'feature-tree',
          type: 'simple',
          component: (
            <p className="bg-blue-300">Hi I'm the feature tree area!</p>
          ),
          icon: 'model',
        },
        {
          id: 'd',
          label: 'code',
          type: 'simple',
          component: (
            <p className="bg-green-300">Hi I'm the code editor area!</p>
          ),
          icon: 'code',
        },
        {
          id: 'e',
          label: 'variables',
          type: 'simple',
          component: (
            <p className="bg-orange-300">Hi I'm the variables area!</p>
          ),
          icon: 'make-variable',
        },
      ],
    },
    {
      id: 'i',
      label: 'middle-split',
      type: 'splits',
      sizes: [50, 50],
      orientation: 'block',
      children: [
        {
          id: 'f',
          label: 'modeling-scene',
          type: 'simple',
          component: <p>Hi I'm the modeling scene!</p>,
        },
        {
          id: 'j',
          label: 'modeling-scene',
          type: 'simple',
          component: <p>Hi I'm the modeling scene, but again!</p>,
        },
      ],
    },
    {
      id: 'g',
      label: 'right-toolbar',
      type: 'toolbar',
      side: 'inline-end',
      activeIndices: [0],
      children: [
        {
          id: 'h',
          label: 'ttc',
          type: 'simple',
          component: <p>Hi I'm the TTC "pane"</p>,
          icon: 'sparkles',
        },
      ],
    },
  ],
}
