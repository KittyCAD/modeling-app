---
title: "User Settings"
excerpt: "User-specific configuration options for the KittyCAD modeling app."
layout: manual
---

# User Settings

User-specific configuration options for the KittyCAD modeling app.

This document describes the available settings in the `user.toml` configuration file for the KittyCAD modeling app. This configuration file uses the [TOML](https://toml.io) format and provides project-specific settings.

## User Configuration Structure

```toml
[settings.app]
# Application settings

[settings.modeling]
# Modeling behavior settings

[settings.text_editor]
# Text editor behavior settings

[settings.command_bar]
# Command bar behavior settings

[settings.project]
# Project management settings
```

## Available Settings

The settings section contains all user-specific configuration options.

### app

Application-wide settings.

#### appearance

Controls the visual appearance of the application.


**Default:** 

#### onboarding_status

The onboarding status for the user.

**Possible values:** ``, `completed`, `incomplete`, `dismissed`

**Default:** incomplete

#### project_directory

DEPRECATED: Use project.directory instead. The directory to save and load projects from.


**Default:** null

#### theme

DEPRECATED: Use appearance.theme instead. The overall theme of the app.

**Possible values:** `light`, `dark`, `system`

**Default:** null

#### theme_color

DEPRECATED: Use appearance.color instead. The hue of the primary theme color.


**Default:** null

#### enable_ssao

DEPRECATED: Use modeling.enable_ssao instead. Whether Screen Space Ambient Occlusion is enabled.


**Default:** null

#### dismiss_web_banner

Permanently dismiss the banner warning to download the desktop app.


**Default:** false

#### stream_idle_mode

When the user is idle, and this is true, the stream will be torn down.


**Default:** false

#### allow_orbit_in_sketch_mode

Whether to allow orbit camera controls in sketch mode.


**Default:** false

#### show_debug_panel

Whether to show the debug panel, which lets you see various states of the app.


**Default:** false


### modeling

Settings that affect the behavior while modeling.

#### base_unit

The default unit to use in modeling dimensions.

**Possible values:** `cm`, `ft`, `in`, `m`, `mm`, `yd`

**Default:** mm

#### camera_projection

The projection mode the camera should use while modeling.

**Possible values:** `perspective`, `orthographic`

**Default:** orthographic

#### camera_orbit

The methodology the camera should use to orbit around the model.

**Possible values:** `spherical`, `trackball`

**Default:** spherical

#### mouse_controls

The controls for how to navigate the 3D view.

**Possible values:** `zoo`, `onshape`, `trackpad_friendly`, `solidworks`, `nx`, `creo`, `autocad`

**Default:** zoo

#### highlight_edges

Whether to highlight edges of 3D objects.


**Default:** true

#### show_debug_panel

DEPRECATED: Use app.show_debug_panel instead.


**Default:** false

#### enable_ssao

Whether Screen Space Ambient Occlusion is enabled.


**Default:** true

#### show_scale_grid

Whether to show a scale grid in the 3D modeling view.


**Default:** false


### text_editor

Settings that affect the behavior of the KCL text editor.

#### text_wrapping

Whether to wrap text in the editor or overflow with scroll.


**Default:** true

#### blinking_cursor

Whether to make the cursor blink in the editor.


**Default:** true


### project

Settings that affect the behavior of project management.

#### directory

The directory to save and load projects from.


**Default:** 

#### default_project_name

The default project name template to use when creating new projects. Use $nnn as a placeholder for incremental numbers.


**Default:** project-$nnn


### command_bar

Settings that affect the behavior of the command bar.

#### include_settings

Whether to include settings in the command bar.


**Default:** true



## Example

```toml
[settings.app]
# Set the theme to dark mode
[settings.app.appearance]
theme = "dark"

[settings.modeling]
# Use inches as the default measurement unit
base_unit = "in"
```