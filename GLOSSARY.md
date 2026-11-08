# Glossary

## Design Studio

How we refer to the entire application and all its subsystems. You may often see us refer to "modeling app", "the app", or "ZDS", which are all synonymous.

## Top Bar

The element found at the top (yay descriptive names!) of our interfaces. It is used for navigating around the app, managing your user and project information, and sharing.

## Status Bar

The element found at the bottom of our interfaces. It is used to get information about where you are and what you're doing in the application at the moment.

The left side is for "global" items like your network status, and the right side is for "local", context-specific information such as your current selection in the Workbench.

## Home

The interface within Design Studio where users can choose which project to open, and can create new ones. It consists of a Top Bar, Project Browser, and Status Bar.

![Home interface in ZDS](/public/glossary/home.png)

## Project Browser

The element found in the middle of the Home interface. It shows projects available to be opened in an area on the right, and a sidebar on the left with action buttons to create blank, generated, or sample projects.

## Workspace

The interface within Design Studio where the user does the real CAD work. It consists of a Top Bar, a Layout, and a Status Bar.

![Workspace interface in ZDS](/public/glossary/workspace.png)

## Workbench

A configuration of the Workspace arranged for one aspect of the CAD ecosystem. Currently the Workspace only has a "modeling" Workbench, but the foundational technologies for drawing and manufacturing Workbenches are under active development by other teams, and will be integrated into ZDS.

