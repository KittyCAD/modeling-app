import { Popover } from '@headlessui/react'
import toast from 'react-hot-toast'

import {
  DEFAULT_EXPERIMENTAL_FEATURES,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { kclManager, rustContext } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { CustomIcon } from '@src/components/CustomIcon'
import { warningLevels } from '@src/lib/settings/settingsTypes'
import type { WarningLevel } from '@rust/kcl-lib/bindings/WarningLevel'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { updateModelingState } from '@src/lang/modelingWorkflows'

export function ExperimentalFeaturesMenu() {
  const currentLevel: WarningLevel =
    kclManager.fileSettings.experimentalFeatures ??
    DEFAULT_EXPERIMENTAL_FEATURES

  return (
    currentLevel.type !== 'Deny' && (
      <Popover className="relative pointer-events-auto">
        {({ close }) => (
          <>
            <Popover.Button
              data-testid="experimental-features-menu"
              className={`flex items-center gap-2 px-1 py-1 
        text-xs text-primary bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm 
        border !border-primary/50 rounded-full`}
            >
              <CustomIcon name="beaker" className="w-4 h-4" />
              <span className="sr-only">
                Experimental features:&nbsp; {currentLevel.type}
              </span>
            </Popover.Button>
            <Popover.Panel
              className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
          shadow-lg`}
            >
              <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
                {warningLevels.map((level) => (
                  <li key={level.type} className="contents">
                    <button
                      className="flex items-center gap-2 m-0 py-1.5 px-2 cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 border-none text-left"
                      onClick={() => {
                        const newAst = setExperimentalFeatures(
                          kclManager.code,
                          level
                        )
                        if (err(newAst)) {
                          toast.error(
                            `Failed to set file experimental features level: ${newAst.message}`
                          )
                        } else {
                          updateModelingState(newAst, EXECUTION_TYPE_REAL, {
                            kclManager,
                            rustContext,
                          })
                            .then((result) => {
                              if (err(result)) {
                                toast.error(
                                  `Failed to set file experimental features level: ${result.message}`
                                )
                                return
                              }

                              toast.success(
                                `Updated file experimental features level to ${level.type}`
                              )
                            })
                            .catch(reportRejection)
                        }
                        close()
                      }}
                    >
                      <span className="flex-1">{level.type}</span>
                      {level.type === currentLevel.type && (
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
