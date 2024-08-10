export const isErrorWhitelisted = (exception: Error) => {
  let whitelist: {
    name: string
    message: string
    stack: string
    foundInSpec: string
  }[] = [
    {
      name: '"{"kind"',
      message:
        '"engine","sourceRanges":[[0,0]],"msg":"Failed to get string from response from engine: `JsValue(undefined)`"}"',
      stack: '',
      foundInSpec: 'e2e/playwright/testing-settings.spec.ts',
    },
    {
      name: 'engine error',
      message:
        '[{"error_code":"bad_request","message":"Cannot set the camera position with these values"}]',
      stack: '',
      foundInSpec:
        'e2e/playwright/can-create-sketches-on-all-planes-and-their-back-sides.spec.ts XY',
    },
    {
      name: '',
      message: 'no connection to send on',
      stack: '',
      foundInSpec:
        'e2e/playwright/can-create-sketches-on-all-planes-and-their-back-sides.spec.ts XY',
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
    },
  ]

  const cleanString = (str: string) => str.replace(/[`"]/g, '')
  if (
    whitelist.some(
      (item) =>
        cleanString(exception.name) === cleanString(item.name) &&
        cleanString(exception.message) === cleanString(item.message)
    )
  ) {
    return true
  }
}
