const consoleDom =
  (originalFn: (...args: any[]) => any, prop: string | symbol) =>
  (...args: any[]) => {
    // Call this as soon as possible to prevent mistakes.
    originalFn(...args)

    if (typeof prop !== 'string') return
    if (
      typeof prop === 'string' &&
      ['log', 'trace', 'table', 'warn', 'error'].includes(prop) === false
    )
      return

    // Will have been attached in a previous call to `console` methods.
    let debugConsoleOnScreen = document.getElementById('debug-console')
    if (!debugConsoleOnScreen) {
      debugConsoleOnScreen = document.createElement('div')
      debugConsoleOnScreen.setAttribute('id', 'debug-console')
      debugConsoleOnScreen.style.zIndex = '99999'
      debugConsoleOnScreen.style.fontSize = '0.75rem'
      debugConsoleOnScreen.style.width = '80ch'
      debugConsoleOnScreen.style.height = '96ch'
      debugConsoleOnScreen.style.overflow = 'auto'
      debugConsoleOnScreen.style.position = 'absolute'
      debugConsoleOnScreen.style.top = '0px'
      debugConsoleOnScreen.style.left = '0px'
      debugConsoleOnScreen.style.backgroundColor = 'rgba(0,0,0,0.5)'
      debugConsoleOnScreen.style.color = 'hsl(0,0,100%)'

      document.body.appendChild(debugConsoleOnScreen)
    }

    const newText = document.createElement('pre')
    newText.innerText = JSON.stringify(args)
    debugConsoleOnScreen.appendChild(newText)
  }

if (typeof window !== 'undefined') {
  window.console = new Proxy(window.console, {
    get(target, prop, receiver) {
      // Can't seem to index into Console type, which is a problem.
      // @ts-expect-error
      return consoleDom(target[prop], prop)
    },
  })
}
