import {
  getWorkspacePaneLabel,
  WORKSPACE_PANE_OPTIONS,
  type WorkspacePaneContent,
} from '@src/lib/aiFirstCad/workspacePanes'
import type { PropsWithChildren } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type AiFirstCadMode = 'ai' | 'manual' | 'code'
export type SceneCadMode = Exclude<AiFirstCadMode, 'ai'>
export type SceneFeatureTreeVisibility = Record<SceneCadMode, boolean>
export type CodeCadPaneContent = WorkspacePaneContent
export type CodeCadPaneSlot = 'left' | 'center' | 'right'
export type CodeCadPaneAssignments = Record<CodeCadPaneSlot, CodeCadPaneContent>

export const CODE_CAD_PANE_OPTIONS = WORKSPACE_PANE_OPTIONS

export const getCodeCadPaneLabel = (content: CodeCadPaneContent) =>
  getWorkspacePaneLabel(content)

const DEFAULT_CODE_CAD_PANE_ASSIGNMENTS: CodeCadPaneAssignments = {
  left: 'files',
  center: 'code',
  right: 'scene',
}

export function assignCodeCadPaneContent(
  assignments: CodeCadPaneAssignments,
  slot: CodeCadPaneSlot,
  content: CodeCadPaneContent
): CodeCadPaneAssignments {
  if (assignments[slot] === content) {
    return assignments
  }

  return {
    ...assignments,
    [slot]: content,
  }
}

const DEFAULT_SCENE_FEATURE_TREE_VISIBILITY: SceneFeatureTreeVisibility = {
  manual: true,
  code: true,
}

export function updateSceneFeatureTreeVisibility(
  visibility: SceneFeatureTreeVisibility,
  mode: SceneCadMode,
  visible: boolean
): SceneFeatureTreeVisibility {
  if (visibility[mode] === visible) {
    return visibility
  }

  return {
    ...visibility,
    [mode]: visible,
  }
}

type AiFirstCadContextValue = {
  codeCadPaneAssignments: CodeCadPaneAssignments
  isCanvasGridVisible: boolean
  isCodeLeftPaneVisible: boolean
  isCodeStreamVisible: boolean
  mode: AiFirstCadMode
  projectEditRevision: number
  sceneFeatureTreeVisibility: SceneFeatureTreeVisibility
  notifyProjectEdited: () => void
  setCanvasGridVisible: (visible: boolean) => void
  setCodeCadPaneContent: (
    slot: CodeCadPaneSlot,
    content: CodeCadPaneContent
  ) => void
  setCodeLeftPaneVisible: (visible: boolean) => void
  setCodeStreamVisible: (visible: boolean) => void
  setMode: (mode: AiFirstCadMode) => void
  setSceneFeatureTreeVisible: (mode: SceneCadMode, visible: boolean) => void
}

const AI_FIRST_CAD_MODE_STORAGE_KEY = 'zds-ai-first-cad-mode'
const SCENE_FEATURE_TREE_VISIBILITY_STORAGE_KEY =
  'zds-scene-feature-tree-visibility'
const AI_EDIT_SETTLE_TIME_MS = 400

const defaultContextValue: AiFirstCadContextValue = {
  codeCadPaneAssignments: DEFAULT_CODE_CAD_PANE_ASSIGNMENTS,
  isCanvasGridVisible: true,
  isCodeLeftPaneVisible: false,
  isCodeStreamVisible: true,
  mode: 'ai',
  projectEditRevision: 0,
  sceneFeatureTreeVisibility: DEFAULT_SCENE_FEATURE_TREE_VISIBILITY,
  notifyProjectEdited: () => {},
  setCanvasGridVisible: () => {},
  setCodeCadPaneContent: () => {},
  setCodeLeftPaneVisible: () => {},
  setCodeStreamVisible: () => {},
  setMode: () => {},
  setSceneFeatureTreeVisible: () => {},
}

const AiFirstCadContext =
  createContext<AiFirstCadContextValue>(defaultContextValue)

function getInitialMode(): AiFirstCadMode {
  const storedMode = localStorage.getItem(AI_FIRST_CAD_MODE_STORAGE_KEY)
  return storedMode === 'manual' || storedMode === 'code' ? storedMode : 'ai'
}

