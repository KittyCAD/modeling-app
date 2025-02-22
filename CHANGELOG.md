# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 

### Changed

-

### Fixed

-

## [v0.44.0] - 2025-02-19

##### Changed
* Not auto-hiding the menu bar on Windows and Linux, helps with Trackpad Friendly mouse mode

##### Fixed
* Units not getting set properly with whole module imports. This fixes the loading of samples like the [multi-axis robot arm](https://zoo.dev/docs/kcl-samples/multi-axis-robot)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.43.0...v0.44.0

## [v0.43.0] - 2025-02-18

##### Changed
* Breaking: KCL: More stdlib functions now use keyword args. See links for how to migrate to new syntax:
  * [offsetPlane](https://zoo.dev/docs/kcl/appearance#examples)
  * [patternTransform](https://zoo.dev/docs/kcl/patternTransform#examples)
  * [patternTransform2d](https://zoo.dev/docs/kcl/patternTransform2d#examples)
  * [patternCircular2d](https://zoo.dev/docs/kcl/patternCircular2d#examples)
  * [patternCircular3d](https://zoo.dev/docs/kcl/patternCircular3d#examples)
  * [patternLinear2d](https://zoo.dev/docs/kcl/patternLinear2d#examples)
  * [patternLinear3d](https://zoo.dev/docs/kcl/patternLinear3d#examples)

##### Added
* Multiple profiles in the same sketch
* Share link to part through Zoo
* Support comments in the middle of keyword function calls

##### Fixed
* Fix formatting to preserve annotations when program is otherwise empty
* Multi-second blank screen on second instance of the app
* Fix performance issue when using lots of KCL functions.

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.42.0...v0.43.0

## [v0.42.0] - 2025-02-11

##### Changed
* Breaking: KCL: [Sweep](https://zoo.dev/docs/kcl/sweep#examples), [Shell](https://zoo.dev/docs/kcl/shell#examples), [Appearance](https://zoo.dev/docs/kcl/appearance#examples) stdlib functions now uses keyword args. See links for how to migrate to new syntax.
* KCL: Patterns of patterns can use the original sketch/solid as target
* Onboarding bracket with SSI
* Update lower-right corner units menu to read and edit inline settings annotations if present 
* Let users have big editors

##### Added
* Edit flows for extrude and offset plane operations
* Back button to the onboarding buttons, move the dismiss button to a little corner `x` button

##### Fixed
* Use of non-platform agnostic separator
* Invalidate execution cache when top-level annotations change
* Resizing view breaking app on high DPI displays
* Don't close the command palette on backspace
* Remove noisy log line in linux by @TomPridham
* Inserting revolve command accounts for axis dependency
* Shift-Click to Deselect Edges/Faces

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.41.0...v0.42.0

## [v0.41.0] - 2025-02-05

##### Changed
* Breaking: KCL now uses keyword arguments for `line`, `lineTo`, `extrude`, and `close`.
  See the instructions below to migrate existing models. 

> **Why are we doing this?** 
> Because it'll let us evolve the KCL standard library, adding new options to functions without breaking existing code. We don't want to have a painful annual release process where you upgrade all your KCL code from 1.1 to 1.2 and a bunch of things break. In the future, if we want to add a new option, it'll be added as a new optional keyword argument. For example, we will probably let you pass a `diameter` to build a circle, instead of a `radius`. You can then use whichever keyword you want (and it'll give you an error if you use both, or neither).
> 
> This also helps us integrate a constraint solver in the future -- you'll be able to pass fewer keyword arguments, and the constraint solver will fill in the missing values for you 🙂 Eventually.
> 
> **What is changing?**
> The first few functions we're changing are `line`, `lineTo`, `extrude` and `close`. Here's a before-and-after example:
> 
> `line([3, 4], mySketch, $myTag)`
> becomes
> `line(mySketch, end = [3, 4], tag = $myTag)`
> 
> Note that the _first_ argument doesn't need a label. Keyword functions may declare _at most one_ argument that doesn't need a label. If used, this has to be the first argument. 
> 
> Also, if you use an unlabeled argument in a `|>` you can omit the argument, and it'll be implicitly set to `%`. This means `%` isn't needed most of the time anymore.
> 
> **Example**
> ```
> box = startSketchOn("XZ")
>   |> startProfileAt([10, 10], %)
>   |> line([10, 0], %)
>   |> line([0, 10], %)
>   |> line([-10, 0], %, $thirdLineOfBox)
>   |> close(%)
>   |> extrude(5, %)
> ```
> becomes
> ```
> box = startSketchOn("XZ")
>   |> startProfileAt([10, 10], %)
>   |> line(end = [10, 0])
>   |> line(end = [0, 10])
>   |> line(end = [-10, 0], tag = $thirdLineOfBox)
>   |> close()
>   |> extrude(length = 5)
> ```
> **Migration**
> Here is a list of regexes you can use to find-and-replace your old KCL code with the new keyword argument code. You can run this in ZMA's find-and-replace (ctrl+F or cmd+F in the KCL code panel), or in VSCode's global find-and-replace (so you can fix up all your files at once). Note this won't trigger for any multi-line function calls (where you separate each argument with a newline). For those you'll have to fix it up manually, sorry!
> 
> ```
> \bline\(([^=]*), %\)
> line(end = $1)
> 
> \bline\((.*), %, (.*)\)
> line(end = $1, tag = $2)
> 
> \blineTo\((.*), %\)
> line(endAbsolute = $1)
> 
> \blineTo\((.*), %, (.*)\)
> line(endAbsolute = $1, tag = $2)
> 
> \bextrude\((.*), %\)
> extrude(length = $1)
> 
> \bextrude\(([^=]*), ([a-zA-Z0-9]+)\)
> extrude($2, length = $1)
> 
> close\(%, (.*)\)
> close(tag = $1)
> 
> close\(%\)
> close()
> ```

##### Added
* Point-and-click Sweep and Revolve
* Project thumbnails on the home page
* Trackball camera setting
* File tree now lets you duplicate files
* Dedicated section for construction commands in the toolbar

##### Fixed
* Highlighted code in the editor is now easier to read in dark mode
* Artifact graph now survives when there's an execution error 

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.40.0...v0.41.0

## [v0.40.0] - 2025-01-31

##### Added
* Reason for dry-run validation failure provided in error toasts (Shell and Loft commands)

##### Fixed
* Units in samples after the removal of `project.toml`

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.39.0...v0.40.0

## [v0.39.0] - 2025-01-31

##### Added
* Per-file units, use`@settings(defaultLengthUnit = in)` at the top of your files!

##### Fixed
* Clearing sketch DOM elements after redirecting to the home page
* Center rectangle now works again, works with new LiteralValue structure
* Open project command lists project names
* Imports in projects with subdirectories

##### Deprecated
* Deprecate `import("file.obj")`. Use `import "file.obj"` instead.


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.38.0...v0.39.0

## [v0.38.0] - 2025-01-28

##### Changed
* Tweaks to clarify tooltips from tool dropdown menus

##### Fixed
* "No results found" now shown for empty search results in command palette
* Badge indicator now placed over the respective button in the sidebar
* Properly setting selection range when KCL editor is not mounted
* Extra margins removed on some code editor menu items
* Scene units now set on a module's default units

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.37.0...v0.38.0

## [v0.37.0] - 2025-01-20

##### Changed
* Uniqueness check to "Create project" command, and more consistent naming across the app

##### Added
* Return key to go through Onboarding steps
* 3-point circle interactive sketch tool
* Orbit in sketch mode via user setting
* Selection dry-run validation for Shell


##### Fixed
* Show toolbar tooltips on hover only, hide when dropdowns are open
* Loft command prompt focus


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.36.1...v0.37.0

## [v0.36.1] - 2025-01-16

##### Fixed
* KCL samples not loading in v0.36.0 since 2024-01-14

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.36.0...v0.36.1

## [v0.36.0] - 2025-01-14

##### Added
* KCL stdlib function to pop from arrays by @guptaarnav
* Code editor autocomplete shows when a KCL stdlib function is deprecated
* Point-and-click deletion (Backspace or Delete) of lofts, shells, and offset planes
* KCL helixes are now available (no point-and-click yet)

##### Fixed
* Open updater toast changelog links externally by @marc2332
* Refactor: removed unused `UpdaterModal` component by @marc2332
* Error for missing a closing bracket clearer
* Show the stream while the scene builds, relevant for large files
* More testing for foreign characters in project name
* Wasm panic catching errors and restoring application state and WebAssembly instance
* Shell point-and-click picking the wrong face with piped extrudes

##### New Contributors
* @marc2332 made their first contribution in https://github.com/KittyCAD/modeling-app/pull/4791

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.35.0...v0.36.0

## [v0.35.0] - 2025-01-07

##### Added
* Toolbar button for Text-to-CAD
* Prompt-to-edit and its toolbar button 
* 3-point circle sketch tool and KCL stdlib function
* First draft of a feature tree pane
* KCL: support for non-integer fractional numbers in KCL rem() arguments
* Enable enter for autocompletions in the command palette KCL input
* Add parsing keyword function calls inside pipelines 

##### Changed
* Breaking: Remove backwards compatibility for snake case in KCL objects

##### Fixed
* Don't error on failure to fetch privacy settings to fix LSP in dev mode by @TomPridham (thank you!)
* Match package license to LICENSE file by @mattmundell (thank you!)
* CodeMirror KCL: Support `=` in record init and new function syntax by @mattmundell (thank you!)
* Remove the old Loft GitHub issue link in the toolbar
* Use app foreground color for focus outline button color so there's no hue collision

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.34.0...v0.35.0

## [v0.34.0] - 2024-12-19

##### Added
* Under the hood: Basic program generation for improved caching

##### Fixed
* Issue with the code editor getting stuck on a sample part for some macOS users on v0.33.0


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.33.0...v0.34.0

## [v0.33.0] - 2024-12-19

##### Changed
* KCL: completions to use new `=` syntax for object arguments instead of old `:`
* KCL: stdlib function `startSketchAt()` now deprecated, with`startSketchOn()` remaining the preferred option
* KCL: unlabeled first parameter now defaults to `%`

##### Added
* KCL: completion supported from import statements
* KCL: Implemented boolean logical and/or, thanks @guptaarnav!
* Dry-run validation for Loft
* Double click label on sketch to dimension


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.32.0...v0.33.0

## [v0.32.0] - 2024-12-16

##### Changed
* Multi-profile sketch on v31 didn't prove stable enough and is now pulled back. Will be enabled again in a subsequent release.

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.31.0...v0.32.0

## [v0.31.0] - 2024-12-14

#### What's Changed

##### Added
* Multi profile sketching
* KCL stdlib: Add atan2 function 
* KCL: Keyword fn args like "x = 1" not like "x: 1"
* make pipe have a hole 
*Color picker in the code pane 
* KCL: sweep function
* Add a right-click menu to the stream

##### Changed 
* Loft uses kw arguments

##### Fixed
* Fix onboarding rendering 
* Fix KCL warnings in doc comments from let, const, and new fn syntax 

## [v0.30.0] - 2024-12-11

##### Added
* KCL: Implement `as` aliases for sub-expressions
* Add point-and-click Loft
* KCL: Keyword argument function calls
* Surface KCL warnings to frontend and LSP
* AST: Allow KCL fn params to have defaults and labels
* KCL: Add some more warnings
* Add point-and-click Shell
* KCL keyword args: calling user-defined functions
* Add point and click revolve workflow for sketch and axis selection
* Add a "current" marker to UnitsMenu

##### Changed 
* KCL: Module/import upgrades
* Update bracket KCL variable syntax in onboarding
* Move `length` and `named value` constraint flows into command palette

##### Fixed
* Fix: upon entering sketch mode, axis do not rotate
* Fix: replace whitespace with a `-` so that ids are valid and scroll to works
* Bug: Setting mouse controls to OnShape or AutoCAD resets to default
* Bug: KCL formatter removes 'fn' from closures
* KCL: Fix so that tag declarators can be used as parameters
* Fix to not have browser tooltip on top of editor tooltips
* More consistent GitHub links
* Change diagnostic action button to primary color

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.29.0...v0.30.0

## [v0.29.0] - 2024-12-03

#### Changed
* KCL: `=` and `=>` are now optional in function declarations

#### Added
* Ability to immediately enter sketch mode by double-clicking an existing sketch

#### Fixed
* Folder directory count on the projects page, thanks @TomPridham!

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.28.0...v0.29.0

## [v0.28.0] - 2024-11-26

#### Changed
* KCL: 
  * Object literals like `{x}` as shorthand for `{x = x}`
  * Executor returns specific errors, not anyhow
  * Add patternTransform2d for sketches
  * Allow transform patterns to return multiple transforms
  * Record initialization (AKA objects) uses `=` instead of `:`, as in `{ x = 0, y = 1 }`
  * Implicit conversion of round numbers to integers
  * Add round stdlib function
  * Add tangentToEnd stdlib function
* Selections Refactor

#### Added
* Offset plane point-and-click user flow
* Nightly link in the About section
* Warnings for recently deprecated syntax


#### Fixed
* Selection bugs
* Enter sketch mode bug
* Argument error to point to the arg at the call site


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.27.0...v0.28.0

## [v0.27.0] - 2024-11-20

#### Changed
* Exported file names now following KCL instead of `output`
* Better docs for reduce
* Better management of file writing
* JSON removed from the KCL object model
* BREAKING: KCL has new reserved words that can no longer be used for variable or function names: `_` (underscore), `as`, `new`, `interface`, `type`, `record`, `struct`, `object`, `self`, `array`
* BREAKING: KCL `import()`'s `type:` parameter changed to `format:`

#### Added
* Center rectangle
* Basic horizontal and vertical snapping for Line tool
* KCL modules and `import` statements

#### Fixed
* Linux AppImage updater
* Finding path to node for import and if-else
* Description of angleToMatchLengthX fixed
* KCL formatting of return values now indents properly

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.26.5...v0.27.0

## [v0.26.5] - 2024-11-13

#### Fixed
* Fix bug where accepting an autocompletion would break the code editor (#4476)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.26.4...v0.26.5

## [v0.26.4] - 2024-11-08

#### Added
* New performance metrics window available from lower-right corner button (#4145)

#### Fixed
* Reverted issue that caused major slowdown while using app (#4450)
* <kbd>Alt</kbd> / <kbd>Option</kbd> + drag on numbers in code editor is more precise (#3997)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.26.3...v0.26.4

## [v0.26.3] - 2024-11-07

#### Changed
* File tree acts more like VS Code's file tree (#4392)
* Creating new projects asks for project name before creating (#4109)

#### Added
* Snap-to-origin and axis behavior for sketch profile starts and segments (#4344)
* KCL: `polygon` standard library function (Thanks @guptaarnav) (#4300)
* KCL: Add ability to `push` to arrays (Thanks @guptaarnav (#4232)
* Implement a simple startSketchOn / offsetPlane lint rule (#4384)
* KCL: More ways to reference paths (#4387)
* Error if assertEqual's epsilon value is invalid (#4329)
* Show top-level project directory name in file tree pane header (#4165)
* Add ability to open, create, rename, and delete projects from inside one via command bar (#4109)

#### Fixed
* Fix KCL source ranges to know which source file they point to (#4418)
* Fixed directory/file selection logic to deselect folders properly and always hightlight files.  (#4408)
* Directories starting with "." no longer show up in project listing (Thanks @guptaarnav) (#4317)
* Fixed invalid blank screen when user starts modeling app from path that does not exist (Thanks @guptaarnav) (#4161)

#### Contributors
* Thanks again to @guptaarnav for more thoughtful contributions!

## [v0.26.2] - 2024-10-26

#### What's Changed
* Fix NetworkMachineIndicator and machines dynamically showing in CommandBar (#4311)
* Bugfix: arc paths were stored as straight line paths (#4310)
* Make application aware it saved the buffer and not something else (#4314)
* Add a radius length indicator to the circle sketch tool (#4304)
* Update machine-api spec (#4305)
* Chore: Don't let draft lines receive mouseEnter/Leave events, or create invalid overlays (#4306)
* Tags should refer to full paths, not just base paths. (#4299)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.26.1...v0.26.2

## [v0.26.1] - 2024-10-24

#### KCL
* Support negative start and end in ranges (#4249)

#### Bug fixes
* Disable rotate on start new sketch (#4287)
* Stop propagation of camera clicks after drags (#4257)
* Fix engine connection break when starting onboarding from a fresh install (#4263)
* Fix job name for printers (#4234)

#### Performance
* Remove setInterval implementations from camera controls (#4255)
* Buffer file writes, because writing to file after every keypress has bad consequences (#4242)

#### Internal dev work
* Rename Sketch.value to Sketch.paths (#4272)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.26.0...v0.26.1

## [v0.26.0] - 2024-10-18

### Changed:

* KCL: the `repetitions` property of all pattern functions are now `instances`, and now is the total count. For example, if you previously used `repetitions: 3` you should now use `instances: 4`.

### Added:

* KCL: Ranges now support arbitrary start and end values, eg. `[x..100]`
* KCL: Add `==`, `!=`, `>`, `>=`, `<`, `<=` for use in if/else expressions 🎉
* Machine API now shows additional printer info when available

### Fixed:

* KCL: Standard library `import` function works again
* KCL: Permitting whitespace before colon thanks to community member @guptaarnav ❤️
* UI: selection order does not matter on multi-select constraints like equal length
* ...and many more

### New contributors:

Thank you @guptaarnav for your [first PR](https://github.com/KittyCAD/modeling-app/pull/4171)!

## [v0.25.6] - 2024-10-08

  #### What's Changed
  * KCL: No 'let' or 'const' keyword required when declaring vars (#4063)
  * KCL: new standard library 'map' function (#4054)
  * KCL: If-else expressions (#4022)
  * Add menu item and hotkey to center view on current selection (#4068)
  * KCL: Reduce can take and return any KCL values (#4094)
  * File tree and projects now reload when there are external changes on the file system (#4077)
  * and many more bug fixes and improvements

  **Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.25.5...v0.25.6

## [v0.25.5] - 2024-09-30

#### What's Changed
* **Breaking change:** `part001.sketchGroup.tags` is now `part001.sketch.tags` (#4016)
* Orthographic projection is the new default. You can change it in User settings or toggle to Perspective in the lower-right corner (#3983)
* Add ability to open KCL samples in-app (#3912)
* Add ability to sketch on chamfered faces via point-and-click (#3918)
* Add ability to mirror unclosed sketch profiles (#3851)
* KCL: you can now apply rotations when using `patternTransform` (#3979)
* KCL: new standard library 'rem' function to get remainder (#3999)
* Bugfix to autocomplete ordering (#4018)
* An in-app notification will alert you when a new update is downloaded (#3902)
* and many other bug fixes and infrastructure improvements from the whole team

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.25.4...v0.25.5

## [v0.25.4] - 2024-09-23

#### What's Changed
* KCL Breaking change: Circle function arguments have changed from`circle([yourCenterX, yourCenterY], yourRadius, sketch, tag?)` to `circle({ center: [yourCenterX, yourCenterY], radius: yourRadius }, sketch, tag?)`  (#3860)
* Circle now has a point-and-click tool while sketching! (#3860)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.25.3...v0.25.4

## [v0.25.3] - 2024-09-21

#### What's Changed
* Update app to sync with breaking change
* Implement from for unit length (#3932)
* Bump the world (kcl-lib) (#3930)
* Fix edge cut logic (#3928)
* Fix zoom callback on camera controls (#3924)
* zoom level increase when swapping sketch modes (#3854)
* Fix power syntax "4 ^ 2" (#3900)
* Bug fix: make dismiss during export not fire success toast (#3882)
* Fix canExtrudeSelectionItem and getSelectionType for multiple selections (#3884)
* Make light theme borders more contrasting, update sidebar icons (#3883)
* Fix: Opposite adjacent edge selection (#3896)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.25.2...v0.25.3

## [v0.25.2] - 2024-09-16

#### What's Changed
* Sketch segment labels now align to segments (#3796)
* The "reset settings" button now only resets current level (#3855)
* Updates to the onboarding example project bracket (#3874)
* So many bug fixes and architecture improvements from the whole team ❤️ 

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.25.1...v0.25.2

## [v0.25.1] - 2024-09-07

#### What's Changed
* Double-click to open KCL files can now open multiple windows (#3777)
* Extrusion commands are now batched, improving performance (#3764)
* Mark Loft as "KCL only" in toolbar, add a link to docs (#3798)
* Bug fix: toolbar buttons are clickable again (#3800)
* Bug fix: app window is now draggable on sign-in page (#3795)
* Bug fix: remove flash of white background in dark mode startup (#3794)
* KCL: small refactors to Extrude (#3768)
* A bunch of bug fixes and new tests

## [v0.25.0] - 2024-09-05

#### What's Changed
* We migrated desktop app platforms! and we wrote 50+ new tests to celebrate 😄 
* Lofts are now available in KCL code (#3681)
* KCL now allows multi-line comments in `|>` expressions (#3731)
* KCL breaking change: replace `tanArc(to)` with `tanArcToRelative` (#3729)
* Execution now halts when swapping files (#3703)
* Newly redesigned sign-in page (#3684)
* Too many bug fixes, tests, and deep system improvements to count
* And official welcome to the frontend team for Kevin, Lee, and Jon ❤️

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.12...v0.25.0

## [v0.24.13] - 2024-08-20

Fixes a CPU bug with text to cad

## [v0.24.12] - 2024-08-15

#### What's Changed
* Add unique index when creating new files or directories with taken names (#3460)
* Fix sketch groups and extrude groups when used inside objects (#3439)
* Remove flakey has no pending logic, let users do whatever they want (#3457)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.11...v0.24.12

## [v0.24.11] - 2024-08-14

#### What's Changed
* More shell examples (#3414)
* Add actual argument type to error message (#3340)
* Add a regression test for when engine returns a export fail (#3407)
* Ability to set tolerances, but with sane defaults (#3397)
* Disallow users to set theme as a project-level setting (#3312)
* Fix files pane height issue (#3337)
* The printer slicer expects mm (#3341)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.10...v0.24.11

## [v0.24.10] - 2024-08-08

#### What's Changed
* Fix settings derp and app start project theme loading (#3320)
* Fix tanArcTo (#3318)
* Set Playwright actionTimeout to 15 seconds (#3115)
* Increase windows stream ping interval (#3317)
* Fix type of sketchGroup function (#3316)
* Fix test: Basic sketch › code pane open at start (#3188)
* Switch projects fix (#3310)
* Persist theme - Reload everything on a disconnect (#3250)
* Start to rework some of our kcl docs (#3222)
* ArtifactGraph snapshot stability (#3305)
* Badge scale on hover (#3298)
* Add a search bar to the projects/home page (#3301)
* Add a little dropdown arrow menu to gizmo with view settings (#3300)
* Reset camera on empty scene (#3293)
* Don't allow edit on sketches with no variable declaration (#3292)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.9...v0.24.10

## [v0.24.9] - 2024-08-06

#### What's Changed
* Reset camera on empty scene (#3293)
* Don't allow edit on sketches with no variable declaration (#3292)
* Add assertEqual function to KCL stdlib (#3279)
* Add "report a bug" mention to user menu onboarding step (#3278)
* Camera breaks on extrude zoom to fit (#3276)
* Jump to error not lint (#3271)
* Coplanar sketch should have diagnostic error. (#3269)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.8...v0.24.9

## [v0.24.8] - 2024-08-05

#### What's Changed
* Jump to error code on badge click (#3262)
* Apply fillets before a shell (#3261)
* Editor repaints any errors when rendered (#3260)
* Add print button (#3133)
* Fix bug when engine returns an error on websocket export (#3256)
* Test for default planes in empty scene (#3249)
* Fix computed properties of KCL objects (#3246)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.7...v0.24.8

## [v0.24.7] - 2024-08-02

#### What's Changed
* Show default planes on empty scene (#3237)
* Re-get the openPanes from localStorage when navigating between projects (#3241)
* Have links clickable within tooltips without clicking content below them (#3204)
* Fix link to keybindings tab in help menu on Windows (#3236)
* Fix cryptic error (#3234)
* Rm error pane show badge on code (#3233)
* Open file with url encoded space (#3231)


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.6...v0.24.7

## [v0.24.6] - 2024-08-01

#### What's Changed
* Bug fix: prevent phantom KCL errors on project switch by Kurt and Frank (#3205)
* Badge appears on KCL Errors pane button when errors are present by Frank (#3208)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.5...v0.24.6

## [v0.24.5] - 2024-07-30

#### What's Changed
* So many bug fixes from the whole team
* KCL: add [polar function](https://zoo.dev/docs/kcl/polar) to standard library by Jess (#3158)
* KCL: add [int function](https://zoo.dev/docs/kcl/int) to standard library by Jon (#3116)
* KCL: add [assert family of functions](https://zoo.dev/docs/kcl/assert) to standard library by Paul
* Tag functions no longer need their sketch as an arg thanks to Jess (#3143)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.4...v0.24.5

## [v0.24.4] - 2024-07-25

#### What's Changed
* Toolbar rewrite with (mostly) static content, rich tooltips, and roadmapped tools by Frank (#3119)
* Unified sidebar, actions in the sidebar like Export by Frank (#3100)
* Clear the diagnostics before processing by Paul (#3118, #3114)
* Add lexical scope and redefining variables in functions by Jon (#3015)
* Fix syntax highlighting on code pane open/close by Lee (#3083)
* Remove sidebar menus in favor of lil' popovers by Frank (#3046)
* Typecheck KCL args via generics, not handwritten impls by Adam (#3025)
* Seperate pending messages from artifact map by Kurt (#3084)
* Many other bug fixes and testing improvements by the team

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.3...v0.24.4

## [v0.24.3] - 2024-07-18

#### What's Changed
* Fix large file import (#3050)
* Show default planes bug (#3047)
* Add a close button to sidebar panes (#3038)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.2...v0.24.3

## [v0.24.2] - 2024-07-17

#### What's Changed
* Stream idling is behind a setting now thanks to Lee (#3032)
* Stability and persistence improvements between engine reconnects by Lee (#2997)
* Sketch tools added back to the command bar by Frank (#3008)
* Format code added to the command palette by Jon (#3001)
* Bug fixes to command bar argument switching by Frank (#3021)
* Descriptions added to command bar by Frank (#3023)
* Basic work-in-progress Fillet point-and-click by Max (local dev only for now!) (#2718)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.1...v0.24.2

## [v0.24.1] - 2024-07-12

#### What's Changed
* Critical bugfix for switching between projects by Kurt (#3012)
* More reliable text editing with deferrers by Jess & Marijn (#3006)
* Bugfix to keep extrude button active after sketch by Lee (#2961)
* Fix Creo camera controls to use correct gestures by Jon (#2963)
* Make deleting start of sketch not break line tool by Kurt (#2983)
* Tons of other bugfixes by the whole team

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.24.0...v0.24.1

## [v0.24.0] - 2024-07-09

#### What's Changed
* Straight sketch segments now display their length by Frank (#2935)
* Stream goes idle when tab is switched away from #savetheplanet thanks to Lee (#2940)
* Better syntax highlighting thanks to a Lezer grammar by Marijn Haverbeke 🤩 and Jess (#2967)
* Re-enabled, improved screen-space ambient occlusion by Kurt (#2956)
* Re-execute when commenting out by Jess (#2974)
* Tags are now scoped to their functions thanks to Jess (#2941)
* Bug fix for math order of operations by Jess (#2398)
* A new unit indicator in lower-right corner, with menu to switch by Frank (#2937)
* Sketch editing bug fix by Lee (#2960)
* Bumped crates, updated docs by Jess & dependabot

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.23.1...v0.24.0

## [v0.23.1] - 2024-07-05

#### What's Changed
* Fix an updater issue found in v0.22.7 and v0.23.0 Windows builds. If you're stuck here please head over to [the website](https://zoo.dev/modeling-app/download) upgrade manually. Sorry for the inconvenience! (#2914)
* Add message "click plane to sketch on" to toolbar after clicking start sketch (#2591)
* Fix core dump screenshot (#2911)
* Pause stream when exiting sketch or extruding (#2900)
* Hide the view until the scene is initially built (#2894)
* Zoom out on extruded object (#2819)
* More codemirror enhancements (#2912)
* Remove react-codemirror and update all the codemirror libs (#2901)
* Cleanup annotations, makes it easier to read (#2905)
* Update release docs (#2906)
* Small codemirror changes (#2898)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.23.0...v0.23.1

## [v0.23.0] - 2024-07-04

#### What's Changed
* Remove scaling code to match engine fixes (only effects delete) (#2902)
* Fix auto complete for circle (#2903)
* Ctrl-c is copy, we should not bind to copy or paste or any common shit (#2895)
* Bug fix:Bad code on exit-sketch should no delete user's code (#2890)
* Fix copilot regression (#2876)
* Disable copilot in sketch mode (#2865)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.22.7...v0.23.0

## [v0.22.7] - 2024-07-01

#### What's Changed

Most importantly the syntax for tags is now `$myTag` to declare a tag and `myTag` to then use it later. If you format your code via `Alt+Shift+F` or the three dot menu on the code panel it will fix this for you. We will keep backwards compatibility with string tags for a few releases but you should update your code now.

The nice thing about this is now the code editor autocompletes tag names for you and now you can get better errors when you abuse tags.

So for example this code:
```
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([65.87, 230.28], %)
  |> line([248.25, -79.48], %)
  |> line([-74.04, -283.09], %, 'myTag')
  |> line([-192.72, 235.18], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(100, %)

const sketch002 = startSketchOn(sketch001, 'myTag')
  |> startProfileAt([185.8, 131.39], %)
  |> line([62.76, -12.99], %)
  |> line([-27.05, -47.61], %)
  |> line([-43.65, 9.37], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
```

Becomes:
```
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([65.87, 230.28], %)
  |> line([248.25, -79.48], %)
  |> line([-74.04, -283.09], %, $myTag)
  |> line([-192.72, 235.18], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(100, %)

const sketch002 = startSketchOn(sketch001, myTag)
  |> startProfileAt([185.8, 131.39], %)
  |> line([62.76, -12.99], %)
  |> line([-27.05, -47.61], %)
  |> line([-43.65, 9.37], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
```


* More semantic tokens modifiers (#2823)
* Move walk handlers out of lint (#2822)
* Update onboarding KCL (#2820)
* Only show one error at once (#2801)
* More expressive semantic tokens (#2814)
* Add more tests for various scenarios (#2812)
* Allow lifetime refs in KCL stdlib parameters (#2802)
* Hide grid (#2777)
* Fix some recast bugs (#2781)
* Tag as top level construct  (#2769)
* Tags are globals (#2795)
* Add sketch tool events to command bar (#2708)
* Allow for sketching on the face of a chamfer in kcl (#2760)
* Execute chamfers and fillets early if in a pattern (#2759)
* Semantic tokens used for highlighting (#2806)
* Delete key works for click and point (#2752)
* Rework zoom (https://github.com/KittyCAD/modeling-app/pull/2798)
* Add setting for grid visibility (https://github.com/KittyCAD/modeling-app/pull/2838)
* Fallback colors for different browsers (https://github.com/KittyCAD/modeling-app/pull/2770)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.22.6...v0.22.7

## [v0.22.6] - 2024-06-23

#### What's Changed
* Fix source range for last command when engine error (#2757)
* Playwright test for hover lsp functions (#2756)
* Save specific commands like fillet and chamfer for last (#2753)

## [v0.22.5] - 2024-06-22

#### What's Changed
* Go back updater versions (#2746)
* Fix point and click code pane closed from start (#2750)
* Retain sketch selection segment color after adding a constraint to the segment (#2700)
* Allow for editing a sketch where extrude or revolve is in the same pipe (#2749)

## [v0.22.4] - 2024-06-22

#### What's Changed
* Fix sharing a sketch surface between profiles (#2744)
* Allow passing a vec of sketches or extrudes thru a user value (#2743)
* Fix one out of bounds error (#2740)
* Disable extrude button if there is no extrudable geometry (#2730)
* Fix sketch on face (#2745)

## [v0.22.3] - 2024-06-21

#### What's Changed
* Reset code on critical onboarding steps (#2727)
* Implement Core Dump for modeling app state (#2653)
* Franknoirot/onboarding avatar text (#2726)
* Fix onboarding example code loading (#2723)
* Fix clear diagnostics when not wasm (#2715)
* Add a feature flag to disable printlns in kcl-lib for the lsp (#2712)
* Disable SSAO temporarily (#2709)
* Get responses back from batch (#2687)
* Clear the AST if there was a parse error. (#2706)
* Recast bug fix  (#2703)
* Rename radius to length for chamfer; (#2702)
* Better styling for pane and KCL editor focus (#2691)
* Add a dismiss button to the command bar (#2647)
* Fix zoom issues with sketch mode (#2664)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.22.2...v0.22.3

## [v0.22.2] - 2024-06-17

#### What's Changed
* 3D patterns can now be applied to 3D patterns in KCL (#2680)
* Add shell in KCL (#2683)
* Add chamfers in KCL (turns out they're fancy fillets) (#2681)
* Ensure settings are persisted before onboarding dismissal (#2678)
* Swap out icons for bug and refresh, tweak tooltip appearance (#2641)
* Many developer experience improvments

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.22.1...v0.22.2

## [v0.22.1] - 2024-06-07

#### What's Changed
* Fix for trackpad zoom jank by Dan
* Add a right-click menus to file tree and gizmo by Frank
* Improvements to selections by Kurt
* Improvements to engine connection status by Lee
* Extrusions now create new constants by Frank
* Click gizmo axis to snap to normal view by Max
* New remove constraints button in sketch overlays by Kurt
* New tab in Settings dialog to view keyboard shortcuts by Frank
* End-to-end test improvements by the team
* Faster debug builds by Adam
* Fix to Firefox paste behavior by Frank

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.22.0...v0.22.1

## [v0.22.0] - 2024-06-04

#### What's Changed
* Many constraint fixes by Kurt
* Improve rectangle code gen by Frank
* Remove FileTree from ProjectSiderbarMenu by Frank
* Small refactor and renames by Adam
* Enable Windows Tauri e2e tests in CI by Pierre
* Axis hover tooltip fix by Kurt
* Export now has a loading spinner by Frank
* Fix and simulate engine disconnect when in sketch mode by Jess
* New engine connection logic and network status reporting by Lee

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.9...v0.22.0

## [v0.21.9] - 2024-05-24

#### What's Changed
* Symbols overlay by Kurt (#2033)
* Fixes to file tree pane by Frank (#2525)
* Other bug fixes, dependency updates, and test improvements (#2507)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.8...v0.21.9

## [v0.21.8] - 2024-05-24

#### What's Changed
* New 3D orientation gizmo (#2354)
* Update point-and-click sketch close code generation to use explicit lines (#2489)
* Home page touch-ups (#2135)
* KCL language improvements (#2494, #2491, #2493, #2474)
* Tauri desktop framework improvements (#2497, #2475)
* Development debugging improvements (#2480, #2490)
* Bump kittycad library (#2481)
* Zoom to fit on load (https://github.com/KittyCAD/modeling-app/pull/2201)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.7...v0.21.8

## [v0.21.7] - 2024-05-22

* Add basic keyboard shortcuts for sketch and modeling tools (#2419)
* First `esc` now unequips sketch tools, second exits sketch (#2419)
* Fix xz-plane (#2376)
* Add more rust file tests (#2452)
* Fix rename project directory (#2451)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.6...v0.21.7

## [v0.21.6] - 2024-05-22

#### What's Changed
* Fix project list showing projects of double clicked files (#2441)
* Fix reset settings in browser (#2434)
* Reset data channel seq every connect (closes #336) (#2431)
* Throw error on both ranges (#2428)
* Add stdlib functions for getting sketch profile start and its components (#2373)
* Fix empty tag on sketch on face (#2424)

## [v0.21.5] - 2024-05-21

#### What's Changed
* Sort keys alphabetically in the Variables/Memory panel (#2417)
* remove edit-mode prep (#2370)
* Disable home logo link in the browser app (#2371)
* Fix code editor user input in older version of Safari (#2350)
* Sketch dies on exit XY sketch (#2397)
* Double-clicking a model file (obj, stl, etc) will auto generate a file with an import statement and open it (#2400)
* Missed a file (#2399)
* Make import samples run (#2398)
* Fix function variable panel issue (#2392)
* Fix max std lib (#2391)
* Add "copy to clipboard" button to Variables pane (#2388)

## [v0.21.4] - 2024-05-17

#### What's Changed
* Default extrusion length is now `5` (#2351)
* UI bug fixes (#2372, #2375)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.3...v0.21.4

## [v0.21.3] - 2024-05-16

#### What's Changed
* Bug fixes for sketching when model contains fillets and patterns, with tests (#2359)
* Filter hidden directories from home page (#2349)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.2...v0.21.3

## [v0.21.2] - 2024-05-15

#### What's Changed
* Make edge helpers + more mock safe (#2357)
* Updating KCL examples on docs (#2355)
* Fix settings overflow by setting grid-template-rows (#2348)
* Ensure that onboarding buttons are visible, even on short viewports (#2324)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.1...v0.21.2

## [v0.21.1] - 2024-05-13

#### What's Changed
* Fix Format button by Jess
* Other minor improvements by Jess and Frank

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.21.0...v0.21.1

## [v0.21.0] - 2024-05-10

#### What's Changed
* Sketch light mode by Frank
* Clean up and fixes by Kurt
* Remove backdrop highlight in onboarding by Frank
* Move the command bar out to the right in the AppHeader by Frank

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.20.2...v0.21.0

## [v0.20.2] - 2024-05-08

#### What's Changed
* enable editor changes in sketch mode, refactor some of the code manager by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/2287
* Disable tauri e2e tests on release by @pierremtb in https://github.com/KittyCAD/modeling-app/pull/2299
* tell the save dialog the file extension by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/2303
* Exit edit mode when selection input is up, re-enter when it's not. by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/2306
* Bump thiserror from 1.0.59 to 1.0.60 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/2307
* Bump anyhow from 1.0.82 to 1.0.83 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/2309
* Bump syn from 2.0.60 to 2.0.61 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/2310
* Franknoirot/refresh button add by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/2314
* Mac TestFlight in nightly runs only by @pierremtb in https://github.com/KittyCAD/modeling-app/pull/2312
* Make "Extrude from command bar" test selection via 3D scene, not code by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/2313
* remove code-pane stuff temporarily again by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/2318
* Cut release v0.20.2 by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/2319


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.20.1...v0.20.2

## [v0.20.1] - 2024-05-03

- breaking engine api change
- clicking kcl files from the finder on all os-es should open in the desktop apps

## [v0.20.0] - 2024-05-03

#### What's Changed
* New settings search by Frank
* Updated onboarding by Josh
* Deep links and mac app store publishing by Jess
* Improvements in automated testing by multiple people!

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.19.4...v0.20.0

## [v0.19.14] - 2024-04-26

#### What's Changed
* more speed up wasm build by @Irev-Dev 
* fix for relative path by @jessfraz 
* fetch wasm bundle locally by @Irev-Dev
* get rid of code pane shit by @jessfraz 

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.19.3...v0.19.14

## [v0.19.3] - 2024-04-25

#### What's Changed
* Pass the ?pool query param through to the backend. (#2246)
* Fix the updater (#2250)
* Download-wasm if there's no rust changes (#2234)
* Filter files and folders that start with a `.` (#2249)
* Better rust parsing of route uris for files (#2248)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.19.2...v0.19.3

## [v0.19.2] - 2024-04-25

#### What's Changed
* Bugfix for settings file reading and migration by Jess
* A few small dev experience upgrades 

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.19.1...v0.19.2

## [v0.19.1] - 2024-04-25

#### What's Changed
* Fix project directory through state improvements by Jess

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.19.0...v0.19.1

## [v0.19.0] - 2024-04-25

#### What's Changed
* Zoom to fit by Serena and Jess
* Human speed completions by Jess
* Dark edge lines in light mode by Frank and Mike
* 3D axes gizmo fix by Kurt
* Rust refactor of filesystem operations by Jess
* Fixes for recast, const completion, u32 math, and 2d linear patterns by Jess
* Bump dependencies (tauri and internal)

#### Known Issues
* File Explorer shows directories as files (#2237)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.18.1...v0.19.0

## [v0.18.1] - 2024-04-23

#### What's Changed
* Project global origin for sketches and use engine animations (#2113)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.18.0...v0.18.1

## [v0.18.0] - 2024-04-22

#### What's Changed
* Massive app performance improvements by Jess
* Rectangle sketch tool by Frank and Kurt
* Code editor improvements by Jess: autocompletion snippets, find extension, and more
* New panes sidebar by Frank
* New setting to toggle edge highlights
* Migrate to Tauri V2 by Pierre, Paul and Adam
* Allow nightly builds of Modeling App to be installed alongside the standard app by Pierre, Paul and Adam
* New help menu in the bottom right by Frank
* Lots of tests by Kurt, Jess and Frank
* New custom updater (what you're reading this in!) by Pierre
* New app icon by Frank

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.17.3...v0.18.0

## [v0.17.3] - 2024-04-05

#### What's Changed
* Swap out primary UI color for Zoo brand blue, add theme color setting to control its hue (#2017)
* Bug fix for broken project directory picker (#2025)
* Make it possible to permanently dismiss the web banner from the settings (#2021)
* Print WebSocket errors when we get them (#2018)
* Benchmark rust in CI with iai, not criterion (#1937)
* Several other bug fixes, refactors, and maintenance items

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.17.2...v0.17.3

## [v0.17.2] - 2024-04-04

#### What's Changed
* Fix home redirect in browser (#2008)
* dynamic cursor depending on mouse scene state (#1995)
* Make the sketch larger so 20-20 failures are clearer (#1989)
* New segments can be added in the middle of a sketch (#1953)
* Generate docs (#1994)
* Fix member expression in object expression (#1992)
* Rearchitect settings system to be scoped (#1956)
* Set selection as top level event only (#1988)
* Pipelines cause Z-fighting (#1976)
* Allow two 'serial_test_' to run simultaneously (#1978)
* Add plumbus test (#1975)
* Onboarding updates (#1967)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.17.1...v0.17.2

## [v0.17.1] - 2024-03-29

#### What's Changed
* [Add helix function to KCL by @jessfraz](https://github.com/KittyCAD/modeling-app/pull/1892)
* [Cleaner clear all implementation by @Irev-Dev](https://github.com/KittyCAD/modeling-app/pull/1908)
* [start of revolve by @jessfraz](https://github.com/KittyCAD/modeling-app/pull/1897)
* [Generate images for examples in derive docs by @jessfraz](https://github.com/KittyCAD/modeling-app/pull/1916)
* [Filter selections by type by @Irev-Dev](https://github.com/KittyCAD/modeling-app/pull/1951)
* Various KCL language bug fixes
* Various testing improvements
* Many bumped software dependencies


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.17.0...v0.17.1

## [v0.17.0] - 2024-03-25

#### What's Changed
* Add batch support to current KCL implementation (#1871)
* Change KCL Samples link (#1869)
* Add *.zoo.dev origins to Tauri HTTP scopes (#1868)
* Make engine background color driven by `theme` setting (#1842)
* Circular dependencies refactor (#1863)
* Grackle: integrate source ranges (#1852)
* Add parsing of types to functions (#1844)
* Set token when fetching user (#1851)
* SketchOnFace UI (#1664)
* Better error lsp server (#1850)
* Grackle: Fix a clippy lint (#1848)
* Up cam throttle (#1843)
* Add regression test for angletomatch (#1806)
* Fix angleToMatchLengthXY (#1765)
* Fix dependabot perms  (#1792)
* Ignore test_copilot_lsp_completions til new model deployed (#1791)
* Add tangentialArcTo to grackle stdlib (#1731)
* Bind all unary, binary and constants to KCL (#1781)
* Add onboarding check workflow (#1764)
* Bump dependencies (multiple PRs)

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.16.0...v0.17.0

## [v0.16.0] - 2024-03-20

#### What's Changed
* Fix file route resolution to restore file switching (#1768)
* Fix cargo warnings (#1766)
* Add support for line, xLine, yLine, xLineTo, yLineTo (#1754)
* Tag changes followup (#1747)
* Updating example kcl back to bracket with updated changes (#1743)
* Fix recast bug (#1746)
* Update starting example  (#1742)
* Make tag last optional param everywhere (#1739)
* Better copilot test (#1741)
* Update cargo-test.yml (#1740)
* File based settings (#1679)
* Handle many files as a zip archive (#1688)
* Grackle: Extrude/ClosePath stdlib functions (#1717)
* Fix circle (#1715)
* Fix links for kcl docs (#1714)
* Update SketchGroup when calling lineTo (#1713)
* Fixes for docs (#1712)
* Change up docs format (#1711)
* Generate kcl examples in docs from macro (#1710)
* Add to_degrees/to_radians fns (#1709)
* Send telemetry (#1702)
* More lsp stuff / telemetry-prep (#1694)
* Patterns 2d 3d (#1701)
* Move settings types and initial values to lib/settings (#1698)
* Lsp workspace stuff (#1677)
* Rename *GlobalState* to *SettingsAuth* (#1689)
* Fix error range kcl embedded function and add test (#1691)
* Update onboarding based on team feedback (#1665)
* Cam update should move target too (#1674)
* Add optional tag to circle (#1669)
* Fix circle sketch on face (#1668)
* Start of close tag (#1639)
* Bump dependencies


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.6...v0.16.0

## [v0.15.6] - 2024-03-07

- Bump kittycad to 0.0.55

## [v0.15.5] - 2024-03-06

#### What's Changed
* one more sentry by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1591
* Refactor: move point-parsing into its own function by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1590
* Bump kittycad from 0.2.53 to 0.2.58 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1581
* Bump kittycad from 0.2.54 to 0.2.58 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1583
* Bump image from 0.24.8 to 0.24.9 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1584
* enable concurrency for playwright action by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1598
* failing auto complete test by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1578
* EngineConnection should fail fast if socket closes by @iterion in https://github.com/KittyCAD/modeling-app/pull/1600
* import docs by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1602
* Implement dual camera sync direction by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1597
* make startProfileAt UI editable by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1599
* make kcl std lib first class by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1603
* try parallel plawright by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1579
* fully remove show by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1592
* show selected color for start selected at by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1606
* add test: Can edit segments by dragging their handles by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1607
* unused vars cleanup by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1608
* Grackle: stdlib LineTo function by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1601
* Refactor client scene mouse event args by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1613
* snap to profile start by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1616
* Remove unnecessary import by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1611
* clean up old snapshot images by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1618
* remove playwright parallel, but run macos and ubuntu at the same time by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1617
* make close segment visually distinct by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1620
* undo test stuff by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1619
* Add export to cmd bar by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1593
* update discord announce under 2000 char limit by @jgomez720 in https://github.com/KittyCAD/modeling-app/pull/1628
* Increase playwright timeout on a per test basis by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1627
* Bump KCVM by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1631
* make export e2e test more robust by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1638
* Fillets by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1401
* Bump tauri from 1.5.4 to 1.6.0 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1446
* Bump kittycad from 0.2.58 to 0.2.59 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1633
* Bump tauri-plugin-fs-extra from `ed682dd` to `19aa220` in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1634
* Bump js-sys from 0.3.68 to 0.3.69 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1635
* Bump mio from 0.8.9 to 0.8.11 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1629
* Bump mio from 0.8.9 to 0.8.11 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1630
* Bump openapitor from `8db292e` to `6f38abe` in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1636
* Bump serde_json from 1.0.113 to 1.0.114 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1622
* fix error sourcce range for kcl stdlib  by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1641
* Clean up possibly dead code by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1032
* More fixes to export e2e test by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1646
* Show all CAD files in FileTree by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1642



**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.4...v0.15.5

## [v0.15.4] - 2024-02-29

#### What's Changed
* fix recast by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1571
* fix trailing comma by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1574
* Fix autocomplete in comment by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1575
* Hide cam when moving by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1577
* Bump syn from 2.0.49 to 2.0.52 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1563
* Bump tauri-plugin-fs-extra from `01211ff` to `ed682dd` in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1567
* Bump kittycad-modeling-session from `9cb86ba` to `29086e1` in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1568
* Bump kittycad-execution-plan from `9cb86ba` to `29086e1` in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1570
* Bump google-github-actions/auth from 2.1.1 to 2.1.2 by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1521
* Bump clap from 4.5.0 to 4.5.1 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1448
* Vector for tracking cargo tests by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1580
* Bump anyhow from 1.0.79 to 1.0.80 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1465
* Bump serde from 1.0.196 to 1.0.197 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1462
* Bump serde_json from 1.0.113 to 1.0.114 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1463
* client side sketch scene not respecting base-unit-scale by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1576
* Finish removing Sentry by @paultag in https://github.com/KittyCAD/modeling-app/pull/1588



**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.3...v0.15.4

## [v0.15.3] - 2024-02-29

#### What's Changed
* Move discord automation into ci.yml by @jgomez720 in https://github.com/KittyCAD/modeling-app/pull/1479
* Bump ip from 1.1.8 to 1.1.9 by @dependabot in https://github.com/KittyCAD/modeling-app/pull/1471
* Cube example didn't actually work by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1478
* bump ahash to fix the nightly builds by @paultag in https://github.com/KittyCAD/modeling-app/pull/1488
* Trim space off the return type before continuing by @paultag in https://github.com/KittyCAD/modeling-app/pull/1487
* Release derive-docs 0.1.7 by @paultag in https://github.com/KittyCAD/modeling-app/pull/1491
* Sketch on arc error by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1495
* Replace number command bar arg input type with kcl expression input by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1474
* Remove Sentry from production by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1515
* Honor mod+z and mod+shift+z even with editor not in focus by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1513
* fixing discord automation to ignore nightly runs by @jgomez720 in https://github.com/KittyCAD/modeling-app/pull/1516
* solve a couple of scene scale bugs by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1496
* Disable actions when stream disconnected by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1483
* update cli to reestablish export test by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1523
* Sketch on face of face by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1524
* improve export test logs by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1536
* short term cam fix by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1543
* add issue template by @jgomez720 in https://github.com/KittyCAD/modeling-app/pull/1547
* Grackle: implement StartSketchAt stdlib function by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/1535
* bump kittcad/lib version by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1565
* Update test artifacts for patterns with holes by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1566


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.2...v0.15.3

## [v0.15.2] - 2024-02-21

#### What's Changed
* auto complete test more robust by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1456
* Bump kcl-lib by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1455
* deselect line bug by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1457
* Add arc icon, replace settings icon by @franknoirot in https://github.com/KittyCAD/modeling-app/pull/1469
* updates for units by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1458
* improve vitest hang by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1470
* add modulo and power operators by @gserena01 in https://github.com/KittyCAD/modeling-app/pull/1341
* Bump kcl-lib by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1477
* add make release bash script by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1475



**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.1...v0.15.2

## [v0.15.1] - 2024-02-19

#### What's Changed
* try arm latest by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1439
* cancel execution on file change by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1440
* jsxify svgs by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1441
* fix flacky auto complete test by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1443
* mouse listeners should be reset outside of sketch  by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1442
* draft line snapshots by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1445
* Enable/disable "start sketch", "edit sketch" and "extrude" appropriately by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/1449
* Code mirror plugin lsp interface by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/1444


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.15.0...v0.15.1

## [v0.15.0] - 2024-02-17

- ✨ Features
  - Tangential Arcs in point-and-click and kcl
  - Try these out, they're working well in our testing!
  - Sketch on face in kcl
    - By tagging the segment that created a face in an extrude and referencing it later in your next sketch, you can place the new sketch on that face. We're so excited this works, and should be able to get it into the point-and-click interface soon.
  - Import in kcl
    - Currently only import non-kcl CAD files in your project directory like STEP at their original scale, at the origin. Lays the foundation for homogenous assemblies!
  - Linear and circular patterns in kcl
    - We are reworking implementation to allow for circular patterns to cut holes, expect more soon.
- 🍲 In-Progress Work
  - Foundations of ghost text for AI autocompletions
  - A new compiler for kcl called Grackle, which lays the foundation for batch command execution and big-time speedups
- 📉 Papercuts, Maintenance, & Bug Fixes
  - Stop backspace navigating back in history
  - Cmd + comma settings shortcut
  - Show app version in the settings
  - Link to kcl samples added to code menu
  - More robust testing so we can move faster
  - Update most dependencies

## [v0.14.0] - 2023-12-20

- Zoo rebrand (#1228, #1235)
- First consistency improvement for stdlib (#1096)
- Tauri update (#1157) 
- Updated test snapshots (#1224, #1223, #1179)
- Bug fixes for debug panel and unclickable stream (#1211, #1209)
- Less annoying web warnings (#1206)
- Removed execution-plan crate (#1207)
- Support for modeling commands in the Command Bar (#1204, #1196, #1184)
- Tauri tests on dev when the CI's BUILD_RELEASE is false (#1183)
- Execution plans should allow dynamic sized types (#1178)

## [v0.13.0] - 2023-12-05

#### What's Changed
- update e2e tests after grid update (#1171)
- expand lsp test (#1167)
- Rename mod in_memory to composite (#1169)
- Read/write composite values to KCEP memory (#1164)
- EP instructions must be serializable (#1163)
- Start execution plans (#1155)
- Sort constraint buttons (#1161)
- side quest for screenshot diffs (#1160)
- Select axis and relevant constraints (#1154)
- more e2e export fixes (#1150)
- Add tauri e2e test for auth on Linux (#1040)
- fix ply and stl exports (#1141)
- test exports (#1139)
- ensure import files always sent as bson (#1138)
- selections e2e test (#1136)
- Add Playwright tests for onboarding (#1125)
- make error not so long (#1129)
- readme (#1119)
- initial playwright setup and test (#1039)
- Cargo.lock updates (#1108)
- remove the buffer we were using for debugging, its too small for import (#1100)
- Derive Databake now that it has HashMap support (#1095)
- KCL optional parameters (#1087)
- Release KCL 0.1.36 (#1078)


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.12.0...v0.13.0

## [v0.12.0] - 2023-11-14

- Add first KCL stdlib and circle function (#1029)
- Fit resolutions to less than 2k x 2k (#1065)
- Add a console.error when ICE fails (#1067)
- Disable eslint rule `react-hooks/exhaustive-deps` (#1055)
- Macro for parsing KCL at Rust compile-time (#1049)
- Implement databake for all AST node types (#1047)
- Add top level expressions fix (#1046)
- Describe Rust version for devs (#1044)
- AST function nodes no longer have stdlib function members (#1031)
- Test with a circle function (#1030)
- Refactor the call_fn fn to be more readable (#1028)
- Fix auto-version in nightly builds (#1026)
- Fix epsilon bug (#1025)

## [v0.11.3] - 2023-11-08

#### What's Changed
* Neaten up stdlib (#1017)
* selections fix follow (#1019)



**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.11.2...v0.11.3

## [v0.11.2] - 2023-11-07

Various bug fixes and improvements:
- Fix selections (#1013)
- Unused imports (#1011)
- Clear errors on good parse (#1008)
- Test Jess's KCL error (#1004)
- Safe parse (#996)
- Don't overwrite current file on onboarding-replay (#1003)
- Compare formated asts before execute (#1002)
- Stop double execute on project open (#997)
- Start of fixing changing files and cleaning up after execute (#897)
- Remove unwraps from binary expression algorithm (#992)
- Nicer error messages for unknown tokens (#974)
- Remove view change from debug panel (#866)
- Fix typos (#972)
- Tokenizing fallibility  (#883)
- KCL literals are typed, not JSON values (#971)
- Snapshot testing for parser (#969)
- New math parser (#956)
- New benchmark for parsing binary expressions (#957)
- Nitpick Winnow code (#946)
- Fix typos and unnecessary import paths (#945)

## [v0.11.1] - 2023-10-26

Minor improvements:
- Move to kittycad::Angle
- Rust improvements
- Dependencies bumps

## [v0.11.0] - 2023-10-17

- Improvements
  - kcl parser now uses [Winnow](https://docs.rs/winnow/latest/winnow/) for 20x faster parsing
  - modeling state is now managed with [XState](https://stately.ai/docs/xstate) for more reliable architecture (and cool generated diagrams)
  - Many bugfixes around entering and exiting modes as a result of XState migration
  - Fix for culling distance
  - Allow OS + / to toggle comments in editor (thanks @rametta :heart_eyes_cat:)
  - Upgrade to Tauri v1.5
  - Error banner if WASM fails (thanks @MollyBoydTaylor :fire:)
  - Better code highlighting when selecting vertices and edges with point-and click
  - Move tool no longer breaks after editing via the code editor
- Features
  - ⦜ New sketch constraints
  - 🧀 Holes in sketches (kcl only, not point-and-click)
  - 🗂️ Multi-file support (desktop only)

## [v0.10.0] - 2023-10-06

Features 🎉: sketch on any origin plane. Improvements 🛠️: more intuitive toolbar scroll thanks to @rametta (thanks for being our first contributor ❤️), bug fixes to Settings relative URLs, add "Replay Onboarding" to home settings page.

## [v0.9.5] - 2023-10-04

Bug fixes (file export, re-execution, firefox PiP) and MIT license.

## [v0.9.4] - 2023-10-03

Bug fixes (more tests with tangentialArc) and improvements (button to request a feature).

## [v0.9.3] - 2023-10-02

Bug fixes (pipe expression start, user units) and improvements (tangentialArc/tangentialArcTo and 3-axis gizmo).

## [v0.9.2] - 2023-09-27

Bug fixes (window resize, negative args in function, closing arcs) and improvements (KCL tokenizer).

## [v0.9.1] - 2023-09-22

#### What's Changed

* make stdlib functions async by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/672
* Bump tauri-plugin-fs-extra from `5b814f5` to `76832e6` in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/657
* Add IDE dirs to .gitignore by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/676
* tests for big files by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/675
* Add a benchmark for parsing pipes-on-pipes by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/678
* app stuck on blur when engine errors by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/682
* improve getNodePathFromSourceRange and therefore the ast explorer aswell by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/683
* Start to restructure the Engine's connection to the backend by @paultag in https://github.com/KittyCAD/modeling-app/pull/674
* Tokenizer is accidentally quadratic by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/689
* Bump phonenumber from 0.3.2+8.13.9 to 0.3.3+8.13.9 in /src/wasm-lib/kcl/fuzz by @dependabot in https://github.com/KittyCAD/modeling-app/pull/686
* Bump phonenumber from 0.3.2+8.13.9 to 0.3.3+8.13.9 in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/685
* Bump phonenumber from 0.3.2+8.13.9 to 0.3.3+8.13.9 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/687
* Bump tauri-plugin-fs-extra from `76832e6` to `0190f68` in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/681
* Bump openapitor from `0d121f6` to `61a1605` in /src/wasm-lib by @dependabot in https://github.com/KittyCAD/modeling-app/pull/679
* Bump kittycad from 0.2.25 to 0.2.26 in /src-tauri by @dependabot in https://github.com/KittyCAD/modeling-app/pull/680
* stop gap for large files making editor slow by @jessfraz in https://github.com/KittyCAD/modeling-app/pull/690
* Convert the lexer to be iterative not recursive by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/691
* Cut release v0.9.1 by @Irev-Dev in https://github.com/KittyCAD/modeling-app/pull/693


**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.9.0...v0.9.1

## [v0.9.0] - 2023-09-21

#### What's Changed
* Unit test for zero-param programs by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/663
* Benchmark for KCL parser by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/664
* Use an actor to manage the Tokio engine connection by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/669
* Engine manager can be cloned by @adamchalmers in https://github.com/KittyCAD/modeling-app/pull/671
* Handle relative paths at kcl level by @mlfarrell in https://github.com/KittyCAD/modeling-app/pull/506


https://github.com/KittyCAD/modeling-app/pull/506 is the breaking change

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.8.2...v0.9.0

## [v0.8.2] - 2023-09-20

Fixes user-reported issues: ast, function inside show not executing, Win+K not triggering, dark mode dropdowns on Windows, oboarding component positioning, debug panel overflow.

## [v0.8.1] - 2023-09-19

Bug fix for LSP server restarting on navigation, Bug fix for auth in desktop dev, Bug fix for relative paths in onboarding, and other UX bug fixes

## [v0.8.0] - 2023-09-19

Bug fixes for WASM fetching and relative URLs on Windows
Bug fix for link to docs in code menu
Bug fixes for engine errors
Other UX improvements and bug fixes

## [v0.7.1] - 2023-09-15

- Bug fixes for sketch UI
- Bug fix for authentication
- Clean up geometry types
- Other bug fixes and UI improvements

**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/v0.7.0...v0.7.1

## [v0.7.0] - 2023-09-14

Changes Windows preferred bundle to .msi with EV Code Sign, updates dependencies, and fixes language and execution bugs.

## [v0.6.1] - 2023-09-13

Fixes camera controls key order, prepares for executor cache, and populates a JSON endpoint for the website.

## [v0.6.0] - 2023-09-13

- Fix auth state error
- Fix angledLine
- Fix `0-foo` and `-foo` expressions
- Fix PathError on Linux builds
- Add "Trackpad Friendly" camera control setting inspired by Blender
- Add early sketch-on-plane feature
- Add executor tests
- Add online indicator

## [v0.5.0] - 2023-09-11

- Change WebRTC metrics to be request/response from the Engine
- Add menu to code editor, put "Format code" and "Convert to variable" buttons in it
- Guard Promise resolution with a shouldTrace()
- Bump kittycad lib and KCL lib
- Remove .vscode dir
- Make camera mouse controls configurable
- Add deferred execution when code editing
- Make empty `defaultProjectName` value impossible

## [v0.4.0] - 2023-09-08

- Add macOS universal release builds
- More tests (fuzz)
- Remove noisy log
- Implement rename
- Remove rust tests in ci, already covered in build
- Fix LSP tooltip cutoff, style hover/autocomplete tooltips, add text wrapping setting
- Tweak prettierignore
- Break up ci
- Bump kitty lib
- Allow people to set format options

## [v0.3.2] - 2023-09-06

Fix re-rendering issue

## [v0.3.1] - 2023-09-05

- Add kcl syntax highlighting and autocompletion
- Change the app name to 'KittyCAD Modeling' on Windows and macOS
- Remove unused var
- Remove cmdId

## [v0.3.0] - 2023-09-04

- Disable high dpi video streaming
- Upload release artifacts to the release (on top of dl.kittycad.io)
- Messing around with arc and bezier
- Revert mute-reset behavior
- Don't fetch for user if in dev with a local engine
- Bump kitty lib
- Redo how Spans are used from the Engine
- Fix onboarding units
- Expandable toolbar
- Live system theme
- Only show the Replay Onboarding button in file settings
- Add subtle transitions to sidebars
- Tweak text constrast, blinking cursor
- Remove excessive serialisation
- Rename lossy to unreliable
- Refactor callbacks
- Start to clean up Sentry now that the app is back up again.
- Update production Sentry values
- Add in Sentry, WebRTC Statistics

## [v0.2.0] - 2023-08-30

- Wrap await in try/catch to fix sign-in in tauri builds
- Bump kittycad.rs
- Fmt and move error stuff locally
- Change name for initial publish to cargo
- Bugfix: don't show a toast when onboarding changes
- Refactor to just CommandBar and GlobalState
- Add Ctrl/Cmd+K bar
- Fix export and prepare for cli lib

## [v0.1.0] - 2023-08-28

- Add isReducedMotion util
- Docs macros
- Bump rust types
- Fix up message structure to match the new Engine messages
- Cleanup code we are no longer using 
- Port executor
- Fix typo in function name, cleanup unused args
- Remove EventTarget from EngineConnection
- Refactor engine connection to use callbacks
- Update for types only kittycad.rs
- Make the timeout for a WebRTC/WebSocket connection pair configurable
- Track the connection time in the console
- Detect when a video stream fails from the server
- Clean up after a closed EngineConnection
- Test parse errors are thrown
- Build out EngineConnection's retry and timeout logic

## [v0.0.4] - 2023-08-21

- Signed Auto-Updates and CI Reorg
- Generate ts types from rust
- Fix serialization of errors to client errors 
- Fix lint warnings 
- Remove redundant error-to-string fn 
- Start a refactor of the connection to the Engine 
- Rust style + performance tweaks 
- Allow warning banner to be dismissed 
- Fix export types 
- Better UI theme colors, onboarding dismiss, Export button in sidebar 
- Port abstractSyntaxtTree (the Parser) to Rust/WASM 🦀  
- Update README
- Add in a note about Third-Party cookies in Chrome 
- Add 'Request a feature' links 
- Home page in desktop, separate file support 

## [v0.0.3] - 2023-08-14

Changelog:
- Mute stream by default for autoplay
- Use trickle ICE
- Support mouse events and camera pan
- Add settings UI page
- Update App icon and name
- Add new auth
- Migrate from CRA to Vite
- Add unit setting
- Add onboarding
- Update CI with formatter checks and working builds
- Include various bug fixes & improvements

