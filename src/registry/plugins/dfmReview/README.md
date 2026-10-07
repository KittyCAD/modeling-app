# DFM Review plugin

DFM Review contributes a mode with the existing GD&T commands as its toolbar.
It keeps the built-in client scene and engine stream mounted.

The plugin starts disabled. Users with the `dfm_review` feature can enable or
disable it in Settings > Plugins. After enabling it, choose DFM Review in the
Mode picker. Returning to Modeling restores the modeling toolbar.

If the feature becomes unavailable, `disableWithoutFeature` deactivates the
plugin while retaining the user's preference. Disabling or removing the plugin
returns the workspace to Modeling. Re-enabling the plugin makes its mode
available without selecting it automatically.

The mode is registered through the [workspace modes contract](../../extensions/modes/README.md).