function getInitialSceneFeatureTreeVisibility(): SceneFeatureTreeVisibility {
  const storedVisibility = localStorage.getItem(
    SCENE_FEATURE_TREE_VISIBILITY_STORAGE_KEY
  )
  if (!storedVisibility) {
    return DEFAULT_SCENE_FEATURE_TREE_VISIBILITY
  }

  try {
    const parsedVisibility = JSON.parse(storedVisibility) as Partial<
      Record<SceneCadMode, unknown>
    >
    return {
      manual:
        typeof parsedVisibility.manual === 'boolean'
          ? parsedVisibility.manual
          : true,
      code:
        typeof parsedVisibility.code === 'boolean'
          ? parsedVisibility.code
          : true,
    }
  } catch {
    return DEFAULT_SCENE_FEATURE_TREE_VISIBILITY
  }
}

export function AiFirstCadProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<AiFirstCadMode>(getInitialMode)
  const [isCanvasGridVisible, setCanvasGridVisible] = useState(true)
  const [isCodeLeftPaneVisible, setCodeLeftPaneVisible] = useState(false)
  const [isCodeStreamVisible, setCodeStreamVisible] = useState(true)
  const [codeCadPaneAssignments, setCodeCadPaneAssignments] =
    useState<CodeCadPaneAssignments>(DEFAULT_CODE_CAD_PANE_ASSIGNMENTS)
  const [sceneFeatureTreeVisibility, setSceneFeatureTreeVisibility] =
    useState<SceneFeatureTreeVisibility>(getInitialSceneFeatureTreeVisibility)
  const [projectEditRevision, setProjectEditRevision] = useState(0)
  const pendingEditNotification = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined)

  const setMode = useCallback((nextMode: AiFirstCadMode) => {
    localStorage.setItem(AI_FIRST_CAD_MODE_STORAGE_KEY, nextMode)
    setModeState(nextMode)
  }, [])

  const notifyProjectEdited = useCallback(() => {
    clearTimeout(pendingEditNotification.current)
    pendingEditNotification.current = setTimeout(() => {
      setProjectEditRevision((revision) => revision + 1)
    }, AI_EDIT_SETTLE_TIME_MS)
  }, [])

  const setCodeCadPaneContent = useCallback(
    (slot: CodeCadPaneSlot, content: CodeCadPaneContent) => {
      setCodeCadPaneAssignments((assignments) =>
        assignCodeCadPaneContent(assignments, slot, content)
      )
    },
    []
  )

  const setSceneFeatureTreeVisible = useCallback(
    (sceneMode: SceneCadMode, visible: boolean) => {
      setSceneFeatureTreeVisibility((currentVisibility) => {
        const nextVisibility = updateSceneFeatureTreeVisibility(
          currentVisibility,
          sceneMode,
          visible
        )
        localStorage.setItem(
          SCENE_FEATURE_TREE_VISIBILITY_STORAGE_KEY,
          JSON.stringify(nextVisibility)
        )
        return nextVisibility
      })
    },
    []
  )

  useEffect(
    () => () => {
      clearTimeout(pendingEditNotification.current)
    },
    []
  )

  const value = useMemo(
    () => ({
      codeCadPaneAssignments,
      isCanvasGridVisible,
      isCodeLeftPaneVisible,
      isCodeStreamVisible,
      mode,
      notifyProjectEdited,
      projectEditRevision,
      sceneFeatureTreeVisibility,
      setCanvasGridVisible,
      setCodeCadPaneContent,
      setCodeLeftPaneVisible,
      setCodeStreamVisible,
      setMode,
      setSceneFeatureTreeVisible,
    }),
    [
      codeCadPaneAssignments,
      isCanvasGridVisible,
      isCodeLeftPaneVisible,
      isCodeStreamVisible,
      mode,
      notifyProjectEdited,
      projectEditRevision,
      sceneFeatureTreeVisibility,
      setCodeCadPaneContent,
      setMode,
      setSceneFeatureTreeVisible,
    ]
  )

  return (
    <AiFirstCadContext.Provider value={value}>
      {children}
    </AiFirstCadContext.Provider>
  )
}

export const useAiFirstCad = () => useContext(AiFirstCadContext)
