import type { Completion } from '@codemirror/autocomplete'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, tooltips } from '@codemirror/view'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { ReactNode } from 'react'
import { use, useEffect, useMemo, useRef } from 'react'

import { editorTheme } from '@src/editor/plugins/theme'
import { findAllPreviousVariables, getNodeFromPath } from '@src/lang/queryAst'
import type { SourceRange, VariableDeclarator } from '@src/lang/wasm'
import { formatNumberValue, isPathToNode } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { getResolvedTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import styles from './ModelingDialog.module.css'

export type KclCommandArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'kcl' }
>

export function getKclInputValue(
  arg: KclCommandArgument,
  value: unknown
): string {
  if (isKclCommandValue(value)) {
    return arg.kclValueToInput
      ? arg.kclValueToInput(value.valueText)
      : value.valueText
  }

  return typeof value === 'string' ? value : ''
}

export function getKclSubmitValue(
  arg: KclCommandArgument,
  value: string
): string {
  const trimmedValue = value.trim()
  return arg.inputToKclValue ? arg.inputToKclValue(trimmedValue) : trimmedValue
}

function getKclEditorContentAttributes(labelId: string, disabled: boolean) {
  return EditorView.contentAttributes.of({
    'aria-disabled': String(disabled),
    'aria-labelledby': labelId,
    'aria-multiline': 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  })
}

export function ModelingDialogKclInput({
  name,
  label,
  description,
  isRequired,
  disabled,
  value,
  commandBarContext,
  selectionRanges,
  onChange,
}: {
  name: string
  label: ReactNode
  description?: ReactNode
  isRequired: boolean
  disabled: boolean
  value: string
  commandBarContext: CommandBarContext
  selectionRanges: Selections
  onChange: (value: string) => void
}) {
  const { settings, wasmPromise } = useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(wasmPromise)
  const settingsValues = settings.useSettings()
  const inputId = `modeling-dialog-kcl-input-${name}`
  const labelId = `${inputId}-label`
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const compartmentsRef = useRef({
    theme: new Compartment(),
    varMentions: new Compartment(),
    setValue: new Compartment(),
    keymap: new Compartment(),
    editable: new Compartment(),
    contentAttributes: new Compartment(),
  })

  const sourceRangeForPrevVariables = useMemo<SourceRange | undefined>(() => {
    const nodeToEdit = commandBarContext.argumentsToSubmit.nodeToEdit
    const pathToNode = isPathToNode(nodeToEdit) ? nodeToEdit : undefined
    const node = pathToNode
      ? getNodeFromPath<Node<VariableDeclarator>>(
          kclManager.ast,
          pathToNode,
          wasmInstance
        )
      : undefined

    return !err(node) && node && node.node.type === 'VariableDeclarator'
      ? [node.node.start, node.node.end, node.node.moduleId]
      : undefined
  }, [
    commandBarContext.argumentsToSubmit.nodeToEdit,
    kclManager.ast,
    wasmInstance,
  ])

  const completionSourceRange = useMemo<SourceRange>(
    () =>
      sourceRangeForPrevVariables ||
      selectionRanges.graphSelections[0]?.codeRef?.range || [
        kclManager.codeSignal.value.length,
        kclManager.codeSignal.value.length,
      ],
    [
      kclManager.codeSignal.value.length,
      selectionRanges.graphSelections,
      sourceRangeForPrevVariables,
    ]
  )

  const prevVariables = useMemo(
    () =>
      findAllPreviousVariables(
        kclManager.astSignal.value,
        kclManager.variablesSignal.value,
        completionSourceRange,
        wasmInstance
      ).variables,
    [
      completionSourceRange,
      kclManager.astSignal.value,
      kclManager.variablesSignal.value,
      wasmInstance,
    ]
  )

  const varMentionData = useMemo<Completion[]>(
    () =>
      prevVariables.map((variable) => {
        const roundedWithUnits = (() => {
          if (typeof variable.value !== 'number' || !variable.ty) {
            return undefined
          }
          const numWithUnits = formatNumberValue(
            variable.value,
            variable.ty,
            wasmInstance
          )
          if (err(numWithUnits)) {
            return undefined
          }
          return roundOffWithUnits(numWithUnits)
        })()

        return {
          label: variable.key,
          detail: roundedWithUnits ?? String(roundOff(Number(variable.value))),
        }
      }),
    [prevVariables, wasmInstance]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: The editor instance is created once; changing inputs reconfigure compartments below.
  useEffect(() => {
    if (!editorWrapperRef.current) {
      return
    }

    const compartments = compartmentsRef.current
    const editor = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          compartments.theme.of(
            editorTheme[getResolvedTheme(settingsValues.app.theme.current)]
          ),
          compartments.varMentions.of(varMentions(varMentionData)),
          compartments.editable.of([
            EditorState.readOnly.of(disabled),
            EditorView.editable.of(!disabled),
          ]),
          compartments.contentAttributes.of(
            getKclEditorContentAttributes(labelId, disabled)
          ),
          compartments.setValue.of(
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChange(update.state.doc.toString())
              }
            })
          ),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap]),
          compartments.keymap.of(
            keymap.of([
              {
                key: 'Enter',
                run: (editorView) => {
                  if (completionStatus(editorView.state) !== null) {
                    return false
                  }
                  editorView.dom.closest('form')?.requestSubmit()
                  return true
                },
              },
            ])
          ),
          EditorView.lineWrapping,
          tooltips({ parent: document.body }),
        ],
      }),
      parent: editorWrapperRef.current,
    })

    editorRef.current = editor

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: compartmentsRef.current.theme.reconfigure(
        editorTheme[getResolvedTheme(settingsValues.app.theme.current)]
      ),
    })
  }, [settingsValues.app.theme])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: compartmentsRef.current.varMentions.reconfigure(
        varMentions(varMentionData)
      ),
    })
  }, [varMentionData])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    editorRef.current.dispatch({
      effects: [
        compartmentsRef.current.editable.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        compartmentsRef.current.contentAttributes.reconfigure(
          getKclEditorContentAttributes(labelId, disabled)
        ),
      ],
    })
  }, [disabled, labelId])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }

    const currentValue = editorRef.current.state.doc.toString()
    if (currentValue === value) {
      return
    }

    editorRef.current.dispatch({
      changes: {
        from: 0,
        to: editorRef.current.state.doc.length,
        insert: value,
      },
    })
  }, [value])

  return (
    <div
      className={['flex flex-col gap-1', disabled ? 'opacity-60' : ''].join(
        ' '
      )}
    >
      <span id={labelId} className="text-xs font-medium leading-tight">
        {label}
        {isRequired ? ' *' : ''}
      </span>
      <div
        ref={editorWrapperRef}
        id={inputId}
        data-testid={inputId}
        className={[
          styles.kclEditor,
          disabled ? styles.kclEditorDisabled : '',
        ].join(' ')}
      />
      {description}
    </div>
  )
}
