export const waitForToastAnimationEnd = async (elementId: string, cb: () => void) => {
  return new Promise(async (resolve) => {
    const toaster = document.querySelector(`[data-rht-toaster]`)

    if (!toaster) resolve()

    const toastEl = document.getElementById(elementId)
    const styledEl = toastEl.parentNode.parentNode

    await styledEl.getAnimations().finished

    cb()
    resolve()
  })
}
