// This file was automatically generated. Edits will be overwritten

export interface Typegen0 {
  '@@xstate/typegen': true
  internalEvents: {
    'done.invoke.Create extrude': {
      type: 'done.invoke.Create extrude'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.Create fillet': {
      type: 'done.invoke.Create fillet'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.Create line': {
      type: 'done.invoke.Create line'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.Create sketch': {
      type: 'done.invoke.Create sketch'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'error.platform.Create extrude': {
      type: 'error.platform.Create extrude'
      data: unknown
    }
    'error.platform.Create fillet': {
      type: 'error.platform.Create fillet'
      data: unknown
    }
    'error.platform.Create line': {
      type: 'error.platform.Create line'
      data: unknown
    }
    'error.platform.Create sketch': {
      type: 'error.platform.Create sketch'
      data: unknown
    }
    'xstate.init': { type: 'xstate.init' }
  }
  invokeSrcNameMap: {
    createExtrude: 'done.invoke.Create extrude'
    createFillet: 'done.invoke.Create fillet'
    createLine: 'done.invoke.Create line'
    createSketch: 'done.invoke.Create sketch'
  }
  missingImplementations: {
    actions:
      | 'Add to selection'
      | 'Make selected line horizontal'
      | 'Remove from selection'
      | 'Update code selection cursors'
    delays: never
    guards:
      | 'Can make selection horizontal'
      | 'Can make selection vertical'
      | 'Selection contains edge'
      | 'Selection contains face'
      | 'Selection contains line'
      | 'Selection contains point'
      | 'Selection is empty'
      | 'Selection is not empty'
      | 'Selection is one face'
      | 'Selection is one or more edges'
    services: 'createExtrude' | 'createFillet' | 'createLine' | 'createSketch'
  }
  eventsCausingActions: {
    'Add to selection':
      | 'Select all'
      | 'Select edge'
      | 'Select face'
      | 'Select point'
    'Make selected line horizontal': 'Make line horizontal'
    'Remove from selection':
      | 'Deselect all'
      | 'Deselect edge'
      | 'Deselect face'
      | 'Deselect point'
    'Update code selection cursors': 'Make line horizontal'
  }
  eventsCausingDelays: {}
  eventsCausingGuards: {
    'Can make selection horizontal': 'Make line horizontal'
    'Can make selection vertical': 'Make segment vertical'
    'Selection contains edge': 'Deselect edge'
    'Selection contains face': 'Deselect face'
    'Selection contains line': 'Deselect line'
    'Selection contains point': 'Deselect point'
    'Selection is empty': 'Equip extrude' | 'Equip fillet'
    'Selection is not empty': 'Deselect all'
    'Selection is one face':
      | 'Enter sketch'
      | 'Equip Extrude Tool'
      | 'Equip extrude'
    'Selection is one or more edges': 'Equip fillet'
  }
  eventsCausingServices: {
    createExtrude: 'Equip extrude'
    createFillet: 'Equip fillet'
    createLine: 'Equip Line Tool'
    createSketch: 'Enter sketch' | 'Select face'
  }
  matchesStates:
    | 'Extrude'
    | 'Extrude.Idle'
    | 'Extrude.Ready'
    | 'Extrude.Selection Ready'
    | 'Fillet'
    | 'Fillet.Idle'
    | 'Fillet.Ready'
    | 'Fillet.Selection Ready'
    | 'Sketch'
    | 'Sketch no face'
    | 'Sketch.Extrude'
    | 'Sketch.Extrude.Idle'
    | 'Sketch.Extrude.Ready'
    | 'Sketch.Extrude.Selection Ready'
    | 'Sketch.Idle'
    | 'Sketch.Line Tool'
    | 'Sketch.Line Tool.Done'
    | 'Sketch.Line Tool.No Points'
    | 'Sketch.Line Tool.Point Added'
    | 'Sketch.Line Tool.Segment Added'
    | 'idle'
    | {
        Extrude?: 'Idle' | 'Ready' | 'Selection Ready'
        Fillet?: 'Idle' | 'Ready' | 'Selection Ready'
        Sketch?:
          | 'Extrude'
          | 'Idle'
          | 'Line Tool'
          | {
              Extrude?: 'Idle' | 'Ready' | 'Selection Ready'
              'Line Tool'?:
                | 'Done'
                | 'No Points'
                | 'Point Added'
                | 'Segment Added'
            }
      }
  tags: never
}
