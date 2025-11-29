import type { Completion } from '@codemirror/autocomplete'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
} from '@codemirror/autocomplete'
import type { ViewUpdate } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { CustomIcon } from '@src/components/CustomIcon'
import { useCodeMirror } from '@src/components/layout/areas/CodeEditor'
import { Spinner } from '@src/components/Spinner'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { SourceRange, VariableDeclarator } from '@src/lang/wasm'
import { formatNumberValue, isPathToNode } from '@src/lang/wasm'
import type { CommandArgument, KclCommandValue } from '@src/lib/commandTypes'
import { kclManager } from '@src/lib/singletons'
import { useSettings } from '@src/lib/singletons'
import { commandBarActor, useCommandBarState } from '@src/lib/singletons'
import { getSystemTheme } from '@src/lib/theme'
import { err } from '@src/lib/trap'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { roundOff, roundOffWithUnits } from '@src/lib/utils'
import { varMentions } from '@src/lib/varCompletionExtension'

import { useModelingContext } from '@src/hooks/useModelingContext'
import styles from './CommandBarKclInput.module.css'

// TODO: remove the need for this selector once we decouple all actors from React
const machineContextSelector = (snapshot?: SnapshotFrom<AnyStateMachine>) =>
  snapshot?.context

function CommandBarKclInput({
  arg,
  stepBack,
  onSubmit,
  currentCode,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'kcl'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
  currentCode: string
}) {
  const commandBarState = useCommandBarState()
  const previouslySetValue = commandBarState.context.argumentsToSubmit[
    arg.name
  ] as KclCommandValue | undefined
  const settings = useSettings()
  const {
    context: { selectionRanges },
  } = useModelingContext()
  const argMachineContext = useSelector(
    arg.machineActor,
    machineContextSelector
  )
  const sourceRangeForPrevVariables = useMemo<SourceRange | undefined>(() => {
    const nodeToEdit = commandBarState.context.argumentsToSubmit.nodeToEdit
    const pathToNode = isPathToNode(nodeToEdit) ? nodeToEdit : undefined
    const node = pathToNode
      ? getNodeFromPath<Node<VariableDeclarator>>(kclManager.ast, pathToNode)
      : undefined
    return !err(node) && node && node.node.type === 'VariableDeclarator'
      ? [node.node.start, node.node.end, node.node.moduleId]
      : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.ast, commandBarState.context.argumentsToSubmit.nodeToEdit])
  const defaultValue = useMemo(
    () =>
      arg.defaultValue
        ? arg.defaultValue instanceof Function
          ? arg.defaultValue(commandBarState.context, argMachineContext)
          : arg.defaultValue
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [arg.defaultValue, commandBarState.context, argMachineContext]
  )
  const initialVariableName = useMemo(() => {
    // Use the configured variable name if it exists
    if (arg.variableName !== undefined) {
      return arg.variableName instanceof Function
        ? arg.variableName(commandBarState.context, argMachineContext)
        : arg.variableName
    }
    // or derive it from the previously set value or the argument name
    return typeof previouslySetValue === 'object' &&
      'variableName' in previouslySetValue
      ? previouslySetValue.variableName
      : arg.name
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    arg.variableName,
    commandBarState.context,
    argMachineContext,
    arg.name,
    previouslySetValue,
  ])
  const initialValue = useMemo(
    () => previouslySetValue?.valueText || defaultValue || '',
    [previouslySetValue, defaultValue]
  )
  const [value, setValue] = useState(initialValue)
  const [createNewVariable, setCreateNewVariable] = useState(
    (typeof previouslySetValue === 'object' &&
      'variableName' in previouslySetValue) ||
      arg.createVariable === 'byDefault' ||
      arg.createVariable === 'force' ||
      false
  )
  const [canSubmit, setCanSubmit] = useState(true)
  useHotkeyWrapper(
    ['mod + k', 'esc'],
    () => commandBarActor.send({ type: 'Close' }),
    { enableOnFormTags: true, enableOnContentEditable: true }
  )
  const editorRef = useRef<HTMLDivElement>(null)

  const allowArrays = arg.allowArrays ?? false

  const {
    calcResult,
    newVariableInsertIndex,
    valueNode,
    newVariableName,
    setNewVariableName,
    isNewVariableNameUnique,
    prevVariables,
    isExecuting,
  } = useCalculateKclExpression({
    value,
    initialVariableName,
    sourceRange: sourceRangeForPrevVariables,
    selectionRanges,
    allowArrays,
    code: currentCode,
  })

  const varMentionData: Completion[] = prevVariables.map((v) => {
    const roundedWithUnits = (() => {
      if (typeof v.value !== 'number' || !v.ty) {
        return undefined
      }
      const numWithUnits = formatNumberValue(v.value, v.ty)
      if (err(numWithUnits)) {
        return undefined
      }
      return roundOffWithUnits(numWithUnits)
    })()
    return {
      label: v.key,
      detail: roundedWithUnits ?? String(roundOff(Number(v.value))),
    }
  })
  const varMentionsExtension = varMentions(varMentionData)

  const { setContainer, view } = useCodeMirror({
    container: editorRef.current,
    initialDocValue: value,
    autoFocus: true,
    selection: {
      anchor: 0,
      head:
        typeof previouslySetValue === 'object' &&
        'valueText' in previouslySetValue
          ? previouslySetValue.valueText.length
          : defaultValue.length,
    },
    theme:
      settings.app.theme.current === 'system'
        ? getSystemTheme()
        : settings.app.theme.current,
    extensions: [
      varMentionsExtension,
      EditorView.updateListener.of((vu: ViewUpdate) => {
        if (vu.docChanged) {
          setValue(vu.state.doc.toString())
        }
      }),
      closeBrackets(),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        {
          key: 'Enter',
          run: (editor) => {
            // Only submit if there is no completion active
            if (completionStatus(editor.state) === null) {
              handleSubmit()
              return true
            } else {
              return false
            }
          },
        },
        {
          key: 'Meta-Backspace',
          run: () => {
            stepBack()
            return true
          },
        },
      ]),
    ],
  })

  useEffect(() => {
    if (editorRef.current) {
      setContainer(editorRef.current)
      // Reset the value when the arg changes and
      // the new arg is also a KCL type, since the component
      // sticks around.
      view?.focus()
      view?.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: initialValue,
        },
        selection: {
          anchor: 0,
          head: initialValue.length,
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [arg, editorRef])

  useEffect(() => {
    setCanSubmit(
      calcResult !== 'NAN' &&
        (!createNewVariable || isNewVariableNameUnique) &&
        !isExecuting
    )
  }, [calcResult, createNewVariable, isNewVariableNameUnique, isExecuting])

  function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!canSubmit || valueNode === null) {
      // Gotcha: Our application can attempt to submit a command value before the command bar kcl input is ready. Notify the scene and user.
      if (!canSubmit) {
        toast.error('Unable to submit command')
      } else if (valueNode === null) {
        toast.error('Unable to submit undefined command value')
      }
      return
    }

    onSubmit(
      createNewVariable
        ? ({
            valueAst: valueNode,
            valueText: value,
            valueCalculated: calcResult,
            variableName: newVariableName,
            insertIndex: newVariableInsertIndex,
            variableIdentifierAst: createLocalName(newVariableName),
            variableDeclarationAst: createVariableDeclaration(
              newVariableName,
              valueNode
            ),
          } satisfies KclCommandValue)
        : ({
            valueAst: valueNode,
            valueText: value,
            valueCalculated: calcResult,
          } satisfies KclCommandValue)
    )
  }

  return (
    <form
      id="arg-form"
      className="mb-2"
      onSubmit={handleSubmit}
      data-can-submit={canSubmit}
    >
      <label className="flex gap-4 items-center mx-4 my-4 border-solid border-b border-chalkboard-50">
        <span
          data-testid="cmd-bar-arg-name"
          className="capitalize text-chalkboard-80 dark:text-chalkboard-20"
        >
          {arg.displayName || arg.name}
        </span>
        <div
          data-testid="cmd-bar-arg-value"
          ref={editorRef}
          className={styles.editor}
        />
        <CustomIcon
          name="equal"
          className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
        />
        <span
          className={
            calcResult === 'NAN'
              ? 'text-destroy-80 dark:text-destroy-40'
              : 'text-succeed-80 dark:text-succeed-40'
          }
        >
          {isExecuting === true || !calcResult ? (
            <Spinner className="text-inherit w-4 h-4" />
          ) : calcResult === 'NAN' ? (
            "Can't calculate"
          ) : (
            roundOffWithUnits(calcResult, 4)
          )}
        </span>
      </label>
      {arg.createVariable !== 'disallow' && (
        <div className="flex items-baseline gap-4 mx-4">
          <input
            type="checkbox"
            id="variable-checkbox"
            data-testid="cmd-bar-variable-checkbox"
            checked={createNewVariable}
            onChange={(e) => {
              setCreateNewVariable(e.target.checked)
            }}
            className="bg-chalkboard-10 dark:bg-chalkboard-80"
          />
          <label
            htmlFor="variable-checkbox"
            className="text-blue border-none bg-transparent font-sm flex gap-1 items-center pl-0 pr-1"
          >
            Create new variable
          </label>
          {createNewVariable && (
            <>
              <input
                type="text"
                id="variable-name"
                name="variable-name"
                className="flex-1  border-solid border-0 border-b border-chalkboard-50 bg-transparent focus:outline-none"
                placeholder="Variable name"
                value={newVariableName}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck="false"
                autoFocus
                onChange={(e) => setNewVariableName(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.currentTarget.value === '' &&
                    e.key === 'Backspace' &&
                    arg.createVariable !== 'force'
                  ) {
                    setCreateNewVariable(false)
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === 'Enter' && canSubmit) {
                    handleSubmit()
                  }
                }}
              />
              <span
                className={
                  isNewVariableNameUnique
                    ? 'text-succeed-60 dark:text-succeed-40'
                    : 'text-destroy-60 dark:text-destroy-40'
                }
              >
                {isNewVariableNameUnique ? 'Available' : 'Unavailable'}
              </span>
            </>
          )}
        </div>
      )}
    </form>
  )
}

export default CommandBarKclInput
