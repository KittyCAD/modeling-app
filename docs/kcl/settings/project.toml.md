---
title: "Project Settings"
excerpt: "Configuration options for KittyCAD modeling app projects."
layout: manual
---

# Project Settings

Configuration options for KittyCAD modeling app projects.

This document describes the available settings in the `project.toml` configuration file for the KittyCAD modeling app. This configuration file uses the [TOML](https://toml.io) format and provides project-specific settings.

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

The settings section contains all project-specific configuration options.

### app

Application-specific settings for this project.

#### appearance

Controls the visual appearance of the application for this project.


**Default:** 

#### onboarding_status

The onboarding status for this project.

**Possible values:** ``, `completed`, `incomplete`, `dismissed`

**Default:** incomplete

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

#### named_views

User-defined camera positions saved as named views.


**Default:** 


### modeling

Settings that affect the behavior while modeling.

#### base_unit

The default unit to use in modeling dimensions.

**Possible values:** `cm`, `ft`, `in`, `m`, `mm`, `yd`

**Default:** mm

#### highlight_edges

Whether to highlight edges of 3D objects.


**Default:** true

#### show_debug_panel

DEPRECATED: Use app.show_debug_panel instead.


**Default:** false

#### enable_ssao

Whether Screen Space Ambient Occlusion is enabled.


**Default:** true


### text_editor

Settings that affect the behavior of the KCL text editor.

#### text_wrapping

Whether to wrap text in the editor or overflow with scroll.


**Default:** true

#### blinking_cursor

Whether to make the cursor blink in the editor.


**Default:** true


### command_bar

Settings that affect the behavior of the command bar.

#### include_settings

Whether to include settings in the command bar.


**Default:** true



## Example

```toml
[settings.app]
# Set the app color to blue
[settings.app.appearance]
color = 220.0

[settings.modeling]
# Use inches as the default measurement unit
base_unit = "in"
```