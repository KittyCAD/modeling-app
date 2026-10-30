# Application architecture

**Note:** this document is a vision for the architecture we want, not the architecture we have. This document will not contain an attempt to map from here to there; that we will continue to work through using Task issues and other planning documents.

Zoo Design Studio is a web application made using an MVC-like architecture. Our models and controllers are handled by our capabilities system, and our views are rendered via React. We wrap the web application in an Electron desktop environment to enable desktop-like interactions and behaviors in a versioned binary as well.

Some design principles of the application include:
- All persistent state related to CAD, CAM, etc is encoded as KCL, our domain-specific language
- All persistent configuration is stored settings TOML files; inheriting from a user level and a project level
- A project is a directory containing a `project.toml` file in the root and at least 1 `*.kcl` file somewhere nested within
- All subsystems should be modeled as registered capabilities which provide services for other subsystems to consume, services containing controller methods and reactive state in the form of Preact Signals 
- Subsystems should accept extension in the form of ValueSpecs from other subsystems and extensions.

## The capabilities system

**Note:** @franknoirot has really struggled with what words to use for this stuff. Please help us find one set of terminology! We've used: capability, subsystem, extension, registry item to all mean the same thing, and "plugin" to mean a runtime-toggleable version of that thing.

Our application core is based on the notion of ["Facets" as described by M. Haverbeke for CodeMirror](https://marijnhaverbeke.nl/blog/facets.html), but is built upon Preact Signals for reactive state instead of CodeMirror's complete state recreation approach. The primitives available to a capability include:
- Services: a capability can provide an object containing methods and/or state values (we recommend Preact Signals for reactivity)for other capabilities to consume and make use of.
- ValueSpecs: an extension point backed by a Preact computed Signal, the direct corollary to CodeMirror's Facet concept. Once a capability provides the app with a ValueSpec, other later capabilities can contribute values to the ValueSpec, and the system will update accordingly. Commands, settings, modes, and tools are value specs in ZDS.
- Compartment: a transparent group of provided capability items which can be reconfigured at runtime; another concept directly borrowed from CodeMirror, but powered by Preact Signals in our app. "Plugins", which are capabilities that can be turned off by toggling a setting while the app is running, are powered by compartments.

The initial boot of our application assembled a list of contributed registry items or capabilities (see note above on terminology woes), which is then sorted in dependency order and prepared in other ways, then initialized. During runtime, the users actions cause state updates in the application's registered capabilities, which in turn my cause a spiderweb of called Services, recomputed Signals, derived ValueSpecs, and reconfigured Compartments, resulting in a re-renderer view layer, and so on. 

The primary motivation for this opinionated architecture is to make *extensibility* a first-class consideration of application composition. We envision ZDS as a toolkit that can be contributed to easily by third-party developers and user teams with just a little technical know-how. Our true dream is that a CAD team can talk to our in-app agent Zookeeper and have it create a user extension for their team that registers the capabilities that they need in ZDS as their own custom plugin: contributing layout areas, editor tools, modes, keybindings, and more merely by contributing ValueSpecs to the capabilities our core team provides for them.

Conversely, the capabilities system is meant to make it possible to strip ZDS down to merely a viewer, or merely a KCL code editor, and otherwise let ZDS be as minimal as it needs to be for a given use case.

## Core capabilities

The capabilities that our core team provides for users and developers include:
- layout
- commands
- settings
- keymap
- routes
- libraries
  - local
  - cloud
- projectSession
  - lsp
  - editorCapabilities
- fileOperations
- kclCore
  - kclLSP
  - kclScene
  - kclGUI
- zookeeper
- markdownCore
  - markdownLSP
  - markdownPreview
- ...etc

These capabilities are meant to cover the baseline project and editor "gameplay loop", and provide extensible points for more experiences to be layered on top. 
