import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorSelection, Annotation, Transaction } from '@codemirror/state'
import { engineCommandManager } from 'lib/singletons'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { Selections, processCodeMirrorRanges, Selection } from 'lib/selections'
import { undo, redo } from '@codemirror/commands'
import { CommandBarMachineEvent } from 'machines/commandBarMachine'
import { addLineHighlight, addLineHighlightEvent } from './highlightextension'
import { Diagnostic, setDiagnosticsEffect } from '@codemirror/lint'

const updateOutsideEditorAnnotation = Annotation.define<boolean>()
export const updateOutsideEditorEvent = updateOutsideEditorAnnotation.of(true)

const modelingMachineAnnotation = Annotation.define<boolean>()
export const modelingMachineEvent = modelingMachineAnnotation.of(true)

const setDiagnosticsAnnotation = Annotation.define<boolean>()
export const setDiagnosticsEvent = setDiagnosticsAnnotation.of(true)

function diagnosticIsEqual(d1: Diagnostic, d2: Diagnostic): boolean {
  return d1.from === d2.from && d1.to === d2.to && d1.message === d2.message
}

export default class EditorManager {
  private _editorView: EditorView | null = null
  private _copilotEnabled: boolean = true

  private _isShiftDown: boolean = false
  private _selectionRanges: Selections = {
    otherSelections: [],
    codeBasedSelections: [],
  }

  private _lastEvent: { event: string; time: number } | null = null

  private _modelingSend: (eventInfo: ModelingMachineEvent) => void = () => {}
  private _modelingEvent: ModelingMachineEvent | null = null

  private _commandBarSend: (eventInfo: CommandBarMachineEvent) => void =
    () => {}

  private _convertToVariableEnabled: boolean = false
  private _convertToVariableCallback: () => void = () => {}

  private _highlightRange: [number, number] = [0, 0]

  setCopilotEnabled(enabled: boolean) {
    this._copilotEnabled = enabled
  }

  get copilotEnabled(): boolean {
    return this._copilotEnabled
  }

  setEditorView(editorView: EditorView) {
    this._editorView = editorView
  }

  get editorView(): EditorView | null {
    return this._editorView
  }

  get isShiftDown(): boolean {
    return this._isShiftDown
  }

  setIsShiftDown(isShiftDown: boolean) {
    this._isShiftDown = isShiftDown
  }

  set selectionRanges(selectionRanges: Selections) {
    this._selectionRanges = selectionRanges
  }

  set modelingSend(send: (eventInfo: ModelingMachineEvent) => void) {
    this._modelingSend = send
  }

  set modelingEvent(event: ModelingMachineEvent) {
    this._modelingEvent = event
  }

  setCommandBarSend(send: (eventInfo: CommandBarMachineEvent) => void) {
    this._commandBarSend = send
  }

  commandBarSend(eventInfo: CommandBarMachineEvent): void {
    return this._commandBarSend(eventInfo)
  }

  get highlightRange(): [number, number] {
    return this._highlightRange
  }

  setHighlightRange(selection: Selection['range']): void {
    this._highlightRange = selection
    const safeEnd = Math.min(
      selection[1],
      this._editorView?.state.doc.length || selection[1]
    )
    if (this._editorView) {
      this._editorView.dispatch({
        effects: addLineHighlight.of([selection[0], safeEnd]),
        annotations: [
          updateOutsideEditorEvent,
          addLineHighlightEvent,
          Transaction.addToHistory.of(false),
        ],
      })
    }
  }

  setDiagnostics(diagnostics: Diagnostic[]): void {
    if (!this._editorView) return
    // Clear out any existing diagnostics that are the same.
    for (const diagnostic of diagnostics) {
      for (const otherDiagnostic of diagnostics) {
        if (diagnosticIsEqual(diagnostic, otherDiagnostic)) {
          diagnostics = diagnostics.filter(
            (d) => !diagnosticIsEqual(d, diagnostic)
          )
          diagnostics.push(diagnostic)
          break
        }
      }
    }

    this._editorView.dispatch({
      effects: [setDiagnosticsEffect.of(diagnostics)],
      annotations: [
        setDiagnosticsEvent,
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  undo() {
    if (this._editorView) {
      undo(this._editorView)
    }
  }

  redo() {
    if (this._editorView) {
      redo(this._editorView)
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
    if (selections.codeBasedSelections.length === 0) {
      return
    }
    let codeBasedSelections = []
    for (const selection of selections.codeBasedSelections) {
      codeBasedSelections.push(
        EditorSelection.range(selection.range[0], selection.range[1])
      )
    }

    codeBasedSelections.push(
      EditorSelection.cursor(
        selections.codeBasedSelections[
          selections.codeBasedSelections.length - 1
        ].range[1]
      )
    )

    if (!this._editorView) {
      return
    }

    this._editorView.dispatch({
      selection: EditorSelection.create(codeBasedSelections, 1),
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }

  // We will ONLY get here if the user called a select event.
  // This is handled by the code mirror kcl plugin.
  // If you call this function from somewhere else, you best know wtf you are
  // doing. (jess)
  handleOnViewUpdate(viewUpdate: ViewUpdate): void {
    if (!this._editorView) {
      this.setEditorView(viewUpdate.view)
    }

    const ranges = viewUpdate?.state?.selection?.ranges || []
    if (ranges.length === 0) {
      return
    }

    const ignoreEvents: ModelingMachineEvent['type'][] = ['change tool']

    if (!this._modelingEvent) {
      return
    }

    if (ignoreEvents.includes(this._modelingEvent.type)) {
      return
    }

    const eventInfo = processCodeMirrorRanges({
      codeMirrorRanges: viewUpdate.state.selection.ranges,
      selectionRanges: this._selectionRanges,
      isShiftDown: this._isShiftDown,
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
    eventInfo.engineEvents.forEach((event) =>
      engineCommandManager.sendSceneCommand(event)
    )
  }
}
