import {
  OperationItem,
  DefaultPlanes,
  OperationRowRenderer,
  type OperationRowProps,
  type SystemDeps,
} from '@src/lib/featureTree/FeatureTreeItems'
import { operationGroupLabel } from '@src/lib/featureTree/browserNodes'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { type SourceRange } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { getOperationCalculatedDisplay } from '@src/lib/operations'
import { reportRejection } from '@src/lib/trap'
import { memo, useCallback, useMemo } from 'react'

import { useSignals } from '@preact/signals-react/runtime'
import usePlatform from '@src/hooks/usePlatform'
import { getUnrenderedChangesDisabledReason } from '@src/lib/automaticRendering'
import { sendSelectionEvent } from '@src/lib/featureTree'
import {
  FeatureTreeRow,
  FeatureTreeDivider,
  FeatureTreeNotice,
} from '@src/lib/featureTree/FeatureTreeView'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { projectSession } from '@src/registry/contracts/projectSession'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'

const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

export const FeatureTreeSection = memo(
  ({ sectionId }: { sectionId: string }) => {
    useSignals()
    const app = useApp()
    const { layout, commands } = app
    const platform = usePlatform()
    const keymap = app.registry.optional(keymapService)
    const unrenderedExecuteHotkeyLabel = keymapKeystrokesDisplay(
      keymap
        ? findKeymapItemForCommand(
            keymap.keymap.value,
            APP_COMMAND_IDS.editor.render,
            keymap.getCurrentScopes(),
            app.registry.signal(keymapScopesValueSpec).value
          )?.keystrokes
        : [UNRENDERED_EXECUTE_HOTKEY],
      platform
    )
    const { kclManager } = useSingletons()
    const executionService =
      app.registry.signal(projectSession).value?.executingEditor.value
    const { engineCommandManager, rustContext } = kclManager
    const {
      send: modelingSend,
      state: modelingState,
      actor: modelingActor,
    } = useModelingContext()
    const systemDeps: SystemDeps = useMemo(
      () => ({
        kclManager,
        sceneInfra: kclManager.sceneInfra,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
        rustContext,
        commandBarActor: commands.actor,
      }),
      [kclManager, rustContext, commands.actor]
    )

    const selectOperation = useCallback(
      (sourceRange: SourceRange) => {
        sendSelectionEvent({
          sourceRange,
          kclManager,
          modelingSend,
        })
      },
      [modelingSend, kclManager]
    )

    const sketchNoFace = modelingState.matches('Sketch no face')
    const treeModel = app.registry.get(featureTree).model.value
    const {
      code: operationsCode,
      visibilityOperations,
      hasParseErrors,
      disabledForUnrenderedChanges: disableModelingForUnrenderedChanges,
      readOnly: isReadOnlyFeatureTree,
      showingStaleTree: isShowingStaleFeatureTree,
      liveActiveModuleId,
      liveLatestOperationKey,
    } = treeModel
    const firstParseDiagnostic = hasParseErrors
      ? treeModel.diagnostics.find(
          (diagnostic) => diagnostic.severity === 'error'
        )
      : undefined
    const firstParseAction = firstParseDiagnostic?.actions?.[0]

    function goToError() {
      layout.openPane(DefaultLayoutPaneID.Code)
      kclManager.scrollToFirstErrorDiagnosticIfExists()
    }

    function applyParseQuickFix() {
      if (!firstParseDiagnostic || !firstParseAction) return
      firstParseAction.apply(
        kclManager.editorView,
        firstParseDiagnostic.from,
        firstParseDiagnostic.to
      )
    }

    return (
      <OperationRowRenderer.Provider value={BrowserOperationRow}>
        <FeatureTreeNotice parentId={sectionId}>
          {treeModel.isExecuting && (
            <div className="text-xs bg-primary/10 text-primary py-2 px-2 rounded flex-none mb-2 border border-primary/20">
              Updating feature tree...
            </div>
          )}
          {disableModelingForUnrenderedChanges && !hasParseErrors && (
            <div className="text-sm bg-2 text-2 py-2 px-2 rounded flex flex-col gap-2 flex-none mb-2 border border-chalkboard-20 dark:border-chalkboard-80">
              <p className="font-medium">Feature tree actions are disabled.</p>
              <p className="text-xs opacity-80">
                {getUnrenderedChangesDisabledReason()}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    executionService?.executeCode().catch(reportRejection)
                  }}
                  disabled={kclManager.isExecuting || !executionService}
                  className="flex gap-1 items-center py-0 pl-0.5 pr-1 m-0 flex-none text-primary dark:text-primary border border-solid border-primary bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30 hover:border-primary active:border-primary disabled:cursor-wait disabled:opacity-70"
                >
                  <CustomIcon name="play" className="w-5 h-5" />
                  <span>Execute</span>
                  {unrenderedExecuteHotkeyLabel && (
                    <kbd className="hotkey text-xs">
                      {unrenderedExecuteHotkeyLabel}
                    </kbd>
                  )}
                </button>
              </div>
            </div>
          )}
          {hasParseErrors && (
            <div className="text-sm bg-destroy-80 text-chalkboard-10 py-2 px-2 rounded flex flex-col gap-2 flex-none mb-2">
              <p className="font-medium">
                KCL parse errors are blocking the current feature tree.
              </p>
              <p className="whitespace-pre-wrap break-words text-xs">
                {firstParseDiagnostic?.message ||
                  'Fix the parse error to rebuild the feature tree.'}
              </p>
              <p className="text-xs text-chalkboard-20">
                {isShowingStaleFeatureTree
                  ? 'Showing the last successful feature tree as a read-only reference. It may not match the current code.'
                  : 'No successful feature tree is available yet for this file.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={goToError}
                  className="bg-chalkboard-10 text-destroy-80 p-1 rounded-sm flex-none hover:bg-chalkboard-10 hover:border-destroy-70 hover:text-destroy-80 border-transparent"
                >
                  View error
                </button>
                {firstParseAction && (
                  <button
                    onClick={applyParseQuickFix}
                    className="bg-destroy-70 text-chalkboard-10 p-1 rounded-sm flex-none hover:bg-destroy-60 border-transparent"
                  >
                    {firstParseAction.name}
                  </button>
                )}
              </div>
            </div>
          )}
        </FeatureTreeNotice>
        {!modelingState.matches('Sketch') && (
          <DefaultPlanes
            flat
            systemDeps={systemDeps}
            disabled={disableModelingForUnrenderedChanges}
          />
        )}

        {treeModel.planes.length > 0 && (
          <FeatureTreeDivider parentId={sectionId} />
        )}
        {treeModel.operationRows.map((row) =>
          row.kind === 'group' ? (
            <FeatureTreeRow
              key={row.id}
              nodeId={row.id}
              label={operationGroupLabel(row.operationType, row.count)}
            />
          ) : (
            <OperationItem
              key={row.id}
              nodeId={row.id}
              item={row.operation}
              code={operationsCode}
              isStaleReference={isReadOnlyFeatureTree}
              sketchNoFace={sketchNoFace}
              systemDeps={systemDeps}
              modelingActor={modelingActor}
              engineCommandManager={engineCommandManager}
              onSelect={selectOperation}
              visibilityOperations={visibilityOperations}
              isModuleOwned={row.isModuleOwned}
              referenceModuleId={row.referenceModuleId}
              liveActiveModuleId={liveActiveModuleId}
              liveLatestOperationKey={liveLatestOperationKey}
            />
          )
        )}
      </OperationRowRenderer.Provider>
    )
  }
)

/** The shared operation controller supplies actions; this component only renders a tree row. */
function BrowserOperationRow(props: OperationRowProps) {
  const { registry } = useApp()
  const node = props.nodeId
    ? registry.get(featureTree).featureNodesById.value.get(props.nodeId)
    : undefined
  if (!node) return null
  return (
    <FeatureTreeRow
      nodeId={node.id}
      label={node.label}
      disabled={node.disabled}
      moduleId={node.moduleId}
      tooltip={props.Tooltip}
      icon={<CustomIcon name={props.icon} className="w-5 h-5" />}
      detail={
        <>
          {props.valueDetail && props.variableName
            ? `${props.variableName} `
            : null}
          {props.valueDetail &&
            getOperationCalculatedDisplay(props.valueDetail.calculated)}
          {props.customSuffix}
        </>
      }
      visibility={props.visibilityToggle}
      menuItems={props.menuItems}
      status={props.errors?.length ? 'has error' : undefined}
      onSelect={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    />
  )
}
