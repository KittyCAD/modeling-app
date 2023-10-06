
  // This file was automatically generated. Edits will be overwritten

  export interface Typegen0 {
        '@@xstate/typegen': true;
        internalEvents: {
          "": { type: "" };
"done.invoke.get-angle-info": { type: "done.invoke.get-angle-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-horizontal-info": { type: "done.invoke.get-horizontal-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-length-info": { type: "done.invoke.get-length-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-vertical-info": { type: "done.invoke.get-vertical-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"error.platform.get-angle-info": { type: "error.platform.get-angle-info"; data: unknown };
"error.platform.get-horizontal-info": { type: "error.platform.get-horizontal-info"; data: unknown };
"error.platform.get-length-info": { type: "error.platform.get-length-info"; data: unknown };
"error.platform.get-vertical-info": { type: "error.platform.get-vertical-info"; data: unknown };
"xstate.init": { type: "xstate.init" };
"xstate.stop": { type: "xstate.stop" };
        };
        invokeSrcNameMap: {
          "Get angle info": "done.invoke.get-angle-info";
"Get horizontal info": "done.invoke.get-horizontal-info";
"Get length info": "done.invoke.get-length-info";
"Get vertical info": "done.invoke.get-vertical-info";
        };
        missingImplementations: {
          actions: "AST add line segment" | "AST start new sketch" | "Modify AST" | "Set selection" | "Update code selection cursors" | "create path" | "set tool" | "show default planes" | "sketch exit execute" | "toast extrude failed";
          delays: never;
          guards: "Selection contains axis" | "Selection contains edge" | "Selection contains face" | "Selection contains line" | "Selection contains point" | "Selection is not empty" | "Selection is one face";
          services: "Get angle info" | "Get horizontal info" | "Get length info" | "Get vertical info";
        };
        eventsCausingActions: {
          "AST add line segment": "Add point";
"AST extrude": "" | "extrude intent";
"AST start new sketch": "Add point";
"Add to code-based selection": "Deselect point" | "Deselect segment" | "Select all" | "Select edge" | "Select face" | "Select point" | "Select segment";
"Add to other selection": "Select axis";
"Clear selection": "Deselect all";
"Constrain equal length": "Constrain equal length";
"Constrain horizontally align": "Constrain horizontally align";
"Constrain vertically align": "Constrain vertically align";
"Make selection horizontal": "Make segment horizontal";
"Make selection vertical": "Make segment vertical";
"Modify AST": "Complete line";
"Remove from code-based selection": "Deselect edge" | "Deselect face" | "Deselect point";
"Remove from other selection": "Deselect axis";
"Set selection": "Set selection" | "done.invoke.get-angle-info" | "done.invoke.get-horizontal-info" | "done.invoke.get-length-info" | "done.invoke.get-vertical-info";
"Update code selection cursors": "Complete line" | "Deselect all" | "Deselect axis" | "Deselect edge" | "Deselect face" | "Deselect point" | "Deselect segment" | "Select edge" | "Select face" | "Select point" | "Select segment";
"create path": "Select face";
"default_camera_disable_sketch_mode": "Cancel";
"edit mode enter": "Enter sketch";
"edit_mode_exit": "Cancel";
"equip select": "CancelSketch" | "Constrain equal length" | "Constrain horizontally align" | "Constrain vertically align" | "Deselect point" | "Deselect segment" | "Enter sketch" | "Make segment horizontal" | "Make segment vertical" | "Select face" | "Select point" | "Select segment" | "Set selection" | "done.invoke.get-angle-info" | "done.invoke.get-horizontal-info" | "done.invoke.get-length-info" | "done.invoke.get-vertical-info" | "error.platform.get-angle-info" | "error.platform.get-horizontal-info" | "error.platform.get-length-info" | "error.platform.get-vertical-info";
"hide default planes": "Cancel" | "Select face" | "xstate.stop";
"reset sketchPathToNode": "Cancel" | "Select face";
"set sketchPathToNode": "Enter sketch";
"set tool": "Equip new tool";
"set tool line": "Equip tool";
"set tool move": "Equip move tool";
"show default planes": "Enter sketch";
"sketch exit execute": "Cancel" | "Complete line" | "xstate.stop";
"sketch mode enabled": "Enter sketch" | "Select face";
"toast extrude failed": "";
        };
        eventsCausingDelays: {
          
        };
        eventsCausingGuards: {
          "Can constrain angle": "Constrain angle";
"Can constrain equal length": "Constrain equal length";
"Can constrain horizontal distance": "Constrain horizontal distance";
"Can constrain horizontally align": "Constrain horizontally align";
"Can constrain length": "Constrain length";
"Can constrain vertical distance": "Constrain vertical distance";
"Can constrain vertically align": "Constrain vertically align";
"Can make selection horizontal": "Make segment horizontal";
"Can make selection vertical": "Make segment vertical";
"Selection contains axis": "Deselect axis";
"Selection contains edge": "Deselect edge";
"Selection contains face": "Deselect face";
"Selection contains line": "Deselect segment";
"Selection contains point": "Deselect point";
"Selection is not empty": "Deselect all";
"Selection is one face": "Enter sketch";
"has no selection": "extrude intent";
"has valid extrude selection": "" | "extrude intent";
"is editing existing sketch": "";
        };
        eventsCausingServices: {
          "Get angle info": "Constrain angle";
"Get horizontal info": "Constrain horizontal distance";
"Get length info": "Constrain length";
"Get vertical info": "Constrain vertical distance";
        };
        matchesStates: "Sketch" | "Sketch no face" | "Sketch.Await angle info" | "Sketch.Await horizontal distance info" | "Sketch.Await length info" | "Sketch.Await vertical distance info" | "Sketch.Line Tool" | "Sketch.Line Tool.Done" | "Sketch.Line Tool.Init" | "Sketch.Line Tool.No Points" | "Sketch.Line Tool.Point Added" | "Sketch.Line Tool.Segment Added" | "Sketch.Move Tool" | "Sketch.SketchIdle" | "awaiting selection" | "checking selection" | "idle" | { "Sketch"?: "Await angle info" | "Await horizontal distance info" | "Await length info" | "Await vertical distance info" | "Line Tool" | "Move Tool" | "SketchIdle" | { "Line Tool"?: "Done" | "Init" | "No Points" | "Point Added" | "Segment Added"; }; };
        tags: never;
      }
  