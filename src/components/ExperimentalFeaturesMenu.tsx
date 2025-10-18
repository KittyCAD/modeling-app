import { Popover } from '@headlessui/react'
import toast from 'react-hot-toast'

import { changeExperimentalFeatures } from '@src/lang/wasm'
import { DEFAULT_DEFAULT_EXPERIMENTAL_FEATURES } from '@src/lib/constants'
import { codeManager, kclManager } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { useEffect, useState } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'

export function ExperimentalFeaturesMenu() {
  const [fileSettings, setFileSettings] = useState(kclManager.fileSettings)

  // TODO: pull from rust
  const warningLevels = ['allow', 'warn', 'deny']
  const currentLevel =
    fileSettings.experimentalFeatures?.type.toLowerCase() ??
    DEFAULT_DEFAULT_EXPERIMENTAL_FEATURES

  useEffect(() => {
    setFileSettings(kclManager.fileSettings)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.fileSettings])

  return (
    currentLevel !== 'deny' && (
      <Popover className="relative pointer-events-auto">
        {({ close }) => (
          <>
            <Popover.Button
              data-testid="units-menu"
              className={`flex items-center gap-2 px-1 py-1 
        text-xs text-primary bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm 
        border !border-primary/50 rounded-full`}
            >
              <CustomIcon name="beaker" className="w-4 h-4" />
              <span className="sr-only">
                Experimental features:&nbsp; {currentLevel}
              </span>
            </Popover.Button>
            <Popover.Panel
              className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
          shadow-lg`}
            >
              <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
                {warningLevels.map((level) => (
                  <li key={level} className="contents">
                    <button
                      className="flex items-center gap-2 m-0 py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
                      onClick={() => {
                        const newCode = changeExperimentalFeatures(
                          codeManager.code,
                          level
                        )
                        if (err(newCode)) {
                          toast.error(
                            `Failed to set file experimental features level: ${newCode.message}`
                          )
                        } else {
                          codeManager.updateCodeStateEditor(newCode)
                          Promise.all([
                            codeManager.writeToFile(),
                            kclManager.executeCode(),
                          ])
                            .then(() => {
                              toast.success(
                                `Updated file experimental features level to ${level}`
                              )
                            })
                            .catch(reportRejection)
                        }
                        close()
                      }}
                    >
                      <span className="flex-1">{level}</span>
                      {level ===
                        (fileSettings.experimentalFeatures?.type.toLowerCase() ??
                          DEFAULT_DEFAULT_EXPERIMENTAL_FEATURES) && (
                        <span className="text-chalkboard-60">current</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Popover.Panel>
          </>
        )}
      </Popover>
    )
  )
}
