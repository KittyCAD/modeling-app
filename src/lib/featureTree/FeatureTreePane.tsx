import {
  OperationItem,
  DefaultPlanes,
  type OperationProps,
  type SystemDeps,
} from '@src/lib/featureTree/FeatureTreeItems'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { type SourceRange } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  getOperationKey,
  getOperationTreeNodeKey,
  isOperationTreeBranch,
  type OperationTreeNode,
} from '@src/lib/featureTree/featureTreeOperationTree'
import { getOpTypeLabel } from '@src/lib/operations'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { memo, useCallback, useMemo } from 'react'
export {
  OperationItemWrapper,
  VariableTooltipContents,
  getFeatureTreeSketchSelectionContext,
  getFeatureTreeValueDetail,
  namedViewTooltipText,
  supportsZ0006AutoFixBeforeFeatureTreeEdit,
} from '@src/lib/featureTree/FeatureTreeItems'

export { buildOperationTree } from '@src/lib/featureTree/featureTreeOperationTree'

import { Disclosure } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { FeatureTreeMenu } from '@src/lib/featureTree/FeatureTreeMenu'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import usePlatform from '@src/hooks/usePlatform'
import { getUnrenderedChangesDisabledReason } from '@src/lib/automaticRendering'
import { sendSelectionEvent } from '@src/lib/featureTree'
import {
  type AreaTypeComponentProps,
  DefaultLayoutPaneID,
} from '@src/lib/layout'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { projectSession } from '@src/registry/contracts/projectSession'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: feature-tree file opening (useNavigate).

const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>
export function FeatureTreePane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="model"
        title={props.layout.label}
        Menu={FeatureTreeMenu}
        onClose={() => {
          // Gotcha: because our layout system is a goofy first draft,
          // it doesn't know how to handle Splits as children of Panes very well,
          // so the onClose here needs to explicitly state the Split to close,
          // since this layout will be used in a Simple layout now.
          props.onClose?.('feature-tree')
        }}
      />
      <FeatureTreePaneContents />
    </LayoutPanel>
  )
}

