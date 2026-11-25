import '@src/lib/projectSession/next/testFeature'
import { Registry, contribute, provide } from 'plankton'
import { requireSuccess } from '@src/lib/editors/testViews'
import { acquireAutomaticExecution } from '@src/lib/executors/automatic'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import type { KclValueView } from '@rust/kcl-lib/bindings/KclValueView'
import { DrawingsView } from '@src/lib/drawings/DrawingsView'
import { createDrawingsExecutorCapability } from '@src/lib/drawings/executor'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityFacet,
  defineExecutorCapability,
  executorsService,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'

function sheet(
  size: string,
  width: number,
  height: number,
  unit: 'mm' | 'in' = 'mm'
): KclValueView {
  return {
    type: 'Sheet',
    value: {
      sizeSource: { kind: 'custom' },
      name: size,
      orientation: 'Portrait',
      width: {
        n: width,
        ty: { type: 'Known', value: { type: 'Length', value: unit } },
      },
      height: {
        n: height,
        ty: { type: 'Known', value: { type: 'Length', value: unit } },
      },
    },
  }
}
let registry: Registry
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(async () => {
  cleanup()
  await registry?.dispose()
})

it('shows evaluated sheets as tabs and recovers when an edit removes the selected sheet', async () => {
  const capability = createDrawingsExecutorCapability(
    async (contents): Promise<Record<string, KclValueView>> =>
      contents === 'two sheets'
        ? {
            detail: sheet('A4', 210, 297),
            assembly: sheet('Letter', 8.5, 11, 'in'),
            unrelated: { type: 'String', value: 'not a drawing' },
          }
        : contents === 'one sheet'
          ? { detail: sheet('A3', 297, 420) }
          : {}
  )
  const waiting = defineExecutorCapability({
    id: 'waiting-for-engine',
    matches: '.kcl',
    execute: () => new Promise<Record<string, unknown>>(() => {}),
  })
  registry = new Registry()
  await registry.configure([
    editorsExtension,
    executorsExtension,
    provide(fileOperationsService, testFileOperations),
    contribute(executorCapabilityFacet, () => capability),
    contribute(executorCapabilityFacet, () => waiting),
  ])
  const editor = requireSuccess(
    registry.required(editorsService).openEditor('/main.kcl', 'two sheets')
  )
  const executor = requireSuccess(
    registry.required(executorsService).createExecutor(editor)
  )
  const stop = acquireAutomaticExecution(executor, capability)
  void executor.run(waiting)

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
  stop()
})
