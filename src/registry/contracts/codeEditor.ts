import type { ComponentType } from 'react'
import type { App } from '@src/lib/app'
import { defineContract, defineValueSpec } from '@kittycad/registry'

export interface CodeEditorHeaderItemProps {
  className: string
  app: App
}

export interface CodeEditorHeaderItem {
  id: string
  order?: number
  Component: ComponentType<CodeEditorHeaderItemProps>
}

const sortByOrderProperty = (inputs: readonly CodeEditorHeaderItem[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const codeEditorContract = defineContract({
  codeEditorHeaderItemsValueSpec: defineValueSpec<
    CodeEditorHeaderItem,
    CodeEditorHeaderItem[]
  >({
    name: 'code-editor-header-items',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { codeEditorHeaderItemsValueSpec } = codeEditorContract
