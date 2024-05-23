import toast from 'react-hot-toast'

// When calling `fail` it will run `fn`. This is to force
// all `trap` locations to have a failure message.
// Usage: 
// trap(() => console.log("test")).ok("woohoo").nay("no")
export function trap<T> (textSuccess: string, fn: () => T)  {
  return { 
    fail: (textFail?: string, fnFail?: () => T | undefined | void): T | undefined | void => {
        let val
        try {
            val = fn()
            textSuccess && toast.success(textSuccess)
        } catch (e) {
            console.error(e)
            val = fnFail && fnFail()
            textFail && toast.error(textFail)
        }
        return val
     },
  }
}
