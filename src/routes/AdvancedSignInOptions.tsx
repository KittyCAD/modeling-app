import { useState } from 'react'
import { toSync } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'
import type { AsyncFn } from '@src/lib/types'

export const AdvancedSignInOptions = ({
  signInDesktopDevelopment,
  signInDesktopProduction,
}: {
  signInDesktopDevelopment: AsyncFn<() => {}>
  signInDesktopProduction: AsyncFn<() => {}>
}) => {
  const [showSignInOptions, setShowSignInOptions] = useState<boolean>(false)
  return (
    <div>
      <button
        onClick={() => {
          setShowSignInOptions(!showSignInOptions)
        }}
      >
        Sign-in options
      </button>
      <div
        className={`${showSignInOptions ? 'visible' : 'invisible'} block w-64 left-2 bottom-full mb-1 flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm`}
      >
        <div
          className={`flex items-center justify-between p-2 rounded-t-sm bg-energy-40 text-energy-90`}
        >
          <h2 className="text-sm font-sans font-normal">Select Environment</h2>
        </div>
        <ul>
          <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
            <button
              onClick={toSync(signInDesktopDevelopment, reportRejection)}
              className={'w-full h-8 flex items-center'}
              data-testid="sign-in-button"
            >
              Development
            </button>
          </li>
          <li className="flex flex-col px-2 py-2 gap-1 last:mb-0 ">
            <button
              onClick={toSync(signInDesktopProduction, reportRejection)}
              className={'w-full h-8 flex items-center'}
              data-testid="sign-in-button"
            >
              Production
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
