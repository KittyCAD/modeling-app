
  // This file was automatically generated. Edits will be overwritten

  export interface Typegen0 {
        '@@xstate/typegen': true;
        internalEvents: {
          "": { type: "" };
"done.invoke.get-abs-x-info": { type: "done.invoke.get-abs-x-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-abs-y-info": { type: "done.invoke.get-abs-y-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-angle-info": { type: "done.invoke.get-angle-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-horizontal-info": { type: "done.invoke.get-horizontal-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-length-info": { type: "done.invoke.get-length-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-perpendicular-distance-info": { type: "done.invoke.get-perpendicular-distance-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.get-vertical-info": { type: "done.invoke.get-vertical-info"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"error.platform.get-abs-x-info": { type: "error.platform.get-abs-x-info"; data: unknown };
"error.platform.get-abs-y-info": { type: "error.platform.get-abs-y-info"; data: unknown };
"error.platform.get-angle-info": { type: "error.platform.get-angle-info"; data: unknown };
"error.platform.get-horizontal-info": { type: "error.platform.get-horizontal-info"; data: unknown };
"error.platform.get-length-info": { type: "error.platform.get-length-info"; data: unknown };
"error.platform.get-perpendicular-distance-info": { type: "error.platform.get-perpendicular-distance-info"; data: unknown };
"error.platform.get-vertical-info": { type: "error.platform.get-vertical-info"; data: unknown };
"xstate.init": { type: "xstate.init" };
"xstate.stop": { type: "xstate.stop" };
        };
        invokeSrcNameMap: {
          "Get ABS X info": "done.invoke.get-abs-x-info";
"Get ABS Y info": "done.invoke.get-abs-y-info";
"Get angle info": "done.invoke.get-angle-info";
"Get horizontal info": "done.invoke.get-horizontal-info";
"Get length info": "done.invoke.get-length-info";
"Get perpendicular distance info": "done.invoke.get-perpendicular-distance-info";
"Get vertical info": "done.invoke.get-vertical-info";
        };
        missingImplementations: {
          actions: "AST add line segment" | "AST start new sketch" | "Modify AST" | "Set selection" | "Update code selection cursors" | "create path" | "show default planes" | "sketch exit execute";
          delays: never;
          guards: "Selection contains axis" | "Selection contains edge" | "Selection contains face" | "Selection contains line" | "Selection contains point" | "Selection is not empty" | "Selection is one face" | "has valid extrude selection";
          services: "Get ABS X info" | "Get ABS Y info" | "Get angle info" | "Get horizontal info" | "Get length info" | "Get perpendicular distance info" | "Get vertical info";
        };
        eventsCausingActions: {
          "AST add line segment": "Add point";
"AST extrude": "Extrude";
"AST start new sketch": "Add point";
"Add to code-based selection": "Deselect point" | "Deselect segment" | "Select all" | "Select edge" | "Select face" | "Select point" | "Select segment";
"Add to other selection": "Select axis";
"Clear selection": "Deselect all";
"Constrain equal length": "Constrain equal length";
"Constrain horizontally align": "Constrain horizontally align";
"Constrain parallel": "Constrain parallel";
"Constrain remove constraints": "Constrain remove constraints";
"Constrain snap to X": "Constrain snap to X";
"Constrain snap to Y": "Constrain snap to Y";
"Constrain vertically align": "Constrain vertically align";
"Make selection horizontal": "Make segment horizontal";
"Make selection vertical": "Make segment vertical";
"Modify AST": "Complete line";
"Remove from code-based selection": "Deselect edge" | "Deselect face" | "Deselect point";
"Remove from other selection": "Deselect axis";
"Set selection": "Set selection" | "done.invoke.get-abs-x-info" | "done.invoke.get-abs-y-info" | "done.invoke.get-angle-info" | "done.invoke.get-horizontal-info" | "done.invoke.get-length-info" | "done.invoke.get-perpendicular-distance-info" | "done.invoke.get-vertical-info";
"Update code selection cursors": "Complete line" | "Deselect all" | "Deselect axis" | "Deselect edge" | "Deselect face" | "Deselect point" | "Deselect segment" | "Select edge" | "Select face" | "Select point" | "Select segment";
"clear paper project": "Cancel" | "CancelSketch" | "Set selection" | "xstate.stop";
"create path": "Select default plane";
"default_camera_disable_sketch_mode": "Cancel";
"edit mode enter": "Enter sketch" | "Re-execute";
"edit_mode_exit": "Cancel";
"equip select": "CancelSketch" | "Constrain equal length" | "Constrain horizontally align" | "Constrain parallel" | "Constrain remove constraints" | "Constrain snap to X" | "Constrain snap to Y" | "Constrain vertically align" | "Deselect point" | "Deselect segment" | "Enter sketch" | "Make segment horizontal" | "Make segment vertical" | "Re-execute" | "Select default plane" | "Select point" | "Select segment" | "Set selection" | "done.invoke.get-abs-x-info" | "done.invoke.get-abs-y-info" | "done.invoke.get-angle-info" | "done.invoke.get-horizontal-info" | "done.invoke.get-length-info" | "done.invoke.get-perpendicular-distance-info" | "done.invoke.get-vertical-info" | "error.platform.get-abs-x-info" | "error.platform.get-abs-y-info" | "error.platform.get-angle-info" | "error.platform.get-horizontal-info" | "error.platform.get-length-info" | "error.platform.get-perpendicular-distance-info" | "error.platform.get-vertical-info";
"hide default planes": "Cancel" | "Select default plane" | "Set selection" | "xstate.stop";
"hide draft line": "Cancel" | "CancelSketch" | "Set selection" | "xstate.stop";
"initialise draft line": "Cancel" | "CancelSketch" | "Enter sketch" | "Select default plane" | "Set selection" | "xstate.stop";
"reset sketch metadata": "Cancel" | "Select default plane";
"set default plane id": "Select default plane";
"set move desc": "";
"set segment tool": "Equip line tool" | "Equip tangential arc tool";
"set sketch metadata": "Enter sketch";
"set sketchMetadata from pathToNode": "Re-execute";
"set tool move": "Equip move tool" | "Re-execute" | "Set selection";
"set up draft line": "Equip Line tool 2";
"setup paper sketch": "Cancel" | "CancelSketch" | "Enter sketch" | "Select default plane" | "Set selection" | "xstate.stop";
"show default planes": "Enter sketch";
"sketch exit execute": "Cancel" | "Complete line" | "Set selection" | "xstate.stop";
"sketch mode enabled": "Enter sketch" | "Re-execute" | "Select default plane";
"tear down paper sketch": "Cancel" | "Complete line" | "Set selection" | "xstate.stop";
        };
        eventsCausingDelays: {
          
        };
        eventsCausingGuards: {
          "Can canstrain parallel": "Constrain parallel";
"Can constrain ABS X": "Constrain ABS X";
"Can constrain ABS Y": "Constrain ABS Y";
"Can constrain angle": "Constrain angle";
"Can constrain equal length": "Constrain equal length";
"Can constrain horizontal distance": "Constrain horizontal distance";
"Can constrain horizontally align": "Constrain horizontally align";
"Can constrain length": "Constrain length";
"Can constrain perpendicular distance": "Constrain perpendicular distance";
"Can constrain remove constraints": "Constrain remove constraints";
"Can constrain snap to X": "Constrain snap to X";
"Can constrain snap to Y": "Constrain snap to Y";
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
"can move": "";
"can move with execute": "";
"has valid extrude selection": "Extrude";
"is editing existing sketch": "" | "Equip tangential arc tool";
        };
        eventsCausingServices: {
          "Get ABS X info": "Constrain ABS X";
"Get ABS Y info": "Constrain ABS Y";
"Get angle info": "Constrain angle";
"Get horizontal info": "Constrain horizontal distance";
"Get length info": "Constrain length";
"Get perpendicular distance info": "Constrain perpendicular distance";
"Get vertical info": "Constrain vertical distance";
        };
        matchesStates: "Sketch" | "Sketch no face" | "Sketch.Await ABS X info" | "Sketch.Await ABS Y info" | "Sketch.Await angle info" | "Sketch.Await horizontal distance info" | "Sketch.Await length info" | "Sketch.Await perpendicular distance info" | "Sketch.Await vertical distance info" | "Sketch.Line Tool" | "Sketch.Line Tool.Done" | "Sketch.Line Tool.Init" | "Sketch.Line Tool.No Points" | "Sketch.Line Tool.Point Added" | "Sketch.Line Tool.Segment Added" | "Sketch.Line tool 2" | "Sketch.Move Tool" | "Sketch.Move Tool.Move init" | "Sketch.Move Tool.Move with execute" | "Sketch.Move Tool.Move without re-execute" | "Sketch.Move Tool.No move" | "Sketch.SketchIdle" | "idle" | { "Sketch"?: "Await ABS X info" | "Await ABS Y info" | "Await angle info" | "Await horizontal distance info" | "Await length info" | "Await perpendicular distance info" | "Await vertical distance info" | "Line Tool" | "Line tool 2" | "Move Tool" | "SketchIdle" | { "Line Tool"?: "Done" | "Init" | "No Points" | "Point Added" | "Segment Added";
"Move Tool"?: "Move init" | "Move with execute" | "Move without re-execute" | "No move"; }; };
        tags: never;
      }
  