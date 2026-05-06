import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'
import type { App } from '@src/lib/app'
import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'

export interface CodeEditorHeaderItemProps {
  className: string
  app: App
}

export interface CodeEditorHeaderItem {
  id: string
  order?: number
  Component: ComponentType<CodeEditorHeaderItemProps>
}

export interface CodeEditorExecutionService {
  readonly hasEditsSinceLastExecution: ReadonlySignal<boolean>
  executeCode(): Promise<void>
}

const sortByOrderProperty = (inputs: readonly CodeEditorHeaderItem[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const codeEditorContract = defineContract({
  codeEditorExecutionService: defineService<CodeEditorExecutionService>(
    'code-editor-execution'
  ),
  codeEditorHeaderItemsValueSpec: defineValueSpec<
    CodeEditorHeaderItem,
    CodeEditorHeaderItem[]
  >({
    name: 'code-editor-header-items',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { codeEditorExecutionService, codeEditorHeaderItemsValueSpec } =
  codeEditorContract
