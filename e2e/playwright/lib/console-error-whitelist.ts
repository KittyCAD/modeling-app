export const isErrorWhitelisted = (exception: Error) => {
  // due to the way webkit/Google Chrome report errors, it was necessary
  // to whitelist similar errors separately for each project
  let whitelist: {
    name: string
    message: string
    stack: string
    foundInSpec: string
    project: 'webkit' | 'Google Chrome'
  }[] = [
    {
      name: '',
      message: 'undefined',
      stack: '',
      foundInSpec: `e2e/playwright/sketch-tests.spec.ts Existing sketch with bad code delete user's code`,
      project: 'Google Chrome',
    },
    {
      name: '"{"kind"',
      message:
        '"engine","sourceRanges":[[0,0,0]],"msg":"Failed to get string from response from engine: `JsValue(undefined)`"}"',
      stack: '',
      foundInSpec: 'e2e/playwright/testing-settings.spec.ts',
      project: 'Google Chrome',
    },
    {
      name: '',
      message: 'false',
      stack: '',
      foundInSpec: 'e2e/playwright/testing-segment-overlays.spec.ts',
      project: 'Google Chrome',
    },
    {
      name: '{"kind"',
      // eslint-disable-next-line no-useless-escape
      message: 'no connection to send on',
      stack: '',
      foundInSpec: 'e2e/playwright/various.spec.ts',
      project: 'Google Chrome',
    },
    {
      name: '',
      message: 'sketch not found',
      stack: '',
      foundInSpec:
        'e2e/playwright/testing-selections.spec.ts Deselecting line tool should mean nothing happens on click',
      project: 'Google Chrome',
    },
    {
      name: 'engine error',
      message:
        '[{"error_code":"bad_request","message":"Cannot set the camera position with these values"}]',
      stack: '',
      foundInSpec:
        'e2e/playwright/can-create-sketches-on-all-planes-and-their-back-sides.spec.ts XY',
      project: 'Google Chrome',
    },
    {
      name: '',
      message: 'no connection to send on',
      stack: '',
      foundInSpec:
        'e2e/playwright/can-create-sketches-on-all-planes-and-their-back-sides.spec.ts XY',
      project: 'Google Chrome',
    },
    {
      name: 'RangeError',
      message: 'Position 160 is out of range for changeset of length 0',
      stack: `RangeError: Position 160 is out of range for changeset of length 0
    at _ChangeSet.mapPos (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:756:13)
    at findSharedChunks (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:3045:49)
    at _RangeSet.compare (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:2840:24)
    at findChangedDeco (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:3320:12)
    at DocView.update (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:2774:20)
    at _EditorView.update (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:7056:30)
    at DOMObserver.flush (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:6621:17)
    at MutationObserver.<anonymous> (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:6322:14)`,
      foundInSpec: 'e2e/playwright/editor-tests.spec.ts fold gutters work',
      project: 'Google Chrome',
    },
    {
      name: 'RangeError',
      message: 'Selection points outside of document',
      stack: `RangeError: Selection points outside of document
    +     at checkSelection (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:1453:13)
    +     at new _Transaction (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:2014:7)
    +     at _Transaction.create (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:2022:12)
    +     at resolveTransaction (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:2155:24)
    +     at _EditorState.update (http://localhost:3000/node_modules/.vite/deps/chunk-3BHLKIA4.js?v=412eae63:2281:12)
    +     at _EditorView.dispatch (http://localhost:3000/node_modules/.vite/deps/chunk-IZYF444B.js?v=412eae63:6988:148)
    +     at EditorManager.selectRange (http://localhost:3000/src/editor/manager.ts:182:22)
    +     at AST extrude (http://localhost:3000/src/machines/modelingMachine.ts:828:25)`,
      foundInSpec: 'e2e/playwright/editor-tests.spec.ts',
      project: 'Google Chrome',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: "TypeError: null is not an object (evaluating 'sg.value')",
      stack: `Unhandled Promise Rejection: TypeError: null is not an object (evaluating 'sg.value')
    at unknown (http://localhost:3000/src/clientSideScene/sceneEntities.ts:466:23)
    at unknown (http://localhost:3000/src/clientSideScene/sceneEntities.ts:454:32)
    at set up draft line without teardown (http://localhost:3000/src/machines/modelingMachine.ts:983:47)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1877:24)
    at handleAction (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1064:26)
    at processBlock (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1087:36)
    at map ([native code]:0:0)
    at resolveActions (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1109:49)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:3639:37)
    at provide (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1117:18)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:2452:30)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1831:43)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1659:17)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1643:19)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=0de2e74f:1829:33)
    at unknown (http://localhost:3000/src/clientSideScene/sceneEntities.ts:263:19)`,
      foundInSpec: `e2e/playwright/testing-camera-movement.spec.ts Zoom should be consistent when exiting or entering sketches`,
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: 'false',
      stack: `Unhandled Promise Rejection: false
    at unknown (http://localhost:3000/src/clientSideScene/ClientSideSceneComp.tsx:455:78)`,
      foundInSpec: `e2e/playwright/testing-segment-overlays.spec.ts line-[tagOutsideSketch]`,
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: `TypeError: null is not an object (evaluating 'programMemory.get(variableDeclarationName).value')`,
      stack: `    +  stack:Unhandled Promise Rejection: TypeError: null is not an object (evaluating 'programMemory.get(variableDeclarationName).value')
    +     at unknown (http://localhost:3000/src/machines/modelingMachine.ts:911:49)`,
      foundInSpec: `e2e/playwright/can-create-sketches-on-all-planes-and-their-back-sides.spec.ts`,
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: `null is not an object (evaluating 'programMemory.get(variableDeclarationName).value')`,
      stack: `Unhandled Promise Rejection: TypeError: null is not an object (evaluating 'programMemory.get(variableDeclarationName).value')
    at unknown (http://localhost:3000/src/machines/modelingMachine.ts:911:49)`,
      foundInSpec: `e2e/playwright/testing-camera-movement.spec.ts Zoom should be consistent when exiting or entering sketches`,
      project: 'webkit',
    },
    {
      name: 'TypeError',
      message: `null is not an object (evaluating 'gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT).precision')`,
      stack: `TypeError: null is not an object (evaluating 'gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT).precision')
    at getMaxPrecision (http://localhost:3000/node_modules/.vite/deps/chunk-DEEFU7IG.js?v=d328572b:9557:71)
    at WebGLCapabilities (http://localhost:3000/node_modules/.vite/deps/chunk-DEEFU7IG.js?v=d328572b:9570:39)
    at initGLContext (http://localhost:3000/node_modules/.vite/deps/chunk-DEEFU7IG.js?v=d328572b:16993:43)
    at WebGLRenderer (http://localhost:3000/node_modules/.vite/deps/chunk-DEEFU7IG.js?v=d328572b:17024:18)
    at SceneInfra (http://localhost:3000/src/clientSideScene/sceneInfra.ts:185:38)
    at module code (http://localhost:3000/src/lib/singletons.ts:14:41)`,
      foundInSpec: `e2e/playwright/testing-segment-overlays.spec.ts angledLineToX`,
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message:
        '{"kind":"engine","sourceRanges":[[0,0,0]],"msg":"Failed to get string from response from engine: `JsValue(undefined)`"}',
      stack: `Unhandled Promise Rejection: {"kind":"engine","sourceRanges":[[0,0,0]],"msg":"Failed to get string from response from engine: \`JsValue(undefined)\`"}
    at unknown (http://localhost:3000/src/lang/std/engineConnection.ts:1245:26)`,
      foundInSpec:
        'e2e/playwright/onboarding-tests.spec.ts Click through each onboarding step',
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: 'undefined',
      stack: '',
      foundInSpec: `e2e/playwright/sketch-tests.spec.ts Existing sketch with bad code delete user's code`,
      project: 'webkit',
    },
    {
      name: 'Fetch API cannot load https',
      message: '/api.dev.zoo.dev/logout due to access control checks.',
      stack: `Fetch API cannot load https://api.dev.zoo.dev/logout due to access control checks.
    at goToSignInPage (http://localhost:3000/src/components/SettingsAuthProvider.tsx:229:15)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1877:24)
    at handleAction (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1064:26)
    at processBlock (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1087:36)
    at map (:1:11)
    at resolveActions (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1109:49)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:3639:37)
    at provide (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1117:18)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:2452:30)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1831:43)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1659:17)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1643:19)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:1829:33)
    at unknown (http://localhost:3000/node_modules/.vite/deps/chunk-6FRHHHSJ.js?v=d328572b:2601:23)`,
      foundInSpec:
        'e2e/playwright/testing-selections.spec.ts Solids should be select and deletable',
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: 'ReferenceError: Cannot access uninitialized variable.',
      stack: `Unhandled Promise Rejection: ReferenceError: Cannot access uninitialized variable.
    at setDiagnosticsForCurrentErrors (http://localhost:3000/src/lang/KclSingleton.ts:90:18)
    at kclErrors (http://localhost:3000/src/lang/KclSingleton.ts:82:40)
    at safeParse (http://localhost:3000/src/lang/KclSingleton.ts:150:9)
    at unknown (http://localhost:3000/src/lang/KclSingleton.ts:113:32)`,
      foundInSpec:
        'e2e/playwright/testing-segment-overlays.spec.ts angledLineToX',
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message: 'sketch not found',
      stack: `Unhandled Promise Rejection: sketch not found
    at unknown (http://localhost:3000/src/machines/modelingMachine.ts:911:49)`,
      foundInSpec:
        'e2e/playwright/testing-selections.spec.ts Deselecting line tool should mean nothing happens on click',
      project: 'webkit',
    },
    {
      name: 'Unhandled Promise Rejection',
      message:
        'engine error: [{"error_code":"bad_request","message":"Cannot set the camera position with these values"}]',
      stack:
        'Unhandled Promise Rejection: engine error: [{"error_code":"bad_request","message":"Cannot set the camera position with these values"}]',
      foundInSpec:
        'e2e/playwright/testing-camera-movement.spec.ts Zoom should be consistent when exiting or entering sketches',
      project: 'webkit',
    },
    {
      name: 'SecurityError',
      stack: `SecurityError:  Failed to read the 'localStorage' property from 'Window': Access is denied for this document.
     at <anonymous>:13:5
     at <anonymous>:18:5
     at <anonymous>:19:7`,
      message: `Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`,
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/basic-sketch.spec.ts',
    },
    {
      name: '  - internal_engine',
      stack: `
`,
      message: `Nothing to export`,
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/regression-tests.spec.ts',
    },
    {
      name: 'SyntaxError',
      stack: `SyntaxError: Unexpected end of JSON input
    at crossPlatformFetch (http://localhost:3000/src/lib/crossPlatformFetch.ts:34:31)
    at async sendTelemetry (http://localhost:3000/src/lib/textToCad.ts:179:3)`,
      message: `Unexpected end of JSON input`,
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/text-to-cad-tests.spec.ts',
    },
    {
      name: '{"kind"',
      stack: ``,
      message: `engine","sourceRanges":[[0,0,0]],"msg":"Failed to wait for promise from engine: JsValue(\\"Force interrupt, executionIsStale, new AST requested\\")"}`,
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/testing-settings.spec.ts',
    },
    // TODO: fix this error in the code
    {
      name: 'ReferenceError',
      message: '_testUtils is not defined',
      stack: '',
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/snapshot-tests.spec.ts',
    },
    // TODO: fix this error in the code
    {
      name: 'TypeError',
      message: 'Failed to fetch',
      stack: '',
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/snapshot-tests.spec.ts',
    },
    // TODO: fix this error in the code
    {
      name: 'ReferenceError',
      message: 'originalCode is not defined',
      stack: '',
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/onboarding-tests.spec.ts',
    },
    // TODO: fix this error in the code
    {
      name: 'ReferenceError',
      message: 'createNewVariableCheckbox is not defined',
      stack: '',
      project: 'Google Chrome',
      foundInSpec: 'e2e/playwright/testing-constraints.spec.ts',
    },
  ]

  const cleanString = (str: string) => str.replace(/[`"]/g, '')
  const foundItem = whitelist.find(
    (item) =>
      cleanString(exception.name) === cleanString(item.name) &&
      cleanString(exception.message).includes(cleanString(item.message))
  )

  return foundItem !== undefined
}
