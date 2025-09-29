import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
} from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { Diagnostic } from '@codemirror/lint'
import { forEachDiagnostic, setDiagnosticsEffect } from '@codemirror/lint'
import {
  Annotation,
  EditorSelection,
  EditorState,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import type { StateFrom } from 'xstate'

import { historyCompartment } from '@src/editor/compartments'
import {
  addLineHighlight,
  addLineHighlightEvent,
} from '@src/editor/highlightextension'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import { isTopLevelModule } from '@src/lang/util'
import { markOnce } from '@src/lib/performance'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { kclEditorActor } from '@src/machines/kclEditorMachine'
import type {
  ModelingMachineEvent,
  modelingMachine,
} from '@src/machines/modelingMachine'
import type { SelectionRange } from '@codemirror/state'
import type { ArtifactGraph, Program } from '@src/lang/wasm'
import type { WebSocketRequest } from '@kittycad/lib'

declare global {
  interface Window {
    EditorSelection: typeof EditorSelection
    EditorView: typeof EditorView
  }
}

// We need to be able to create these during tests dynamically (via
// page.evaluate) So that's why this exists.
window.EditorSelection = EditorSelection
window.EditorView = EditorView

const updateOutsideEditorAnnotation = Annotation.define<boolean>()
export const updateOutsideEditorEvent = updateOutsideEditorAnnotation.of(true)

const modelingMachineAnnotation = Annotation.define<boolean>()
export const modelingMachineEvent = modelingMachineAnnotation.of(true)

const setDiagnosticsAnnotation = Annotation.define<boolean>()
export const setDiagnosticsEvent = setDiagnosticsAnnotation.of(true)

export default class EditorManager {
  private _copilotEnabled: boolean = true
  private engineCommandManager: EngineCommandManager

  private _isAllTextSelected: boolean = false
  private _isShiftDown: boolean = false
  private _selectionRanges: Selections = {
    otherSelections: [],
    graphSelections: [],
  }

  private _lastEvent: { event: string; time: number } | null = null

  private _modelingSend: (eventInfo: ModelingMachineEvent) => void = () => {}
  private _modelingState: StateFrom<typeof modelingMachine> | null = null

  private _convertToVariableEnabled: boolean = false
  private _convertToVariableCallback: () => void = () => {}

  private _highlightRange: Array<[number, number]> = [[0, 0]]

  private _editorState: EditorState
  private _editorView: EditorView | null = null
  public kclManager?: KclManager
  public codeManager?: CodeManager

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager

    this._editorState = EditorState.create({
      doc: '',
      extensions: [
        historyCompartment.of(history()),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
    })
  }

  get editorState(): EditorState {
    return this._editorView?.state || this._editorState
  }
  get state() {
    return this.editorState
  }

  setCopilotEnabled(enabled: boolean) {
    this._copilotEnabled = enabled
  }

  get copilotEnabled(): boolean {
    return this._copilotEnabled
  }

  // Invoked when editorView is created and each time when it is updated (eg. user is sketching)..
  setEditorView(editorView: EditorView | null) {
    // Update editorState to the latest editorView state.
    // This is needed because if kcl pane is closed, editorView will become null but we still want to use the last state.
    this._editorState = editorView?.state || this._editorState

    this._editorView = editorView

    kclEditorActor.send({
      type: 'setKclEditorMounted',
      data: Boolean(editorView),
    })
    this.overrideTreeHighlighterUpdateForPerformanceTracking()
  }

  getEditorView(): EditorView | null {
    return this._editorView
  }

  overrideTreeHighlighterUpdateForPerformanceTracking() {
    // @ts-ignore
    this._editorView?.plugins.forEach((e) => {
      let sawATreeDiff = false

      // we cannot use <>.constructor.name since it will get destroyed
      // when packaging the application.
      const isTreeHighlightPlugin =
        e?.value &&
        e.value?.hasOwnProperty('tree') &&
        e.value?.hasOwnProperty('decoratedTo') &&
        e.value?.hasOwnProperty('decorations')

      if (isTreeHighlightPlugin) {
        let originalUpdate = e.value.update
        // @ts-ignore
        function performanceTrackingUpdate(args) {
          /**
           * TreeHighlighter.update will be called multiple times on start up.
           * We do not want to track the highlight performance of an empty update.
           * mark the syntax highlight one time when the new tree comes in with the
           * initial code
           */
          const treeIsDifferent =
            // @ts-ignore
            !sawATreeDiff && this.tree !== syntaxTree(args.state)
          if (treeIsDifferent && !sawATreeDiff) {
            markOnce('code/willSyntaxHighlight')
          }
          // Call the original function
          // @ts-ignore
          originalUpdate.apply(this, [args])
          if (treeIsDifferent && !sawATreeDiff) {
            markOnce('code/didSyntaxHighlight')
            sawATreeDiff = true
          }
        }
        e.value.update = performanceTrackingUpdate
      }
    })
  }

  get isAllTextSelected() {
    return this._isAllTextSelected
  }

  get isShiftDown(): boolean {
    return this._isShiftDown
  }

  setIsShiftDown(isShiftDown: boolean) {
    this._isShiftDown = isShiftDown
  }

  private selectionsWithSafeEnds(
    selection: Array<Selection['codeRef']['range']>
  ): Array<[number, number]> {
    if (!this._editorView) {
      return selection.filter(isTopLevelModule).map((s): [number, number] => {
        return [s[0], s[1]]
      })
    }

    return selection.filter(isTopLevelModule).map((s): [number, number] => {
      const safeEnd = Math.min(s[1], this._editorView?.state.doc.length || s[1])
      return [s[0], safeEnd]
    })
  }

  set selectionRanges(selectionRanges: Selections) {
    this._selectionRanges = selectionRanges
  }

  set modelingSend(send: (eventInfo: ModelingMachineEvent) => void) {
    this._modelingSend = send
  }

  set modelingState(state: StateFrom<typeof modelingMachine>) {
    this._modelingState = state
  }

  get highlightRange(): Array<[number, number]> {
    return this._highlightRange
  }

  setHighlightRange(range: Array<Selection['codeRef']['range']>): void {
    const selectionsWithSafeEnds = this.selectionsWithSafeEnds(range)

    this._highlightRange = selectionsWithSafeEnds

    if (this._editorView) {
      this._editorView.dispatch({
        effects: addLineHighlight.of(selectionsWithSafeEnds),
        annotations: [
          updateOutsideEditorEvent,
          addLineHighlightEvent,
          Transaction.addToHistory.of(false),
        ],
      })
    }
  }

  /**
   * Given an array of Diagnostics remove any duplicates by hashing a key
   * in the format of from + ' ' + to + ' ' + message.
   */
  makeUniqueDiagnostics(duplicatedDiagnostics: Diagnostic[]): Diagnostic[] {
    const uniqueDiagnostics: Diagnostic[] = []
    const seenDiagnostic: { [key: string]: boolean } = {}

    duplicatedDiagnostics.forEach((diagnostic: Diagnostic) => {
      const hash = `${diagnostic.from} ${diagnostic.to} ${diagnostic.message}`
      if (!seenDiagnostic[hash]) {
        uniqueDiagnostics.push(diagnostic)
        seenDiagnostic[hash] = true
      }
    })

    return uniqueDiagnostics
  }

  setDiagnostics(diagnostics: Diagnostic[]): void {
    if (!this._editorView) return
    // Clear out any existing diagnostics that are the same.
    diagnostics = this.makeUniqueDiagnostics(diagnostics)

    this._editorView.dispatch({
      effects: [setDiagnosticsEffect.of(diagnostics)],
      annotations: [
        setDiagnosticsEvent,
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  /**
   * Scroll to the first selection in the editor.
   */
  scrollToSelection() {
    if (!this._editorView || !this._selectionRanges.graphSelections[0]) return

    const firstSelection = this._selectionRanges.graphSelections[0]

    this._editorView.focus()
    this._editorView.dispatch({
      effects: [
        EditorView.scrollIntoView(
          EditorSelection.range(
            firstSelection.codeRef.range[0],
            firstSelection.codeRef.range[1]
          ),
          { y: 'center' }
        ),
      ],
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  scrollToFirstErrorDiagnosticIfExists() {
    if (!this._editorView) return

    let firstDiagnosticPos: [number, number] | null = null
    forEachDiagnostic(
      this._editorView.state,
      (d: Diagnostic, from: number, to: number) => {
        if (!firstDiagnosticPos && d.severity === 'error') {
          firstDiagnosticPos = [from, to]
        }
      }
    )

    if (!firstDiagnosticPos) return

    this._editorView.focus()
    this._editorView.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(firstDiagnosticPos[0]),
      ]),
      effects: [
        EditorView.scrollIntoView(
          EditorSelection.range(firstDiagnosticPos[0], firstDiagnosticPos[1])
        ),
      ],
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  undo() {
    if (this._editorView) {
      undo(this._editorView)
    } else if (this._editorState) {
      const undoPerformed = undo(this) // invokes dispatch which updates this._editorState
      if (undoPerformed) {
        const newState = this._editorState
        // Update the code, this is similar to kcl/index.ts / update, updateDoc,
        // needed to update the code, so sketch segments can update themselves.
        // In the editorView case this happens within the kcl plugin's update method being called during updates.
        this.codeManager!.code = newState.doc.toString()
        void this.kclManager!.executeCode()
      }
    }
  }

  redo() {
    if (this._editorView) {
      redo(this._editorView)
    } else if (this._editorState) {
      const redoPerformed = redo(this)
      if (redoPerformed) {
        const newState = this._editorState
        this.codeManager!.code = newState.doc.toString()
        void this.kclManager!.executeCode()
      }
    }
  }

  // Invoked by codeMirror during undo/redo.
  // Call with incorrect "this" so it needs to be an arrow function.
  dispatch = (spec: TransactionSpec) => {
    if (this._editorView) {
      this._editorView.dispatch(spec)
    } else if (this._editorState) {
      this._editorState = this._editorState.update(spec).state
    }
  }

  set convertToVariableEnabled(enabled: boolean) {
    this._convertToVariableEnabled = enabled
  }

  set convertToVariableCallback(callback: () => void) {
    this._convertToVariableCallback = callback
  }

  convertToVariable() {
    if (this._convertToVariableEnabled) {
      this._convertToVariableCallback()

      return true
    }
    return false
  }

  selectRange(selections: Selections) {
    if (selections?.graphSelections?.length === 0) {
      return
    }

    if (!this._editorView) {
      return
    }
    const codeBaseSelections = this.createEditorSelection(selections)
    this._editorView.dispatch({
      selection: codeBaseSelections,
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  createEditorSelection(selections: Selections) {
    let codeBasedSelections = []

    // Handle empty graphSelections array to avoid runtime errors
    if (selections.graphSelections.length === 0) {
      const defaultCursor = EditorSelection.cursor(
        this._editorView?.state.doc.length || 0
      )
      return EditorSelection.create([defaultCursor], 0)
    }

    for (const selection of selections.graphSelections) {
      const safeEnd = Math.min(
        selection.codeRef.range[1],
        this._editorView?.state.doc.length || selection.codeRef.range[1]
      )
      codeBasedSelections.push(
        EditorSelection.range(selection.codeRef.range[0], safeEnd)
      )
    }

    const end =
      selections.graphSelections[selections.graphSelections.length - 1].codeRef
        .range[1]
    const safeEnd = Math.min(end, this._editorView?.state.doc.length || end)
    codeBasedSelections.push(EditorSelection.cursor(safeEnd))
    return EditorSelection.create(codeBasedSelections, 1)
  }

  // We will ONLY get here if the user called a select event.
  // This is handled by the code mirror kcl plugin.
  // If you call this function from somewhere else, you best know wtf you are
  // doing. (jess)
  handleOnViewUpdate(
    viewUpdate: ViewUpdate,
    processCodeMirrorRanges: ({
      codeMirrorRanges,
      selectionRanges,
      isShiftDown,
      ast,
      artifactGraph,
    }: {
      codeMirrorRanges: readonly SelectionRange[]
      selectionRanges: Selections
      isShiftDown: boolean
      ast: Program
      artifactGraph: ArtifactGraph
    }) => null | {
      modelingEvent: ModelingMachineEvent
      engineEvents: WebSocketRequest[]
    }
  ): void {
    if (!this._editorView) {
      this.setEditorView(viewUpdate.view)
    }

    const ranges = viewUpdate?.state?.selection?.ranges || []
    if (ranges.length === 0) {
      return
    }

    if (!this._modelingState) {
      return
    }

    if (this._modelingState.matches({ Sketch: 'Change Tool' })) {
      return
    }

    this._isAllTextSelected = viewUpdate.state.selection.ranges.some(
      (selection) => {
        return (
          // The user will need to select the empty new lines as well to be considered all of the text.
          // CTRL+A is the best way to select all the text
          selection.from === 0 && selection.to === viewUpdate.state.doc.length
        )
      }
    )

    if (!this.kclManager) {
      console.error('unreachable')
      return
    }

    const eventInfo = processCodeMirrorRanges({
      codeMirrorRanges: viewUpdate.state.selection.ranges,
      selectionRanges: this._selectionRanges,
      isShiftDown: this._isShiftDown,
      ast: this.kclManager.ast,
      artifactGraph: this.kclManager.artifactGraph,
    })

    if (!eventInfo) {
      return
    }

    const deterministicEventInfo = {
      ...eventInfo,
      engineEvents: eventInfo.engineEvents.map((e) => ({
        ...e,
        cmd_id: 'static',
      })),
    }
    const stringEvent = JSON.stringify(deterministicEventInfo)
    if (
      this._lastEvent &&
      stringEvent === this._lastEvent.event &&
      Date.now() - this._lastEvent.time < 500
    ) {
      return // don't repeat events
    }

    this._lastEvent = { event: stringEvent, time: Date.now() }
    this._modelingSend(eventInfo.modelingEvent)
    eventInfo.engineEvents.forEach((event) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.engineCommandManager.sendSceneCommand(event)
    })
  }
}
