export const isErrorWhitelisted = (exception: Error) => {
  let whitelist = [
    {
      name: '"{"kind"',
      message:
        '"engine","sourceRanges":[[0,0]],"msg":"Failed to get string from response from engine: `JsValue(undefined)`"}"',
      stack: '',
      foundInSpec: 'e2e/playwright/testing-settings.spec.ts',
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
