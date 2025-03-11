---
title: "Project Settings"
excerpt: "Configuration options for KittyCAD modeling app projects."
layout: manual
---

# Project Settings

Configuration options for KittyCAD modeling app projects.

This document describes the available settings in the `project.toml` configuration file for the KittyCAD modeling app. This configuration file uses the [TOML](https://toml.io) format and provides configuration for the KittyCAD modeling application.

## Project Configuration Structure

```toml
[settings.app]
# Application settings

[settings.modeling]
# Modeling behavior settings

[settings.text_editor]
# Text editor behavior settings

[settings.command_bar]
# Command bar behavior settings
```

## Available Settings

### settings



#### app

The settings for the modeling app.


**Default:** None

This setting has the following nested options:

##### appearance

The settings for the appearance of the app.


**Default:** None

This setting has further nested options. See the schema for full details.
##### onboarding_status

The onboarding status of the app.


**Default:** None

##### theme_color

The hue of the primary theme color for the app.


**Default:** None

##### enable_ssao

Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.


**Default:** None

##### dismiss_web_banner

Permanently dismiss the banner warning to download the desktop app. This setting only applies to the web app. And is temporary until we have Linux support.


**Default:** None

##### stream_idle_mode

When the user is idle, and this is true, the stream will be torn down.


**Default:** None

##### allow_orbit_in_sketch_mode

When the user is idle, and this is true, the stream will be torn down.


**Default:** None

##### show_debug_panel

Whether to show the debug panel, which lets you see various states of the app to aid in development.


**Default:** None

##### named_views

Settings that affect the behavior of the command bar.


**Default:** None


#### modeling

Settings that affect the behavior while modeling.


**Default:** None

This setting has the following nested options:

##### base_unit

The default unit to use in modeling dimensions.


**Default:** None

##### highlight_edges

Highlight edges of 3D objects?


**Default:** None

##### show_debug_panel

Whether to show the debug panel, which lets you see various states of the app to aid in development. Remove this when we remove backwards compatibility with the old settings file.


**Default:** None

##### enable_ssao

Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.


**Default:** None


#### text_editor

Settings that affect the behavior of the KCL text editor.


**Default:** None

This setting has the following nested options:

##### text_wrapping

Whether to wrap text in the editor or overflow with scroll.


**Default:** None

##### blinking_cursor

Whether to make the cursor blink in the editor.


**Default:** None


#### command_bar

Settings that affect the behavior of the command bar.


**Default:** None

This setting has the following nested options:

##### include_settings

Whether to include settings in the command bar.


**Default:** None




## Example

```toml
[settings.app]
# Set the appearance of the application
[settings.app.appearance]
# Use dark mode theme
theme = "dark"
# Set the app color to blue (240.0 = blue, 0.0 = red, 120.0 = green)
color = 240.0

[settings.modeling]
# Use inches as the default measurement unit
base_unit = "in"

[settings.text_editor]
# Disable text wrapping in the editor
text_wrapping = false
```