export const FeatureTreePaneContents = memo(() => {
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
    operations: operationList,
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
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-1 box-border overflow-auto mr-1"
      >
        <>
          {treeModel.isExecuting && (
            <div className="text-xs bg-primary/10 text-primary py-2 px-2 rounded flex-none mb-2 border border-primary/20">
              Updating feature tree...
            </div>
          )}
          {!modelingState.matches('Sketch') && (
            <DefaultPlanes
              systemDeps={systemDeps}
              disabled={disableModelingForUnrenderedChanges}
            />
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
          {operationList.map((node) => (
            <OperationTreeNodeItem
              key={getOperationTreeNodeKey(node)}
              node={node}
              code={operationsCode}
              isStaleReference={isReadOnlyFeatureTree}
              sketchNoFace={sketchNoFace}
              systemDeps={systemDeps}
              modelingActor={modelingActor}
              engineCommandManager={engineCommandManager}
              onSelect={selectOperation}
              visibilityOperations={visibilityOperations}
              liveActiveModuleId={liveActiveModuleId}
              liveLatestOperationKey={liveLatestOperationKey}
            />
          ))}
        </>
      </section>
    </div>
  )
})

function OperationItemGroup({
  items,
  code,
  isStaleReference,
  sketchNoFace,
  systemDeps,
  modelingActor,
  engineCommandManager,
  onSelect,
  visibilityOperations,
  isModuleOwned = false,
  liveLatestOperationKey,
}: Omit<OperationProps, 'item'> & {
  items: Operation[]
  isModuleOwned?: boolean
}) {
  const contentItems = items.filter((item) => item.type !== 'GroupEnd')
  if (contentItems.length === 0) {
    return null
  }

  const parentItem =
    contentItems[0]?.type === 'GroupBegin' &&
    items.some((i) => i.type === 'GroupEnd')
      ? contentItems[0]
      : undefined
  const childItems = parentItem
    ? contentItems.filter((i) => i !== parentItem)
    : []

  if (parentItem) {
    if (childItems.length === 0) {
      return (
        <OperationItem
          item={parentItem}
          code={code}
          isStaleReference={isStaleReference}
          sketchNoFace={sketchNoFace}
          systemDeps={systemDeps}
          modelingActor={modelingActor}
          engineCommandManager={engineCommandManager}
          onSelect={onSelect}
          visibilityOperations={visibilityOperations}
          isModuleOwned={isModuleOwned}
          liveLatestOperationKey={liveLatestOperationKey}
        />
      )
    }

    return (
      <Disclosure>
        <div className="flex items-start gap-1">
          <Disclosure.Button
            data-testid="operation-group-caret"
            className="reset !px-0 !py-1 self-stretch !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25"
          >
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 block -rotate-90 ui-open:rotate-0 ui-open:transform"
              aria-hidden
            />
          </Disclosure.Button>
          <div className="flex-1 min-w-0">
            <OperationItem
              item={parentItem}
              code={code}
              isStaleReference={isStaleReference}
              sketchNoFace={sketchNoFace}
              systemDeps={systemDeps}
              modelingActor={modelingActor}
              engineCommandManager={engineCommandManager}
              onSelect={onSelect}
              visibilityOperations={visibilityOperations}
              isModuleOwned={isModuleOwned}
              liveLatestOperationKey={liveLatestOperationKey}
            />
          </div>
        </div>
        <Disclosure.Panel>
          <div className="border-l b-4 ml-6">
            {childItems.map((item) => {
              return (
                <OperationItem
                  key={getOperationKey(item)}
                  item={item}
                  code={code}
                  isStaleReference={isStaleReference}
                  sketchNoFace={sketchNoFace}
                  systemDeps={systemDeps}
                  modelingActor={modelingActor}
                  engineCommandManager={engineCommandManager}
                  onSelect={onSelect}
                  visibilityOperations={visibilityOperations}
                  size="sm"
                  isModuleOwned={isModuleOwned}
                  liveLatestOperationKey={liveLatestOperationKey}
                />
              )
            })}
          </div>
        </Disclosure.Panel>
      </Disclosure>
    )
  }

  return (
    <Disclosure>
      <Disclosure.Button className="reset w-full min-w-[0px] !px-1 flex items-center gap-2 text-left text-base !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25">
        <CustomIcon
          name="caretDown"
          className="w-6 h-6 block self-start -rotate-90 ui-open:rotate-0 ui-open:transform"
          aria-hidden
        />
        <span className="text-sm flex-1">
          {contentItems.length} {getOpTypeLabel(contentItems[0].type)}s
        </span>
      </Disclosure.Button>
      <Disclosure.Panel as="ul" className="border-b b-4">
        <div className="border-l b-4 ml-4">
          {contentItems.map((op) => {
            return (
              <OperationItem
                key={getOperationKey(op)}
                item={op}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                visibilityOperations={visibilityOperations}
                size="sm"
                isModuleOwned={isModuleOwned}
                liveLatestOperationKey={liveLatestOperationKey}
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

function OperationBranchGroup({
  parentItem,
  childItems,
  code,
  isStaleReference,
  sketchNoFace,
  systemDeps,
  modelingActor,
  engineCommandManager,
  onSelect,
  visibilityOperations,
  isModuleOwned = false,
  liveActiveModuleId,
  liveLatestOperationKey,
}: Omit<OperationProps, 'item'> & {
  parentItem: ModuleInstanceOperation
  childItems: OperationTreeNode[]
  isModuleOwned?: boolean
}) {
  if (childItems.length === 0) {
    return (
      <OperationItem
        item={parentItem}
        code={code}
        isStaleReference={isStaleReference}
        sketchNoFace={sketchNoFace}
        systemDeps={systemDeps}
        modelingActor={modelingActor}
        engineCommandManager={engineCommandManager}
        onSelect={onSelect}
        visibilityOperations={visibilityOperations}
        isModuleOwned={true}
        liveLatestOperationKey={liveLatestOperationKey}
      />
    )
  }

  // During live execution, only expand the branch whose module received the
  // latest operation.  Outside live execution every branch defaults open.
  // Changing the key forces a Disclosure remount with the new defaultOpen
  // (headlessui v1 does not support a controlled `open` prop).
  const isLive = liveActiveModuleId != null
  const shouldBeOpen = !isLive || liveActiveModuleId === parentItem.moduleId

  return (
    <Disclosure
      key={`${parentItem.moduleId}-${shouldBeOpen}`}
      defaultOpen={shouldBeOpen}
    >
      <div
        className="flex items-start gap-1"
        data-module-branch={parentItem.moduleId}
      >
        <Disclosure.Button
          data-testid="operation-group-caret"
          className="reset !px-0 !py-1 self-stretch !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25"
        >
          <CustomIcon
            name="caretDown"
            className="w-4 h-4 block -rotate-90 ui-open:rotate-0 ui-open:transform"
            aria-hidden
          />
        </Disclosure.Button>
        <div className="flex-1 min-w-0">
          <OperationItem
            item={parentItem}
            code={code}
            isStaleReference={isStaleReference}
            sketchNoFace={sketchNoFace}
            systemDeps={systemDeps}
            modelingActor={modelingActor}
            engineCommandManager={engineCommandManager}
            onSelect={onSelect}
            visibilityOperations={visibilityOperations}
            isModuleOwned={true}
            liveLatestOperationKey={liveLatestOperationKey}
          />
        </div>
      </div>
      <Disclosure.Panel>
        <div className="border-l b-4 ml-6">
          {childItems.map((node) => {
            return (
              <OperationTreeNodeItem
                key={getOperationTreeNodeKey(node)}
                node={node}
                code={code}
                isStaleReference={isStaleReference}
                sketchNoFace={sketchNoFace}
                systemDeps={systemDeps}
                modelingActor={modelingActor}
                engineCommandManager={engineCommandManager}
                onSelect={onSelect}
                visibilityOperations={visibilityOperations}
                isModuleOwned={true}
                liveLatestOperationKey={liveLatestOperationKey}
              />
            )
          })}
        </div>
      </Disclosure.Panel>
    </Disclosure>
  )
}

function OperationTreeNodeItem({
  node,
  ...props
}: Omit<OperationProps, 'item'> & {
  node: OperationTreeNode
  isModuleOwned?: boolean
}) {
  if (isArray(node)) {
    return <OperationItemGroup items={node} {...props} />
  }

  if (isOperationTreeBranch(node)) {
    return (
      <OperationBranchGroup
        parentItem={node.parent}
        childItems={node.children}
        {...props}
      />
    )
  }

  // A plain ModuleInstance node (not a branch) is a deduplicated reference.
  // Clicking it should scroll to the expanded branch for that module.
  const referenceModuleId =
    node.type === 'ModuleInstance' ? node.moduleId : undefined

  return (
    <OperationItem
      item={node}
      {...props}
      referenceModuleId={referenceModuleId}
    />
  )
}
