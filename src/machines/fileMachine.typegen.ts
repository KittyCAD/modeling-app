
  // This file was automatically generated. Edits will be overwritten

  export interface Typegen0 {
        '@@xstate/typegen': true;
        internalEvents: {
          "done.invoke.create-file": { type: "done.invoke.create-file"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.delete-file": { type: "done.invoke.delete-file"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.read-files": { type: "done.invoke.read-files"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"done.invoke.rename-file": { type: "done.invoke.rename-file"; data: unknown; __tip: "See the XState TS docs to learn how to strongly type this." };
"error.platform.create-file": { type: "error.platform.create-file"; data: unknown };
"error.platform.delete-file": { type: "error.platform.delete-file"; data: unknown };
"error.platform.read-files": { type: "error.platform.read-files"; data: unknown };
"error.platform.rename-file": { type: "error.platform.rename-file"; data: unknown };
"xstate.init": { type: "xstate.init" };
        };
        invokeSrcNameMap: {
          "createFile": "done.invoke.create-file";
"deleteFile": "done.invoke.delete-file";
"readFiles": "done.invoke.read-files";
"renameFile": "done.invoke.rename-file";
        };
        missingImplementations: {
          actions: "navigateToFile" | "toastError" | "toastSuccess";
          delays: never;
          guards: "Has at least 1 file";
          services: "createFile" | "deleteFile" | "readFiles" | "renameFile";
        };
        eventsCausingActions: {
          "navigateToFile": "Open file";
"setFiles": "done.invoke.read-files";
"setSelectedDirectory": "Set selected directory";
"toastError": "error.platform.create-file" | "error.platform.delete-file" | "error.platform.read-files" | "error.platform.rename-file";
"toastSuccess": "done.invoke.create-file" | "done.invoke.delete-file" | "done.invoke.rename-file";
        };
        eventsCausingDelays: {
          
        };
        eventsCausingGuards: {
          "Has at least 1 file": "done.invoke.read-files";
        };
        eventsCausingServices: {
          "createFile": "Create file";
"deleteFile": "Delete file";
"readFiles": "assign" | "done.invoke.create-file" | "done.invoke.delete-file" | "done.invoke.rename-file" | "error.platform.create-file" | "error.platform.rename-file" | "xstate.init";
"renameFile": "Rename file";
        };
        matchesStates: "Creating file" | "Deleting file" | "Has files" | "Has no files" | "Opening file" | "Reading files" | "Renaming file";
        tags: never;
      }
  