**Related:** an [Editor mode](#editor-mode) chooses how one buffer is displayed within the Workbench. Changing editor modes does not select a different Workbench configuration.

## Layout

The arrangement of Areas, Splits, and Panes in the Workbench which house the Design Studio working interfaces.

## Areas

The simplest Layout component. These are the contents of the actual Workbench interface.

## Splits

A kind of Layout that consists of two or more Layouts divided, with a draggable boundary between them. Can be horizontal or vertical.

## Panes

A kind of Split Layout that lets users toggle which Layout elements are active within it. It consists of a pane control bar and a Split Layout of all active panes.

### Pane control bar

An element which contains a row of buttons that allow users to toggle the activity of Panes. It can be on the top, bottom, left, or right side of a Pane Layout.

## Scene

An Area showing the 3D modeling scene. It contains controls to manipulate the CAD assembly and scene via "point & click" interaction. It houses a toolbar of modeling operations to perform, as well as view orientation controls.

### Toolbar

An element within the Scene that contains buttons to invoke modeling operations. It changes based on the current modeling state, such as being in sketch mode.

### View Controls

A cluster of interface elements within the Scene that help the user orient themselves in the 3D space of the Scene.

## Feature Tree

An Area showing the operations used in the CAD assembly. You can think of it as an editable history of modeling operations you've performed.

## Code Editor

An Area housing a code editor for our underlying language for CAD, called [KCL](https://zoo.dev/docs/kcl-book/intro.html). From here you can edit the model directly, and often use features that we are still developing "point & click" workflows for within the Scene.

**Related:** [Editor](#editor) names the live buffer object in the tabbed editor system; [Editor mode](#editor-mode) names a component that displays it. The Code mode supplies that system's CodeMirror interface. These concepts distinguish the buffer and its display from the Code Editor Area.

## Zookeeper

An Area housing a chat interface with our AI agent. From it you can ask questions about your project, generate CAD models, request edits, and more.

![Zookeeper](/public/glossary/zookeeper.png)

### Prompt

The message or instruction you send to Zookeeper. Prompts can be questions, requests to generate or edit geometry, or anything else you want the agent to do.

### Response

The message Zookeeper sends back after processing a prompt. Responses can include explanations, questions, or actions taken in the project. Zookeeper may suggest next steps as followup edits to the response.

### Tool

A specific capability Zookeeper can use to do something in Design Studio, like creating geometry, editing a feature, or reading project state.

### Cancel

Stops the current Zookeeper operation. Use this when you don't want the current request to finish.

### Reasoning

The internal process Zookeeper uses to decide what to do. This is not always shown directly, but it influences the response and the actions taken.

## Semantic color role

A visual purpose, such as primary text or a secondary surface, whose color is resolved through the active theme. Components select roles through shared utilities such as `text-default`, `bg-2`, and `b-4`. Background, foreground, and border roles have separate scales.

**Also called:** semantic role; visual role, when discussing color.

**Related:** a palette supplies concrete colors; a theme assigns those colors to roles; a semantic utility selects a role in component styling. The [appearance guide](docs/design-system/appearance.md) explains how to choose and extend roles.

**Search anchors:** [semanticColors.css](src/semanticColors.css), [tailwind.config.js](tailwind.config.js).

## Editor

A live text buffer managed by the editors service. An editor has a stable identity, optional source path, and owned CodeMirror state, including selection and undo history. It survives changes to the component displaying it and closes with its project or an explicit close action. Multiple editors can refer to the same file while retaining independent contents.

**Also called:** open editor; editor instance.

**Related:** a file can supply its initial contents; a text buffer holds its working contents; an [Editor mode](#editor-mode) displays it. The [Code Editor](#code-editor) entry describes a UI Area.

**Search anchors:** `Editor`, `EditorsService` in the [editors contract](src/lib/editors/registry/contract.ts).

## Editor mode

A contributed component that displays an editor's buffer. An editor can offer several matching modes and retain the user's selected mode. Switching modes preserves the editor's identity, contents, and history. The Code mode supplies the CodeMirror editing interface.

**Also called:** editor view, in the contribution API; contributed surface, in implementation comments. Qualify these names because view also refers to CodeMirror's `EditorView`.

**Related:** [Editor](#editor) supplies the buffer; [Code Editor](#code-editor) describes the familiar editing Area; [Workbench](#workbench) describes a broader Workspace configuration.

**Search anchors:** `EditorViewContribution`, `editorViewValueSpec` in the [editors contract](src/lib/editors/registry/contract.ts).

### Mode context

Data supplied to a mode's component by an optional context provider. The context belongs to a particular editor and mode. It is created when that mode is first selected, survives mode switches and component remounts, and is released when the editor closes, the contribution is removed, or the mode stops matching.

**Related:** the context provider creates the value; the [Editor mode](#editor-mode) receives it; registered cleanup releases resources acquired for it. A provider and its returned context are distinct concepts.

**Search anchors:** `EditorViewHost` in the [editors contract](src/lib/editors/registry/contract.ts), `defineEditorView(provider)` in [views.ts](src/lib/editors/views.ts).

## Editor capability

A contribution that supplies CodeMirror extensions to matching editors. Capabilities provide editing behavior such as syntax highlighting, history, or keybindings. Applicability can depend on the source path, contents, language classification, or a wildcard.

**Related:** [Editor](#editor) receives the behavior; [Editor language classification](#editor-language-classification) helps determine applicability; [Editor mode](#editor-mode) determines the component displaying the buffer.

**Search anchors:** `EditorCapability`, `editorCapabilityValueSpec` in the [editors contract](src/lib/editors/registry/contract.ts); `EditorMatcher` and `matchesEditor` in [matching.ts](src/lib/editors/matching.ts).

## Editor language classification

The language ID and optional media type associated with an editor. Registered language descriptors infer classification from the source and contents. A caller can explicitly choose a registered language, including for an unnamed buffer, or clear that choice to resume inference.

**Also called:** editor classification, in the editor-service documentation.

**Related:** a filename extension can help infer classification; a media type, also called a MIME type, describes the format; an [Editor mode](#editor-mode) is a separate display choice.

**Search anchors:** `EditorClassification`, `EditorsService.setLanguage` in the [editors contract](src/lib/editors/registry/contract.ts). See [editor-contributions.md](docs/editor-contributions.md) for matching and explicit language choices.
