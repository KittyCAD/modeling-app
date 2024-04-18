import { hasNextSnippetField } from '@codemirror/autocomplete'
import { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorSelection, SelectionRange } from '@codemirror/state'
import { engineCommandManager, sceneInfra } from 'lib/singletons'
import { ModelingMachineEvent } from 'machines/modelingMachine'
import { Selections, processCodeMirrorRanges, Selection } from 'lib/selections'
import { undo, redo } from '@codemirror/commands'
import { CommandBarMachineEvent } from 'machines/commandBarMachine'
import { addLineHighlight } from './highlightextension'
import { setDiagnostics, Diagnostic } from '@codemirror/lint'

export default class EditorManager {
  private _editorView: EditorView | null = null

  private _isShiftDown: boolean = false
  private _selectionRanges: Selections = {
    otherSelections: [],
    codeBasedSelections: [],
  }

  private _lastSelectionEvent: number | null = null
  private _lastSelection: string = ''
  private _lastEvent: { event: string; time: number } | null = null

  private _modelingSend: (eventInfo: ModelingMachineEvent) => void = () => {}
  private _modelingEvent: ModelingMachineEvent | null = null

  private _commandBarSend: (eventInfo: CommandBarMachineEvent) => void =
    () => {}

  private _convertToVariableEnabled: boolean = false
  private _convertToVariableCallback: () => void = () => {}

  private _highlightRange: [number, number] = [0, 0]

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

  set lastSelectionEvent(time: number) {
    this._lastSelectionEvent = time
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
    const editorView = this.editorView
    const safeEnd = Math.min(
      selection[1],
      editorView?.state.doc.length || selection[1]
    )
    if (editorView) {
      editorView.dispatch({
        effects: addLineHighlight.of([selection[0], safeEnd]),
      })
    }
  }

  setDiagnostics(diagnostics: Diagnostic[]): void {
    if (!this.editorView) return
    this.editorView.dispatch(setDiagnostics(this.editorView.state, diagnostics))
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
    if (!this.editorView) {
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
    this.editorView.dispatch({
      selection: EditorSelection.create(codeBasedSelections, 1),
    })
  }

  handleOnViewUpdate(viewUpdate: ViewUpdate): void {
    // If we are just fucking around in a snippet, return early and don't
    // trigger stuff below that might cause the component to re-render.
    // Otherwise we will not be able to tab thru the snippet portions.
    // We explicitly dont check HasPrevSnippetField because we always add
    // a ${} to the end of the function so that's fine.
    if (hasNextSnippetField(viewUpdate.view.state)) {
      return
    }

    if (this.editorView === null) {
      this.setEditorView(viewUpdate.view)
    }
    const selString = stringifyRanges(
      viewUpdate?.state?.selection?.ranges || []
    )

    if (selString === this._lastSelection) {
      // onUpdate is noisy and is fired a lot by extensions
      // since we're only interested in selections changes we can ignore most of these.
      return
    }
    this._lastSelection = selString

    if (
      this._lastSelectionEvent &&
      Date.now() - this._lastSelectionEvent < 150
    ) {
      return // update triggered by scene selection
    }

    if (sceneInfra.selected) {
      return // mid drag
    }

    const ignoreEvents: ModelingMachineEvent['type'][] = [
      'Equip Line tool',
      'Equip tangential arc to',
    ]

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

    console.log('eventInfo', eventInfo)

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

function stringifyRanges(ranges: readonly SelectionRange[]): string {
  return ranges.map(({ to, from }) => `${to}->${from}`).join('&')
}
