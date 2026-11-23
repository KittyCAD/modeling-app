import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: () => {
    throw new Error('Toolbar used the global app')
  },
  useSingletons: () => {
    throw new Error('Toolbar used global singletons')
  },
}))
import {
  ModelingMachineToolbar,
  type ModelingMachineToolbarHost,
} from '@src/components/Toolbar/ModelingMachineToolbar'
import { modelingMachine } from '@src/machines/modelingMachine'
import { buildModelingMachineInput } from '@src/unitTestUtils'
import { buildToolbarConfig } from '@src/lib/toolbar'
import { createEmptyAst } from '@src/editor/plugins/ast'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'

async function fixture() {
  const input = await buildModelingMachineInput()
  const machine = modelingMachine.provide({
    guards: {
      'Selection is sketchBlock': () => false,
      'Selection is on face': () => false,
      'Artifact graph is empty': () => false,
    },
    actions: {
      'set modeling idle double-click callback': () => {},
      'restore modeling camera controls': () => {},
      'reset client scene mouse handlers': () => {},
      'hide default planes': () => {},
      'show planes sketch no face': () => {},
      'set selection filter to faces only': () => {},
      'set selection filter to defaults': () => {},
      'stop scene infra': () => {},
    },
  })
  const actor = createActor(machine, { input }).start()
  const toolbarConfig = buildToolbarConfig({ send: vi.fn() })
  toolbarConfig.modeling.items = [
    {
      id: 'start',
      title: 'Start Sketch',
      icon: 'sketch',
      status: 'available',
      links: [],
      onClick: ({ modelingSend }) => modelingSend({ type: 'Enter sketch' }),
    },
  ]
  toolbarConfig.onlyCancel.items = [
    {
      id: 'cancel',
      title: 'Cancel',
      status: 'available',
      links: [],
      onClick: ({ modelingSend }) => modelingSend({ type: 'Cancel' }),
    },
  ]
  const host: ModelingMachineToolbarHost = {
    toolbarConfig,
    registeredCommands: [],
    activeDialogCommandKey: undefined,
    keymapTree: { items: [], root: { children: new Map(), items: [] } },
    keymapScopes: [],
    platform: '',
    wasmInstance: input.wasmInstance,
    ast: createEmptyAst(),
    artifactGraph: new Map(),
    editorHasFocus: false,
    execute: vi.fn(async () => {}),
    toasts: [],
  }
  function View({ disabled = false }: { disabled?: boolean }) {
    const snapshot = actor.getSnapshot()
    return (
      <ModelingMachineToolbar
        state={snapshot}
        context={snapshot.context}
        send={(event) => actor.send(event)}
        actor={actor}
        isExecuting={disabled}
        disableModelingForUnrenderedChanges={false}
        overallState={NetworkHealthState.Ok}
        immediateState={{
          type: EngineConnectionStateType.ConnectionEstablished,
        }}
        isStreamReady
        isStreamAcceptingInput
        host={host}
      />
    )
  }
  return { actor, host, View }
}

it('uses the supplied machine for awaiting-target and cancel toolbars without touching a sibling or global context', async () => {
  const first = await fixture(),
    second = await fixture()
  try {
    const view = render(
      <>
        <section aria-label="First">
          <first.View />
        </section>
        <section aria-label="Second">
          <second.View />
        </section>
      </>
    )
    const a = within(screen.getByRole('region', { name: 'First' })),
      b = within(screen.getByRole('region', { name: 'Second' }))
    fireEvent.click(a.getByRole('button', { name: 'Start Sketch' }))
    expect(first.actor.getSnapshot().matches('Sketch no face')).toBe(true)
    expect(second.actor.getSnapshot().matches('idle')).toBe(true)
    view.rerender(
      <>
        <section aria-label="First">
          <first.View />
        </section>
        <section aria-label="Second">
          <second.View />
        </section>
      </>
    )
    expect(
      a.getByText('Select a plane or face to start sketching.')
    ).toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Start Sketch' })).toBeEnabled()
    fireEvent.click(a.getByRole('button', { name: 'Cancel' }))
    expect(first.actor.getSnapshot().matches('idle')).toBe(true)
    act(() =>
      second.actor.send({
        type: 'show non-visual constraints changed',
        data: { value: true },
      })
    )
    expect(first.actor.getSnapshot().context.showNonVisualConstraints).toBe(
      false
    )
  } finally {
    first.actor.stop()
    second.actor.stop()
  }
})

it('uses supplied execution readiness and command configuration when rerendered', async () => {
  const f = await fixture()
  try {
    const view = render(<f.View disabled />)
    expect(screen.getByRole('button', { name: 'Start Sketch' })).toBeDisabled()
    view.rerender(<f.View />)
    expect(screen.getByRole('button', { name: 'Start Sketch' })).toBeEnabled()
    f.host.toolbarConfig = {
      ...f.host.toolbarConfig,
      modeling: { ...f.host.toolbarConfig.modeling, items: [] },
    }
    view.rerender(<f.View />)
    expect(
      screen.queryByRole('button', { name: 'Start Sketch' })
    ).not.toBeInTheDocument()
  } finally {
    f.actor.stop()
  }
})
