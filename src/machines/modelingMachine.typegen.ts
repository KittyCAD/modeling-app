
  // This file was automatically generated. Edits will be overwritten

  export interface Typegen0 {
        '@@xstate/typegen': true;
        internalEvents: {
          "done.invoke.Create extrude": { type: "done.invoke.Create extrude"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.Create fillet": { type: "done.invoke.Create fillet"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.Create line": { type: "done.invoke.Create line"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.Create sketch": { type: "done.invoke.Create sketch"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"error.platform.Create extrude": { type: "error.platform.Create extrude"; data: unknown };
"error.platform.Create fillet": { type: "error.platform.Create fillet"; data: unknown };
"error.platform.Create line": { type: "error.platform.Create line"; data: unknown };
"error.platform.Create sketch": { type: "error.platform.Create sketch"; data: unknown };
"xstate.init": { type: "xstate.init" };
        };
        invokeSrcNameMap: {
          "createExtrude": "done.invoke.Create extrude";
"createFillet": "done.invoke.Create fillet";
"createLine": "done.invoke.Create line";
"createSketch": "done.invoke.Create sketch";
        };
        missingImplementations: {
          actions: "Make selection horizontal" | "Make selection vertical" | "Modify AST" | "Update code selection cursors";
          delays: never;
          guards: "Can make selection horizontal" | "Can make selection vertical" | "Selection contains axis" | "Selection contains edge" | "Selection contains face" | "Selection contains line" | "Selection contains point" | "Selection is empty" | "Selection is not empty" | "Selection is one face" | "Selection is one or more edges";
          services: "createExtrude" | "createFillet" | "createLine" | "createSketch";
        };
        eventsCausingActions: {
          "Add to code-based selection": "Deselect point" | "Deselect segment" | "Select all" | "Select edge" | "Select face" | "Select point" | "Select segment";
"Add to other selection": "Select axis";
"Clear selection": "Deselect all" | "done.invoke.Create extrude" | "done.invoke.Create fillet";
"Make selection horizontal": "Make segment horizontal";
"Make selection vertical": "Make segment vertical";
"Modify AST": "Add point" | "Complete line" | "done.invoke.Create extrude" | "done.invoke.Create fillet";
"Remove from code-based selection": "Deselect edge" | "Deselect face" | "Deselect point";
"Remove from other selection": "Deselect axis";
"Set selection": "Set selection";
"Update code selection cursors": "Add point" | "Complete line" | "Deselect all" | "Deselect axis" | "Deselect edge" | "Deselect face" | "Deselect point" | "Deselect segment" | "Select edge" | "Select face" | "Select point" | "Select segment";
        };
        eventsCausingDelays: {
          
        };
        eventsCausingGuards: {
          "Can make selection horizontal": "Make segment horizontal";
"Can make selection vertical": "Make segment vertical";
"Selection contains axis": "Deselect axis";
"Selection contains edge": "Deselect edge";
"Selection contains face": "Deselect face";
"Selection contains line": "Deselect segment";
"Selection contains point": "Deselect point";
"Selection is empty": "Equip extrude" | "Equip fillet";
"Selection is not empty": "Deselect all";
"Selection is one face": "Enter sketch" | "Equip extrude";
"Selection is one or more edges": "Equip fillet";
        };
        eventsCausingServices: {
          "createExtrude": "Equip extrude";
"createFillet": "Equip fillet";
"createLine": "Equip line tool";
"createSketch": "Enter sketch" | "Select face";
        };
        matchesStates: "Extrude" | "Extrude.Idle" | "Extrude.Ready" | "Extrude.Selection Ready" | "Fillet" | "Fillet.Idle" | "Fillet.Ready" | "Fillet.Selection Ready" | "Sketch" | "Sketch no face" | "Sketch.Idle" | "Sketch.Line Tool" | "Sketch.Line Tool.Done" | "Sketch.Line Tool.No Points" | "Sketch.Line Tool.Point Added" | "Sketch.Line Tool.Segment Added" | "idle" | { "Extrude"?: "Idle" | "Ready" | "Selection Ready";
"Fillet"?: "Idle" | "Ready" | "Selection Ready";
"Sketch"?: "Idle" | "Line Tool" | { "Line Tool"?: "Done" | "No Points" | "Point Added" | "Segment Added"; }; };
        tags: never;
      }
  