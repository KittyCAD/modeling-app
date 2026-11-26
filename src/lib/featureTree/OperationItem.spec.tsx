import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { signal } from '@preact/signals-core'
import { EditorSelection } from '@codemirror/state'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ layout: { signal: { value: null } } }),
  useSingletons: vi.fn(),
}))

import {
  FeatureTreeOmissionNotice,
  OperationItem,
} from '@src/lib/featureTree/FeatureTreePane'

type OperationItemProps = ComponentProps<typeof OperationItem>

describe('partial feature tree notice', () => {
  it('explains that operations were omitted without affecting geometry', () => {
    render(<FeatureTreeOmissionNotice omittedOperationCount={100} />)
    const notice = within(screen.getByRole('status'))
    expect(notice.getByText('Showing a partial feature tree')).toBeVisible()
    expect(
      notice.getByText(/does not affect the generated geometry/)
    ).toBeVisible()
  })

  it.each([undefined, 0])(
    'hides the notice when the omitted count is %s',
    (count) => {
      render(<FeatureTreeOmissionNotice omittedOperationCount={count} />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
  )
})

describe('imported feature tree menus', () => {
  it.each<Operation>([
    {
      type: 'ModuleInstance',
      name: 'bracket',
      moduleId: 1,
      nodePath: { steps: [] },
      sourceRange: [0, 10, 0],
    },
    {
      type: 'StdLibCall',
      name: 'extrude',
      unlabeledArg: null,
      labeledArgs: {},
      nodePath: { steps: [] },
      sourceRange: [0, 10, 1],
    },
  ])('only offers source navigation for $type', async (item) => {
    const systemDeps = {
      kclManager: {
        diagnosticsSignal: signal([]),
        astSignal: signal({ body: [] }),
        hasParseErrors: () => false,
        wasmInstancePromise: Promise.resolve({}),
      },
    } as unknown as OperationItemProps['systemDeps']

    await act(async () => {
      render(
        <MemoryRouter>
          <OperationItem
            item={item}
            code=""
            isModuleOwned
            sketchNoFace={false}
            systemDeps={systemDeps}
            engineCommandManager={
              {} as OperationItemProps['engineCommandManager']
            }
            modelingActor={{} as OperationItemProps['modelingActor']}
            onSelect={vi.fn()}
            visibilityOperations={[]}
            editorSelection={EditorSelection.single(0)}
          />
        </MemoryRouter>
      )
    })

    fireEvent.contextMenu(screen.getByRole('button'))

    const menu = await screen.findByRole('dialog')
    expect(
      within(menu).getByRole('button', { name: 'View KCL source code' })
    ).toBeEnabled()
    expect(within(menu).getAllByRole('button')).toHaveLength(1)
  })
})
