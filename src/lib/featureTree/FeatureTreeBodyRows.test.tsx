import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  getBodyTreeNodeRenderKey,
  type BodyTreeNode,
} from '@src/lib/featureTree/featureTreeBodyTree'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

function region(start: number): Operation {
  return {
    type: 'StdLibCall',
    name: 'region',
    sourceRange: [start, start + 10, 0],
    nodePath: { steps: [] },
    unlabeledArg: null,
    labeledArgs: {},
  }
}

function Rows({ nodes }: { nodes: BodyTreeNode[] }) {
  return (
    <ul>
      {nodes.map((node, index) => (
        <li key={getBodyTreeNodeRenderKey(node, index)}>
          {'body' in node ? 'Body 1' : 'Region'}
        </li>
      ))}
    </ul>
  )
}

test('removes live rows with placeholder paths when body histories arrive', () => {
  const live = [region(10), region(30), region(50)]
  const view = render(<Rows nodes={live.slice(0, 2)} />)
  view.rerender(<Rows nodes={live} />)
  const body: BodyTreeNode = {
    body: {
      id: 'body',
      artifact: {
        type: 'sweep',
        id: 'body',
        subType: 'extrusion',
        surfaceIds: [],
        edgeIds: [],
        trajectoryId: null,
        method: 'new',
        consumed: false,
        codeRef: {
          range: [70, 80, 0],
          nodePath: { steps: [] },
          pathToNode: [],
        },
      },
      index: 0,
      expansionKey: 'body-creation',
      ownerModuleId: 0,
      operations: live,
    },
    children: live,
  }
  view.rerender(<Rows nodes={[body]} />)
  expect(screen.queryAllByText('Region')).toHaveLength(0)
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('Body 1')).toBeVisible()
  expect(getBodyTreeNodeRenderKey(body, 0)).toBe(
    getBodyTreeNodeRenderKey(body, live.length)
  )
})
