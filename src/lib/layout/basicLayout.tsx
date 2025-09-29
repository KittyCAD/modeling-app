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
export const defaultLayout: Layout = {
  id: '0000',
  label: 'root',
  type: 'splits',
  orientation: 'inline',
  splitPoints: [0.3, 0.8],
  children: [
    {
      id: '',
      label: 'left-toolbar',
      type: 'toolbar',
      side: 'inline-start',
      activeIndices: [0],
      children: [
        {
          id: '',
          label: 'feature-tree',
          type: 'simple',
          component: <p>Hi I'm the feature tree area!</p>,
          icon: 'model',
        },
        {
          id: '',
          label: 'code',
          type: 'simple',
          component: <p>Hi I'm the code editor area!</p>,
          icon: 'code',
        },
        {
          id: '',
          label: 'variables',
          type: 'simple',
          component: <p>Hi I'm the variables area!</p>,
          icon: 'make-variable',
        },
      ],
    },
    {
      id: '',
      label: 'modeling-scene',
      type: 'simple',
      component: <p>Hi I'm the modeling scene!</p>,
    },
    {
      id: '',
      label: 'right-toolbar',
      type: 'toolbar',
      side: 'inline-end',
      activeIndices: [0],
      children: [
        {
          id: '',
          label: 'ttc',
          type: 'simple',
          component: <p>Hi I'm the TTC "pane"</p>,
          icon: 'sparkles',
        },
      ],
    },
  ],
}
