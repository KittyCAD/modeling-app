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

![Home](/public/glossary/home.png)

## Project Browser

The element found in the middle of the Home interface. It shows projects available to be opened in an area on the right, and a sidebar on the left with action buttons to create blank, generated, or sample projects.

## Workspace

The interface within Design Studio where the user does the real CAD work. It consists of a Top Bar, a Layout, and a Status Bar.

![Workbench](/public/glossary/workbench.png)

## Workbench

A configuration of the Workspace arranged for one aspect of the CAD ecosystem. Currently the Workspace only has a "modeling" Workbench, but the foundational technologies for drawing and manufacturing Workbenches are under active development by other teams, and will be integrated into ZDS.

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

## Text-to-CAD

An Area housing a chat interface with our Machine Learning tools. From it you can ask questions about your model, request edits, and more.
