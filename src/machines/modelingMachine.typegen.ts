
  // This file was automatically generated. Edits will be overwritten

  export interface Typegen0 {
        '@@xstate/typegen': true;
        internalEvents: {
          "done.invoke.Create line": { type: "done.invoke.Create line"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.Create sketch": { type: "done.invoke.Create sketch"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"error.platform.Create line": { type: "error.platform.Create line"; data: unknown };
"error.platform.Create sketch": { type: "error.platform.Create sketch"; data: unknown };
"xstate.init": { type: "xstate.init" };
        };
        invokeSrcNameMap: {
          "createLine": "done.invoke.Create line";
"createSketch": "done.invoke.Create sketch";
        };
        missingImplementations: {
          actions: "Add to selection" | "Make selected line horizontal" | "Remove from selection" | "Update code selection cursors";
          delays: never;
          guards: "Can make selection horizontal" | "Selection contains edge" | "Selection contains face" | "Selection contains line" | "Selection contains point" | "Selection is empty" | "Selection is not empty" | "Selection is one face";
          services: "createLine" | "createSketch";
        };
        eventsCausingActions: {
          "Add to selection": "Select all" | "Select edge" | "Select face" | "Select point";
"Make selected line horizontal": "Make line horizontal";
"Remove from selection": "Deselect all" | "Deselect edge" | "Deselect face" | "Deselect point";
"Update code selection cursors": "Make line horizontal";
        };
        eventsCausingDelays: {
          
        };
        eventsCausingGuards: {
          "Can make selection horizontal": "Make line horizontal";
"Selection contains edge": "Deselect edge";
"Selection contains face": "Deselect face";
"Selection contains line": "Deselect line";
"Selection contains point": "Deselect point";
"Selection is empty": "Equip extrude";
"Selection is not empty": "Deselect all";
"Selection is one face": "Enter sketch" | "Equip Extrude Tool" | "Equip extrude";
        };
        eventsCausingServices: {
          "createLine": "Equip Line Tool";
"createSketch": "Enter sketch" | "Select face";
        };
        matchesStates: "Extrude" | "Extrude.Idle" | "Extrude.Ready" | "Extrude.Selection Ready" | "Sketch" | "Sketch no face" | "Sketch.Extrude" | "Sketch.Extrude.Idle" | "Sketch.Extrude.Ready" | "Sketch.Extrude.Selection Ready" | "Sketch.Idle" | "Sketch.Line Tool" | "Sketch.Line Tool.Done" | "Sketch.Line Tool.Line Added" | "Sketch.Line Tool.No Points" | "Sketch.Line Tool.Point Added" | "idle" | { "Extrude"?: "Idle" | "Ready" | "Selection Ready";
"Sketch"?: "Extrude" | "Idle" | "Line Tool" | { "Extrude"?: "Idle" | "Ready" | "Selection Ready";
"Line Tool"?: "Done" | "Line Added" | "No Points" | "Point Added"; }; };
        tags: never;
      }
  