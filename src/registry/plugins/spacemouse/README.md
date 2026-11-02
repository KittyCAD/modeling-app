# SpaceMouse plugin

Prototype for [#7169](https://github.com/KittyCAD/modeling-app/issues/7169), using
the local renderer merged in [#14506](https://github.com/KittyCAD/modeling-app/pull/14506).

## Setup

1. Install and start the [3Dconnexion driver](https://3dconnexion.com/us/drivers/).
2. Enable **Use Local Renderer** in user modeling settings and restart the app.
3. Enable **SpaceMouse** in **Settings > Plugins**.
4. Open a model, right-click the viewport, and select **Connect SpaceMouse**.
   In a browser, allow local network access if prompted.
5. Click the viewport to give it focus, then move the puck. Use the driver to
   adjust navigation mode, sensitivity, and axis preferences.

Use **Disconnect SpaceMouse**, disable the plugin, or leave the modeling view to
close the session. Input is ignored while the viewport is unfocused, while
dragging with the regular mouse, and when using the streamed renderer. Sketch
rotation follows **Allow Orbit in Sketch Mode**.

## Connection and camera

This uses the same official JavaScript driver bridge as the earlier plugin.
The bridge connects to 3DxNLServer at `127.51.68.120`. A connected service does
not prove that a physical SpaceMouse is plugged in.

The driver reads and updates the shared local camera, its target, projection,
and actual model/selection bounds in millimeters. There is no second camera
and no engine camera round trip. Orthographic zoom keeps the camera's base
frustum intact; perspective vertical FOV is converted between degrees and the
SDK's radians.

Regular mouse navigation and other view changes refresh Navlib's cached camera
before SpaceMouse motion resumes. Sketch rotation uses the application's orbit
lock; free orthographic views do not advertise a construction plane.

Browser connections require the driver's certificate to be trusted. On macOS,
Electron can also accept the exact, unexpired certificate installed at
`/Applications/3Dconnexion/3DxNLServer/server.crt`, provided it matches the
driver endpoint's IP address. It does not accept arbitrary loopback certificates.

The plugin currently handles navigation only. Application command bindings,
radial-menu actions, automatic pivot hit-testing, and Linux proxy compatibility
still need separate work. Linux's third-party `spacenav-ws` bridge implements a
different subset of the protocol and is not validated here.

## Why keep the driver?

Onshape uses [3DxNLServer](https://3dconnexion.com/cl/support/faq/no-navigation-in-onshape/),
and [SketchUp Web](https://3dconnexion.com/us/applications/trimble-sketchup/)
also supports the official driver. Keeping the bridge preserves driver-managed
navigation settings and avoids requiring users to release the hardware from the
driver when switching CAD applications.

The linked [raw WebHID example](https://vielzutun.ch/wordpress/?p=8416) and
[Three.js camera example](https://vielzutun.ch/wordpress/?p=8554) remain useful
for a future driverless option. Their camera-flight behavior is different from
the driver-managed CAD navigation used here.

## Validation

Run `npm run test:unit -- src/registry/plugins/spacemouse` for camera and
connection lifecycle regressions with a fake driver. These tests do not require
Wasm, a driver installation, or physical hardware.

Before release, test a real device on Windows and macOS: simultaneous orbit,
pan, zoom and roll; alternate with regular mouse navigation; switch perspective
and orthographic projection; resize the viewport; enter/leave a sketch; switch
projects; blur/refocus the app; and disable/re-enable the plugin while connecting
or moving. Also check connection failure/retry with 3DxWare stopped.
