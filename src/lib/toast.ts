export const waitForToastAnimationEnd = async (
  elementId: string,
  cb: () => void
): Promise<void> => {
  return new Promise<void>((resolve) => {
    const toaster = document.querySelector(`[data-rht-toaster]`)

    if (!toaster) return resolve()

    const toastEl = document.getElementById(elementId)
    if (toastEl === null) return resolve()
    const toastElParent = toastEl.parentNode
    if (toastElParent === null) return resolve()
    const styledEl = toastElParent.parentNode
    if (styledEl === null) return resolve()

    // For some reason this is so new TS doesn't know about it.
    // @ts-expect-error
    styledEl.getAnimations().finished.then(() => {
      cb()
      resolve()
    })
  })
}
