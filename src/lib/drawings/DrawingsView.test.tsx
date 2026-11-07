import '@src/lib/projectSession/next/testFeature'
import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import type { KclValueView } from '@rust/kcl-lib/bindings/KclValueView'
import { DrawingsView } from '@src/lib/drawings/DrawingsView'
import { createDrawingsExecutorCapability } from '@src/lib/drawings/executor'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'

function sheet(size: string, width: number, height: number): KclValueView {
  const length = (value: number): KclValueView => ({
    type: 'Number',
    value,
    ty: { type: 'Known', value: { type: 'Length', value: 'mm' } },
  })
  return {
    type: 'Object',
    constrainable: false,
    value: {
      size: { type: 'Enum', enum_name: 'PaperSize', variant: size },
      width: length(width),
      height: length(height),
    },
  }
}
let registry: Registry
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(() => {
  cleanup()
  registry?.[Symbol.dispose]()
})

it('shows evaluated sheets as tabs and recovers when an edit removes the selected sheet', async () => {
  const capability = createDrawingsExecutorCapability(
    async (contents): Promise<Record<string, KclValueView>> =>
      contents === 'two sheets'
        ? {
            detail: sheet('A4', 210, 297),
            assembly: sheet('Letter', 215.9, 279.4),
            unrelated: { type: 'String', value: 'not a drawing' },
          }
        : contents === 'one sheet'
          ? { detail: sheet('A3', 297, 420) }
          : {}
  )
  registry = new Registry()
  registry.configure([
    editorsExtension,
    executorsExtension,
    defineRegistryItem({
      provides: [
        provide(executorCapabilityValueSpec, capability),
        provide(executorCapabilityValueSpec, {
          id: 'waiting-for-engine',
          matches: '.kcl',
          execute: () => new Promise(() => {}),
        }),
      ],
    }),
  ])
  const editor = registry
    .get(editorsService)
    .openEditor('/main.kcl', 'two sheets')
  const executor = registry.get(executorsService).createExecutor(editor)
  render(<DrawingsView executor={executor} capability={capability} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'assembly' }))
  expect(
    screen.getByRole('img', { name: 'assembly - Letter drawing sheet' })
  ).toHaveStyle({
    width: `${(215.9 * 96) / 25.4}px`,
    height: `${(279.4 * 96) / 25.4}px`,
  })
  expect(
    screen.queryByRole('tab', { name: 'unrelated' })
  ).not.toBeInTheDocument()
  act(() =>
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'one sheet',
      },
    })
  )
  expect(
    await screen.findByRole('img', { name: 'detail - A3 drawing sheet' })
  ).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: 'assembly' })
  ).not.toBeInTheDocument()
  act(() =>
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '' },
    })
  )
  expect(
    await screen.findByText(/No drawing sheets in this file/)
  ).toBeVisible()
})
