---
title: "profileStartX"
excerpt: "Extract the provided 2-dimensional sketch group's profile's origin's 'x'"
layout: manual
---

Extract the provided 2-dimensional sketch group's profile's origin's 'x'

value.

```js
profileStartX(sketch_group: SketchGroup) -> number
```

### Examples

```js
const sketch001 = startSketchOn('XY')
  |> startProfileAt([5, 2], %)
  |> angledLine([-26.6, 50], %)
  |> angledLine([90, 50], %)
  |> angledLineToX({ angle: 30, to: profileStartX(%) }, %)
```

![Rendered example of profileStartX 0](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAADPfd1WAACerklEQVR4Ae3gAZAkSZIkSRKLqpm7R0REZmZmVlVVVVV3d3d3d/fMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMdHd3d3dXV1VVVVVmZkZGRIS7m5kKz0xmV3d1d3dPz8zMzMxMYn3Qgx7EVVddddVVV1111VVXXXXVVVddddVVV131fxKVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq/6H+uEf/uFLXdftAHzlV37lg/7gD/7gNq666qqrrrrqqn8Ngquuuuqqq6666qqrrrrqqv+BfuInfsJd1+3wTB/7sR/7jIc85CEbXHXVVVddddVV/xoEV1111VVXXXXVVVddddVV/8Ncc801D+b5+MRP/MR/4Kqrrrrqqquu+tegctVVV1111VVXXXXVVVdd9d/ommuuefBrv/ZrvxfAi7/4i7/2i73Yi702V1111VVXXXXVfxQqV1111VVXXXXVVVddddVV/0WuueaaB585c+bBL/ZiL/ZaL/7iL/7aL/ZiL/baPB/33Xffrddcc82DeS5/8Ad/8ClcddVVV1111VX/GlSuuuqqq6666qqrrrrqqqv+k1xzzTUPfu3Xfu33Anind3qnz+b5uO+++279h3/4h9++7777bv2Hf/iH3/mHf/iH3+aZfuInfsI8wKu92qt90V/91V/d8w//8A+/zVVXXXXVVVdd9aJAD3rQg7jqqquuuuqqq6666qqrrvr3uuaaax78Yi/2Yq995syZB734i7/4a7/Yi73Ya/Nc7rvvvlsBfuu3fuu7/+Ef/uF3/uEf/uG3+Rd80zd909OvueaaB/NMZ8+efcZv/uZvfteP/uiPfg5XXXXVVVddddW/hMpVV1111VVXXXXVVVddddW/0jXXXPPgM2fOPPjFXuzFXuvFX/zFX/vFXuzFXpvn47777rv1t37rt74b4B/+4R9+5x/+4R9+m3+lr//6r38fgHd6p3f6rBd7sRd77b//+7//rX/4h3/4Ha666qqrrrrqqhcFetCDHsRVV1111VVXXXXVVVddddULc8011zz4tV/7td8L4MVf/MVf+8Ve7MVem+dy33333Xr27Nlb//7v//63/+Ef/uF3/uEf/uG3+Q/0Yi/2Yq/9uZ/7ub919uzZZ3zwB3/wg7nqqquuuuqqq14UVK666qqrrrrqqquuuuqqqx7gmmuuefCZM2ce/GIv9mKv9eIv/uKv/WIv9mKvzfNx33333fpbv/Vb3w3woz/6o5/Df7J/+Id/+O1/+Id/+O0Xe7EXe+0P//AP/66v//qvfx+uuuqqq6666qp/CZWrrrrqqquuuuqqq6666v+1a6655sGv/dqv/V7XXHPNg1/ndV7nvXk+7rvvvlv/4R/+4bfvu+++W//hH/7hd/7hH/7ht/lv8CM/8iOf87mf+7mv/WIv9mKvfc011zz4vvvuu5WrrrrqqquuuuqFoXLVVVddddVVV1111VVX/b9xzTXXPPjFXuzFXvvMmTMPevEXf/HXfrEXe7HX5rncd999t549e/bWv//7v//tf/iHf/idf/iHf/ht/of4h3/4h9/++7//+99+8Rd/8dd+x3d8x8/6+q//+vfhqquuuuqqq656YdCDHvQgrrrqqquuuuqqq6666qr/e6655poHnzlz5sEv9mIv9lov/uIv/tov9mIv9to8H/fdd9+tv/Vbv/XdAP/wD//wO//wD//w2/wPdubMmQd98zd/86333XffrV//9V//Pv/wD//w21x11VVXXXXVVS8IetCDHsRVV1111VVXXXXVVVdd9b/fNddc8+DXfu3Xfi+Ad3qnd/psno/77rvv1rNnz97693//97/9D//wD7/zD//wD7/N/0If/uEf/l2v8zqv897/8A//8Nuf+Zmf+TpcddVVV1111VUvCHrQgx7EVVddddVVV1111VVXXfW/yzXXXPPgF3uxF3vtM2fOPOjFX/zFX/vFXuzFXpvnct99990K8Fu/9Vvf/Q//8A+/8w//8A+/zf8R11xzzYO/6Zu+6ekAn/mZn/k6//AP//DbXHXVVVddddVVzw960IMexFVXXXXVVVddddVVV131P9c111zz4DNnzjz4xV7sxV7rxV/8xV/7xV7sxV6b5+O+++679bd+67e+G+Af/uEffucf/uEffpv/w97xHd/xs97pnd7ps//hH/7htz/zMz/zdbjqqquuuuqqq54f9KAHPYirrrrqqquuuuqqq6666n+Oa6655sGv/dqv/V4AL/7iL/7aL/ZiL/baPJf77rvv1rNnz97693//97/9D//wD7/zD//wD7/N/zPXXHPNg7/pm77p6QCf9Vmf9Tp///d//9tcddVVV1111VXPDT3oQQ/iqquuuuqqq6666qqrrvrvcc011zz4zJkzD36xF3ux13rxF3/x136xF3ux1+b5uO+++279rd/6re8G+NEf/dHP4arLXud1Xue9P/zDP/y7zp49+4wP/uAPfjBXXXXVVVddddVzo3LVVVddddVVV1111VVX/Ze55pprHvzar/3a73XNNdc8+HVe53Xem+fjvvvuu/Uf/uEffvu+++679R/+4R9+5x/+4R9+m6uer3/4h3/47X/4h3/47Rd7sRd77dd5ndd579/6rd/6bq666qqrrrrqqgdCD3rQg7jqqquuuuqqq6666qqr/uNdc801D36xF3ux1z5z5syDXvzFX/y1X+zFXuy1eS733XffrWfPnr317//+73/7H/7hH37nH/7hH36bq/5VXud1Xue9P/zDP/y77rvvvls/5EM+5CFcddVVV1111VUPhB70oAdx1VVXXXXVVVddddVVV/37XHPNNQ8+c+bMg1/sxV7stV78xV/8tV/sxV7stXk+7rvvvlt/67d+67sB/uEf/uF3/uEf/uG3uerf7XM+53N+68Vf/MVf+0d+5Ec++0d/9Ec/h6uuuuqqq6666n7oQQ96EFddddVVV1111VVXXXXVv84111zz4Nd+7dd+L4DXeZ3Xee9rrrnmwTyX++6779azZ8/e+vd///e//Q//8A+/8w//8A+/zVX/KV7sxV7stT73cz/3t++7775bP+RDPuQhXHXVVVddddVV96Ny1VVXXXXVVVddddVVV71Q11xzzYNf7MVe7LXPnDnzoBd/8Rd/7Rd7sRd7bZ7LfffddyvAb/3Wb3332bNnn/Fbv/Vb381V/2X+4R/+4Xf+4R/+4bdf7MVe7LU//MM//Lu+/uu//n246qqrrrrqqqsAqFx11VVXXXXVVVddddVVz3LNNdc8+MyZMw9+sRd7sdd68Rd/8dd+sRd7sdfm+bjvvvtu/a3f+q3vBviHf/iH3/mHf/iH3+aq/1Zf//Vf/z7f9E3f9PQXe7EXe+1rrrnmwffdd9+tXHXVVVddddVVVK666qqrrrrqqquuuur/sWuuuebBr/3ar/1eAC/+4i/+2i/2Yi/22jyX++6779azZ8/e+vd///e//Q//8A+/8w//8A+/zVX/49x33323/tZv/dZ3v87rvM57v+M7vuNnff3Xf/37cNVVV1111VVXoQc96EFcddVVV1111VVXXXXV/wfXXHPNg8+cOfPgF3uxF3utF3/xF3/tF3uxF3ttno/77rvv1t/6rd/6boAf/dEf/Ryu+l/jmmuuefA3fdM3Pf2+++679Ru+4Rve5+///u9/m6uuuuqqq676/43KVVddddVVV1111VVX/R91zTXXPPi1X/u13+uaa6558Ou8zuu8N8/Hfffdd+s//MM//PZ999136z/8wz/8zj/8wz/8Nlf9r3Xffffd+lu/9Vvf/Tqv8zrv/Y7v+I6f/fd///evzVVXXXXVVVf9/4Ye9KAHcdVVV1111VVXXXXVVf/bXXPNNQ9+sRd7sdc+c+bMg178xV/8tV/sxV7stXku9913361nz5699e///u9/+x/+4R9+5x/+4R9+m6v+z7nmmmse/E3f9E1PB/jMz/zM1/mHf/iH3+aqq6666qqr/v9CD3rQg7jqqquuuuqqq6666qr/Ta655poHnzlz5sEv9mIv9lov/uIv/tov9mIv9to8H/fdd9+tv/Vbv/XdAP/wD//wO//wD//w21z1/8LrvM7rvPeHf/iHf9d9991364d8yIc8hKuuuuqqq676/4vKVVddddVVV1111VVX/Q93zTXXPPi1X/u13wvgdV7ndd77mmuueTDP5b777rv17Nmzt/793//9b//DP/zD7/zDP/zDb3PV/1v/8A//8Nv33Xffrddcc82DX+zFXuy1/+Ef/uG3ueqqq6666qr/n9CDHvQgrrrqqquuuuqqq6666n+Ka6655sEv9mIv9tpnzpx50Iu/+Iu/9ou92Iu9Ns/Hfffdd+tv/dZvfffZs2ef8Vu/9VvfzVVXPZfXeZ3Xee8P//AP/6777rvv1g/5kA95CFddddVVV131/xOVq6666qqrrrrqqquu+m9yzTXXPBjgtV/7td/rxV/8xV/7xV7sxV6b5+O+++679bd+67e+G+Af/uEffucf/uEffpurrvoX/P3f//1v/cM//MNvv9iLvdhrv87rvM57/9Zv/dZ3c9VVV1111VX//6AHPehBXHXVVVddddVVV1111X+Fa6655sGv/dqv/V4AL/7iL/7aL/ZiL/baPJf77rvv1rNnz97693//97/9D//wD7/zD//wD7/NVVf9G73Yi73Ya3/u537ub9133323fsiHfMhDuOqqq6666qr/f6hcddVVV1111VVXXXXVf4JrrrnmwWfOnHnwi73Yi73Wi7/4i7/2i73Yi702z8d9991362/91m99N8CP/uiPfg5XXfUf6B/+4R9++x/+4R9++8Ve7MVe+8M//MO/6+u//uvfh6uuuuqqq676/4XKVVddddVVV1111VVX/Qe45pprHvzar/3a73XNNdc8+HVe53Xem+fjvvvuu/Uf/uEffvu+++679R/+4R9+5x/+4R9+m6uu+k/2Iz/yI5/zuZ/7ua/9Yi/2Yq99zTXXPPi+++67lauuuuqqq676/4PKVVddddVVV1111VVX/Stdc801D36xF3ux1z5z5syDXvzFX/y1X+zFXuy1eS733XffrWfPnr317//+73/7H/7hH37nH/7hH36bq676b/AP//APv/0P//APv/1iL/Zir/2O7/iOn/X1X//178NVV1111VVX/f+BHvSgB3HVVVddddVVV1111VUvyDXXXPPgM2fOPPjFXuzFXuvFX/zFX/vFXuzFXpvn47777rv1t37rt74b4B/+4R9+5x/+4R9+m6uu+h/immuuefA3fdM3Pf3s2bPP+Lqv+7r3/od/+Iff5qqrrrrqqqv+f6By1VVXXXXVVVddddVVD3DNNdc8+LVf+7XfC+B1Xud13vuaa655MM/lvvvuu/Xs2bO3/v3f//1v/8M//MPv/MM//MNvc9VV/4Pdd999t/7Wb/3Wd7/O67zOe7/O67zOe/3DP/zDb3PVVVddddVV/z+gBz3oQVx11VVXXXXVVVdd9f/TNddc8+AXe7EXe+0zZ8486MVf/MVf+8Ve7MVem+fjvvvuu/W3fuu3vvvs2bPP+K3f+q3v5qqr/he65pprHvxN3/RNTwf4zM/8zNf5h3/4h9/mqquuuuqqq/7vQw960IO46qqrrrrqqquuuur/vmuuuebBAK/92q/9Xi/+4i/+2i/2Yi/22jwf9913363/8A//8Nv33Xffrf/wD//wO//wD//w21x11f8R7/iO7/hZ7/RO7/TZ//AP//Dbn/mZn/k6XHXVVVddddX/fehBD3oQV1111VVXXXXVVVf933PNNdc8+LVf+7XfC+DFX/zFX/vFXuzFXpvnct9999169uzZW//+7//+t//hH/7hd/7hH/7ht7nqqv/Dzpw586Bv/uZvvhXgMz/zM1/nH/7hH36bq6666qqrrvq/DT3oQQ/iqquuuuqqq6666qr/3a655poHnzlz5sEv9mIv9lov/uIv/tov9mIv9to8H/fdd9+tv/Vbv/XdAD/6oz/6OVx11f9Dr/M6r/PeH/7hH/5d9913360f8iEf8hCuuuqqq6666v82KlddddVVV1111VVX/a9zzTXXPPi1X/u13wvgnd7pnT6b5+O+++679R/+4R9++7777rv1H/7hH37nH/7hH36bq666in/4h3/47fvuu+/Wa6655sGv8zqv896/9Vu/9d1cddVVV1111f9d6EEPehBXXXXVVVddddVVV/3Pdc011zz4xV7sxV77zJkzD3rxF3/x136xF3ux1+a53HfffbeePXv21r//+7//7X/4h3/4nX/4h3/4ba666qoX6HVe53Xe+8M//MO/67777rv1Qz7kQx7CVVddddVVV/3fReWqq6666qqrrrrqqv8xrrnmmgefOXPmwS/2Yi/2Wi/+4i/+2i/2Yi/22jwf9913362/9Vu/9d0A//AP//A7//AP//DbXHXVVS+yf/iHf/jtf/iHf/jtF3uxF3vt13md13nv3/qt3/purrrqqquuuur/JvSgBz2Iq6666qqrrrrqqqv+e1xzzTUPfu3Xfu33Anid13md977mmmsezHO57777bj179uytf//3f//b//AP//A7//AP//DbXHXVVf9uL/ZiL/ban/u5n/tbZ8+efcYHf/AHP5irrrrqqquu+r+JylVXXXXVVVddddVV/yWuueaaB7/Yi73Ya585c+ZBL/7iL/7aL/ZiL/baPB/33Xffrb/1W7/13WfPnn3Gb/3Wb303V1111X+Kf/iHf/jtf/iHf/jtF3uxF3vtD//wD/+ur//6r38frrrqqquuuur/HipXXXXVVVddddVVV/2Hu+aaax4M8Nqv/drv9eIv/uKv/WIv9mKvzfNx33333foP//APv33ffffd+g//8A+/8w//8A+/zVVXXfVf5uu//uvf55u+6Zue/mIv9mKvfc011zz4vvvuu5Wrrrrqqquu+r+FylVXXXXVVVddddVV/27XXHPNg1/7tV/7vQBe/MVf/LVf7MVe7LV5Lvfdd9+tZ8+evfXv//7vf/sf/uEffucf/uEffpurrrrqv9V9991369///d//9ou/+Iu/9ju+4zt+1td//de/D1ddddVVV131fwt60IMexFVXXXXVVVddddVVL7prrrnmwWfOnHnwi73Yi73Wi7/4i7/2i73Yi702z8d9991362/91m99N8Bv//Zvf8999913K1ddddX/OGfOnHnQN3/zN99633333fr1X//17/MP//APv81VV1111VVX/d+BHvSgB3HVVVddddVVV1111Qt2zTXXPPi1X/u13wvgnd7pnT6b5+O+++679R/+4R9++7777rv1H/7hH37nH/7hH36bq6666n+ND//wD/+u13md13nvf/iHf/jtz/zMz3wdrrrqqquuuur/DvSgBz2Iq6666qqrrrrqqquuuOaaax78Yi/2Yq995syZB734i7/4a7/Yi73Ya/Nc7rvvvlvPnj1769///d//9j/8wz/8zj/8wz/8NlddddX/atdcc82Dv+mbvunpAJ/5mZ/5Ov/wD//w21x11VVXXXXV/w3oQQ96EFddddVVV1111VX/H11zzTUPPnPmzINf7MVe7LVe/MVf/LVf7MVe7LV5Pu67775bf+u3fuu7Af7hH/7hd/7hH/7ht7nqqqv+z3md13md9/7wD//w7/qHf/iH3/7Mz/zM1+Gqq6666qqr/m+gctVVV1111VVXXfX/xDXXXPPg137t134vgBd/8Rd/7Rd7sRd7bZ7Lfffdd+vZs2dv/fu///vf/od/+Iff+Yd/+Iff5qqrrvp/4R/+4R9++7777rv1xV7sxV77xV/8xV/77//+73+bq6666qqrrvrfDz3oQQ/iqquuuuqqq6666v+aa6655sEv9mIv9tpnzpx50Iu/+Iu/9ou92Iu9Ns/Hfffdd+tv/dZvfffZs2ef8Vu/9VvfzVVXXfX/2uu8zuu894d/+Id/19mzZ5/xwR/8wQ/mqquuuuqqq/73o3LVVVddddVVV131v9w111zzYIDXfu3Xfq8Xf/EXf+0Xe7EXe22ej/vuu+/Wf/iHf/jt++6779Z/+Id/+J1/+Id/+G2uuuqqqx7gH/7hH377H/7hH377xV7sxV77dV7ndd77t37rt76bq6666qqrrvrfDT3oQQ/iqquuuuqqq6666n+Ta6655sGv/dqv/V4AL/7iL/7aL/ZiL/baPJf77rvv1rNnz97693//97/9D//wD7/zD//wD7/NVVddddWL4HVe53Xe+8M//MO/67777rv1Qz7kQx7CVVddddVVV/3vhh70oAdx1VVXXXXVVVdd9T/VNddc8+AzZ848+MVe7MVe68Vf/MVf+8Ve7MVem+fjvvvuu/W3fuu3vhvgt3/7t7/nvvvuu5Wrrrrqqn+jz/mcz/mtF3/xF3/tH/mRH/nsH/3RH/0crrrqqquuuup/LypXXXXVVVddddVV/4Ncc801D37t137t9wJ4p3d6p8/m+bjvvvtu/Yd/+Iffvu+++279h3/4h9/5h3/4h9/mqquuuuo/0I/+6I9+9ou/+Iv/9uu8zuu892//9m9/z3333XcrV1111VVXXfW/E5Wrrrrqqquuuuqq/ybXXHPNg1/sxV7stc+cOfOgF3/xF3/tF3uxF3ttnst99913K8Bv/dZvffc//MM//M4//MM//DZXXXXVVf/J/uEf/uF3/uEf/uG3X+zFXuy13/Ed3/Gzvv7rv/59uOqqq6666qr/ndCDHvQgrrrqqquuuuqqq/6zXXPNNQ8+c+bMg1/sxV7stV78xV/8tV/sxV7stXk+7rvvvlt/67d+67sB/uEf/uF3/uEf/uG3ueqqq676b3DNNdc8+Ju+6Zueft9999369V//9e/zD//wD7/NVVddddVVV/3vQ+Wqq6666qqrrrrqP8E111zz4Nd+7dd+L4AXf/EXf+0Xe7EXe22ey3333Xfr2bNnb/37v//73/6Hf/iH3/mHf/iH3+aqq6666n+I++6779bf+q3f+u7XeZ3Xee/XeZ3Xea9/+Id/+G2uuuqqq6666n8f9KAHPYirrrrqqquuuuqqf49rrrnmwWfOnHnwi73Yi73Wi7/4i7/2i73Yi702z8d9991362/91m9999mzZ5/xW7/1W9/NVVddddX/cNdcc82Dv+mbvunpAJ/1WZ/1On//93//21x11VVXXXXV/y5Urrrqqquuuuqqq/4VrrnmmgcDvPZrv/Z7vfiLv/hrv9iLvdhr83zcd999t/7DP/zDb9933323/sM//MPv/MM//MNvc9VVV131v8x9991364/8yI989ju90zt99ju+4zt+9t///d+/NlddddVVV131vwt60IMexFVXXXXVVVddddULcs011zz4tV/7td8L4MVf/MVf+8Ve7MVem+dy33333Xr27Nlb//7v//63/+Ef/uF3/uEf/uG3ueqqq676P+Kaa6558Dd90zc9HeAzP/MzX+cf/uEffpurrrrqqquu+t8DPehBD+Kqq6666qqrrroK4JprrnnwmTNnHvxiL/Zir/XiL/7ir/1iL/Zir83zcd999936W7/1W98N8Nu//dvfc999993KVVddddX/Ya/zOq/z3h/+4R/+Xffdd9+tH/IhH/IQrrrqqquuuup/DypXXXXVVVddddX/W9dcc82DX/u1X/u9AN7pnd7ps3k+7rvvvlv/4R/+4bfvu+++W//hH/7hd/7hH/7ht7nqqquu+n/mH/7hH377vvvuu/Waa6558Ou8zuu892/91m99N1ddddVVV131vwN60IMexFVXXXXVVVdd9X/fNddc8+AXe7EXe+0zZ8486MVf/MVf+8Ve7MVem+dy33333QrwW7/1W9/9D//wD7/zD//wD7/NVVddddVVl73O67zOe3/4h3/4d9133323fsiHfMhDuOqqq6666qr/HahcddVVV1111VX/51xzzTUPPnPmzINf7MVe7LVe/MVf/LVf7MVe7LV5Pu67775bf+u3fuu7Af7hH/7hd/7hH/7ht7nqqquuuur5+vu///vf+od/+IfffrEXe7HXfp3XeZ33/q3f+q3v5qqrrrrqqqv+50MPetCDuOqqq6666qqr/ne75pprHvzar/3a7wXw4i/+4q/9Yi/2Yq/Nc7nvvvtuPXv27K1///d//9v/8A//8Dv/8A//8NtcddVVV131r/JiL/Zir/25n/u5v3Xffffd+iEf8iEP4aqrrrrqqqv+56Ny1VVXXXXVVVf9r3LNNdc8+MyZMw9+sRd7sdd68Rd/8dd+sRd7sdfm+bjvvvtu/a3f+q3vBvjRH/3Rz+Gqq6666qp/t3/4h3/47X/4h3/47Rd7sRd77Q//8A//rq//+q9/H6666qqrrrrqfzYqV1111VVXXXXV/1jX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Tq82e2dvxUkak+5qTyp/P/wGzRPPT1BIGlddddVVV1111X+af/iHf/jt++6779ZrrrnmwS/+4i/+2n//93//21x11VVXXXXVfz30oAc9iKuuuuqqq/6Hm2ljer35+49vv/hMNuIYo1dMHgVpqdAxo9OMpOnO6Qn1F1dfW393/X2MXvP8dJoxes1/sxd7sRd7bZ6Pf/iHf/htrrrqqquuuur/gNd5ndd57w//8A//rrNnzz7jgz/4gx/MVVddddVVV/3Xoxw/fpyrrrrqqqv+hxNQNff19RHsxCk2tEOnOb0WVHoakw58MW6b/q7+xvrb6x+sf5i1j3hBjAHzX+yaa6558Obm5vHNzc3jm5ubx4+OjnaPjo52b7311r8+e/bsrWfPnr317Nmzt3LVVVddddVV/0ccHR3tPuQhD3npBz/4wS999uzZZ9x6661/zVVXXXXVVVf910IPetCDuOqqq6666n82XxMPmd5g8UHTWy8+iWfS+bxDu3k3o9e6kHfGU6e/iL8dfy3uak9k8JL/Ya655poHf9M3fdPTeS733XffrR/yIR/yEK666qqrrrrq/6gXe7EXe+3P/dzP/a377rvv1g/5kA95CFddddVVV131X4vKVVddddVV/6P5TDx49Q0nn8ZziSeNf9h928GHYkwyaWJk8pokueqqq6666qqr/sf4h3/4h9/++7//+99+8Rd/8df+8A//8O/6+q//+vfhqquuuuqqq/7rEFx11VVXXfU/Wr5Y99o8H96Ja7Tv8zrwBR15j8FLkuS/QUBsE8ce7PqIR7t7yYe4PmKBNgUKKCeJ0w9zfTQvwIu92Iu9NlddddVVV131f9iP/uiPfjbAi73Yi732Nddc82Cuuuqqq6666r8O5fjx41x11VVXXfU/2GYcb689f2+ei87mrfW319/Df7OC6k0uD3pDFm/9wbn9ie/pzQ99ec9e7YLyvrvUbr+BevM75sb7vt/GNZ8wvcXrnua5bG5uHn+d13md936d13md936lV3qltz5z5syDAZ09e/ZWrrrqqquuuur/iLNnzz7jxV/8xV/7IQ95yEtvbm4e/9M//dOf4aqrrrrqqqv+a1C56qqrrrrqfzTd127V2Xarz5QH8wA6227lv1mPZo9wfew7e/P938yLd9ghThSIU5Qzozc/9HbarW/pxTu/izc/cEE98Q88f//wD//w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zP8y11xzzYNf7MVe7LVf7MVe7LWuueaaB7/Yi73Ya/MA9913361nz5699e///u9/+x/+4R9+5x/+4R9+m6uuuuqqq656Pj78wz/8u17ndV7nvX/rt37ru7/+67/+fbjqqquuuuqq/zjoQQ96EFddddVVV131r1WgztGiotpwG2A94jVARd0cFoFKw9Ma1hMezP9t11xzzYNf7MVe7LVf7MVe7LWuueaaB7/Yi73Ya/MA9913360A//AP//Dbv/Vbv/U9//AP//DbXHXVVVdddRVwzTXXPPibvumbnn727NlnfN3Xfd17/8M//MNvc9VVV1111VX/MdCDHvQgrrrqqquuuuqq/3jXXHPNg1/sxV7stV/sxV7sta655poHv9iLvdhr8wD33XffrQD/8A//8Nv/8A//8Du/9Vu/9d1cddVVV131/9aHf/iHf9frvM7rvPc//MM//PZnfuZnvg5XXXXVVVdd9R8DPehBD+Kqq6666qqrrvrPd8011zz4zJkzD36xF3ux13rxF3/x136xF3ux1+a53Hfffbf+wz/8w2//wz/8w+/81m/91ndz1VVXXXXV/xvXXHPNg7/pm77p6QCf+Zmf+Tr/8A//8NtcddVVV1111b8fetCDHsRVV1111VVXXfVf75prrnnwmTNnHvxiL/Zir/XiL/7ir/1iL/Zir81zue+++279h3/4h9/+h3/4h9/5rd/6re/mqquuuuqq/9Ne53Ve570//MM//Lvuu+++Wz/kQz7kIVx11VVXXXXVvx960IMexFVXXXXVVVdd9d/vmmuuefCZM2ce/GIv9mKv9eIv/uKv/WIv9mKvzXO57777bv2Hf/iH3/6Hf/iH37nvvvtu/Yd/+Iff5qqrrrrqqv8zzpw586DP/dzP/e1rrrnmwZ/5mZ/5Ov/wD//w21x11VVXXXXVvw960IMexFVXXXXVVVdd9T/PNddc82CAF3uxF3vt13md13mvF3uxF3ttnst999136z/8wz/89j/8wz/8zn333XfrP/zDP/w2V1111VVX/a/2Oq/zOu/94R/+4d9133333fohH/IhD+Gqq6666qqr/n3Qgx70IK666qqrrrrqqv/5rrnmmgcDvNiLvdhrv9iLvdhrvc7rvM5781zuu+++W//hH/7ht//hH/7hd+67775b/+Ef/uG3ueqqq6666n+Va6655sEf/uEf/l0v9mIv9tpf//Vf/z6/9Vu/9d1cddVVV1111b8detCDHsRVV1111VVXXfW/0zXXXPPgF3uxF3vtF3uxF3ut13md13lvnst999136z/8wz/89j/8wz/8zn333XfrP/zDP/w2V1111VVX/Y/3Yi/2Yq/9uZ/7ub9133333fohH/IhD+Gqq6666qqr/u3Qgx70IK666qqrrrrqqv8brrnmmge/2Iu92Gu/2Iu92Gu9zuu8znvzXO67775b/+Ef/uG3/+Ef/uF37rvvvlv/4R/+4be56qqrrrrqf6TP/dzP/a0Xe7EXe+3f+q3f+u6v//qvfx+uuuqqq6666t8GPehBD+Kqq6666qqrrvq/6Zprrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4L777rv1H/7hH377vvvuu/Uf/uEffucf/uEffpurrrrqqqv+R3ixF3ux1/7cz/3c3zp79uwzPvMzP/O177vvvlu56qqrrrrqqn899KAHPYirrrrqqquuuur/h2uuuebBL/ZiL/baL/ZiL/Za11xzzYNf7MVe7LV5gPvuu+/Ws2fP3vr3f//3v/0P//APv/MP//APv81VV1111VX/bT73cz/3t17sxV7stX/rt37ru7/+67/+fbjqqquuuuqqfz30oAc9iKuuuuqqq6666v+na6655sEv9mIv9tov9mIv9lrXXHPNg1/sxV7stXmA++6779azZ8/e+vd///e//Q//8A+/8w//8A+/zVVXXXXVVf9lrrnmmgd/0zd909Pvu+++W7/+67/+ff7hH/7ht7nqqquuuuqqfx30oAc9iKuuuuqqq6666iqAa6655sEv9mIv9tov9mIv9lrXXHPNg1/sxV7stXmA++6779azZ8/eet999936W7/1W9/zD//wD7/NVVddddVV/6k+/MM//Lte53Ve571/67d+67u//uu//n246qqrrrrqqn8d9KAHPYirrrrqqquuuuqq5+eaa6558Iu92Iu99ou92Iu91jXXXPPgF3uxF3ttHuC+++67FeAf/uEffvu3fuu3vucf/uEffpurrrrqqqv+Q505c+ZB3/zN33wrwGd+5me+zj/8wz/8NlddddVVV131okMPetCDuOqqq6666qqrrnpRXHPNNQ9+sRd7sdd+sRd7sde65pprHvxiL/Zir80D3HfffbcC/MM//MNv/8M//MPv/NZv/dZ3c9VVV1111b/bO77jO37WO73TO332P/zDP/z2Z37mZ74OV1111VVXXfWiQw960IO46qqrrrrqqquu+re45pprHnzmzJkHv9iLvdhrvfiLv/hrv9iLvdhr81zuu+++W//hH/7ht//hH/7hd37rt37ru7nqqquuuupf7ZprrnnwN33TNz0d4DM/8zNf5x/+4R9+m6uuuuqqq6560aAHPehBXHXVVVddddVVV/1HuOaaax585syZB7/Yi73Ya734i7/4a7/Yi73Ya/Nc7rvvvlv/4R/+4bf/4R/+4Xd+67d+67u56qqrrrrqRfI6r/M67/3hH/7h33Xffffd+iEf8iEP4aqrrrrqqqteNOhBD3oQV1111VVXXXXVVf8ZrrnmmgefOXPmwS/2Yi/2Wi/+4i/+2i/2Yi/22jyX++6779Z/+Id/+O1/+Id/+J377rvv1n/4h3/4ba666qqrrnoe11xzzYM/53M+57euueaaB3/913/9+/zWb/3Wd3PVVVddddVV/zL0oAc9iKuuuuqqq6666qr/Ctdcc82DAV7sxV7stV/ndV7nvV7sxV7stXku9913363/8A//8Nv/8A//8Dv33Xffrf/wD//w21x11VVXXXXZ67zO67z3h3/4h3/X2bNnn/HBH/zBD+aqq6666qqr/mXoQQ96EFddddVVV1111VX/Ha655poHA7zYi73Ya7/Yi73Ya73O67zOe/Nc7rvvvlv/4R/+4bf/4R/+4Xfuu+++W//hH/7ht7nqqquu+n/qmmuuefCHf/iHf9eLvdiLvfbXf/3Xv89v/dZvfTdXXXXVVVdd9cKhBz3oQVx11VVXXXXVVVf9T3HNNdc8+MVe7MVe+8Ve7MVe63Ve53Xem+dy33333foP//APv/0P//APv3Pffffd+g//8A+/zVVXXXXV/yMv9mIv9tqf+7mf+1v33XffrR/yIR/yEK666qqrrrrqhUMPetCDuOqqq6666qqrrvqf6pprrnnwi73Yi732i73Yi73W67zO67w3z+W+++679R/+4R9++x/+4R9+57777rv1H/7hH36bq6666qr/4z7ncz7nt178xV/8tX/rt37ru7/+67/+fbjqqquuuuqqFww96EEP4qqrrrrqqquuuup/i2uuuebBL/ZiL/baL/ZiL/Za11xzzYNf7MVe7LV5gLNnzz7jvvvue/rf//3f//Y//MM//M4//MM//DZXXXXVVf/HnDlz5kHf/M3ffOt9991362d91me9zn333XcrV1111VVXXfX8oQc96EFcddVVV1111VVX/W91zTXXPPjFXuzFXvvFXuzFXuuaa6558Iu92Iu9Ng9w33333Xr27Nln/P3f//1v/cM//MPv/MM//MNvc9VVV131f8Dnfu7n/taLvdiLvfZv/dZvfffXf/3Xvw9XXXXVVVdd9fyhBz3oQVx11VVXXXXVVVf9X3HmzJkHvfiLv/jrvNiLvdhrXXPNNQ9+sRd7sdfmAe67775bz549e+s//MM//M7f//3f//Y//MM//DZXXXXVVf8LXXPNNQ/+pm/6pqffd999t37913/9+/zDP/zDb3PVVVddddVVzws96EEP4qqrrrrqqquuuur/qmuuuebBL/ZiL/ZaL/ZiL/ba11xzzYNf7MVe7LV5gPvuu+/Ws2fP3nrffffd+lu/9Vvf8w//8A+/zVVXXXXV/xIf/uEf/l2v8zqv897/8A//8Nuf+Zmf+TpcddVVV1111fNCD3rQg7jqqquuuuqqq676/+Kaa6558Iu92Iu99ou92Iu91jXXXPPgF3uxF3ttHuC+++67FeAf/uEffvu3fuu3vucf/uEffpurrrrqqv+hrrnmmgd/0zd909MBPuuzPut1/v7v//63ueqqq6666qrnhB70oAdx1VVXXXXVVVdd9f/VNddc8+AzZ848+MVe7MVe68Vf/MVf+8Ve7MVem+dy33333foP//APv/0P//APv/Nbv/Vb381VV1111f8gr/M6r/PeH/7hH/5d//AP//A7n/mZn/naXHXVVVddddVzQg960IO46qqrrrrqqquuuuqKa6655sFnzpx58Iu92Iu91ou/+Iu/9ou92Iu9Ns/l7Nmzz/j7v//73/qHf/iH3/mt3/qt7+aqq6666r/RNddc8+DP+ZzP+a1rrrnmwZ/5mZ/5Ov/wD//w21x11VVXXXXVs6EHPehBXHXVVVddddVVV131/J05c+ZB11xzzUNe7MVe7LVe/MVf/LVf7MVe7LV5Lvfdd9+t//AP//A7//AP//Dbv/Vbv/XdXHXVVVf9F3ud13md9/7wD//w77rvvvtu/ZAP+ZCHcNVVV1111VXPhh70oAdx1VVXXXXVVVddddWL5pprrnnwmTNnHnTNNdc85HVe53Xe68Ve7MVem+dy33333foP//APv/0P//APv3Pffffd+g//8A+/zVVXXXXVf6JrrrnmwR/2YR/2XS/+4i/+2l//9V//Pr/1W7/13Vx11VVXXXXVFehBD3oQV1111VVXXXXVVVf921xzzTUPBnixF3ux13qd13md936xF3ux1+a53Hfffbf+wz/8w2//wz/8w+/cd999t/7DP/zDb3PVVVdd9R/sdV7ndd77wz/8w7/rvvvuu/VDPuRDHsJVV1111VVXXYEe9KAHcdVVV1111VVXXXXVf5xrrrnmwS/2Yi/22i/2Yi/2Wq/zOq/z3jyX++6779Z/+Id/+O1/+Id/+J377rvv1n/4h3/4ba666qqr/gN87ud+7m+92Iu92Gv/yI/8yGf/6I/+6Odw1VVXXXXVVYAe9KAHcdVVV1111VVXXXXVf55rrrnmwS/2Yi/22i/2Yi/2Wq/zOq/z3jyXs2fPPuPv//7vf+sf/uEffue+++679R/+4R9+m6uuuuqqf4MXe7EXe+3P/dzP/a377rvv1g/5kA95CFddddVVV10F6EEPehBXXXXVVVddddVVV/3Xueaaax78Yi/2Yq/9Yi/2Yq/1Oq/zOu/Nc7nvvvtu/Yd/+Iff+Yd/+Iffvu+++279h3/4h9/mqquuuupF9Lmf+7m/9WIv9mKv/Vu/9Vvf/fVf//Xvw1VXXXXVVf/foQc96EFcddVVV1111VVXXfXf58yZMw968Rd/8dd5sRd7sde65pprHvxiL/Zir80D3HfffbeePXv21n/4h3/4nb//+7//7X/4h3/4ba666qqrXoBrrrnmwd/0Td/09Pvuu+/Wb/iGb3ifv//7v/9trrrqqquu+v8MPehBD+Kqq6666qqrrrrqqv85rrnmmge/2Iu92Gu92Iu92Gtfc801D36xF3ux1+YB7rvvvlvPnj1769///d//9j/8wz/8zj/8wz/8NlddddVVD/DhH/7h3/U6r/M67/1bv/Vb3/31X//178NVV1111VX/n6EHPehBXHXVVVddddVVV131P9c111zz4Bd7sRd77Rd7sRd7rWuuuebBL/ZiL/baPMB9991369mzZ2/9+7//+9/+h3/4h9/5h3/4h9/mqquu+n/tmmuuefA3fdM3PR3gMz/zM1/nH/7hH36bq6666qqr/r9CD3rQg7jqqquuuuqqq6666n+Pa6655sEv9mIv9tov9mIv9lrXXHPNg1/sxV7stXmAs2fPPsO2/+Ef/uG3f+u3fut7/uEf/uG3ueqqq/7f+fAP//Dvep3XeZ33/od/+Iff/szP/MzX4aqrrrrqqv+v0IMe9CCuuuqqq6666qqrrvrf65prrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4L777rtVkv7+7//+t/7hH/7hd37rt37ru7nqqqv+z7vmmmse/E3f9E1PB/jMz/zM1/mHf/iH3+aqq6666qr/j9CDHvQgrrrqqquuuuqqq676v+PMmTMPuuaaax7yYi/2Yq/14i/+4q/9Yi/2Yq/Nc7nvvvtu/Yd/+Iff+Yd/+Iff/q3f+q3v5qqrrvo/6XVe53Xe+8M//MO/67777rv1Qz7kQx7CVVddddVV/x+hBz3oQVx11VVXXXXVVVdd9X/XNddc8+AzZ8486MVe7MVe+8Vf/MVf+8Ve7MVem+dy33333foP//APv/0P//APv/Nbv/Vb381VV131f8KZM2ce9Lmf+7m/fc011zz467/+69/nt37rt76bq6666qqr/r9BD3rQg7jqqquuuuqqq6666v+Pa6655sFnzpx58Iu92Iu91ou/+Iu/9ou92Iu9Ns/lvvvuu/Uf/uEffvsf/uEffue+++679R/+4R9+m6uuuup/pdd5ndd57w//8A//rvvuu+/WD/mQD3kIV1111VVX/X+DHvSgB3HVVVddddVVV1111f9f11xzzYMBXuzFXuy1X+d1Xue9XuzFXuy1eS733Xffrf/wD//w2//wD//wO/fdd9+t//AP//DbXHXVVf8rXHPNNQ/+8A//8O96sRd7sdf++q//+vf5rd/6re/mqquuuuqq/0/Qgx70IK666qqrrrrqqquuuup+11xzzYMBXuzFXuy1X+zFXuy1Xud1Xue9eS5nz559xt///d//1j/8wz/8zn333XfrP/zDP/w2V1111f9YL/ZiL/ban/u5n/tb9913360f8iEf8hCuuuqqq676/wQ96EEP4qqrrrrqqquuuuqqq16Ya6655sEv9mIv9tov9mIv9lqv8zqv8948l/vuu+/Wf/iHf/idf/iHf/jt++6779Z/+Id/+G2uuuqq/1E+93M/97de7MVe7LV/67d+67u//uu//n246qqrrrrq/wv0oAc9iKuuuuqqq6666qqrrvrXOHPmzINe/MVf/HVe7MVe7LVe53Ve5715Lvfdd9+t//AP//Db//AP//A79913363/8A//8NtcddVV/61e7MVe7LU/93M/97fOnj37jM/8zM987fvuu+9Wrrrqqquu+v8APehBD+Kqq6666qqrrrrqqqv+Pa655poHv9iLvdhrvdiLvdhrv9iLvdhrX3PNNQ/mAe67775b/+Ef/uG3/+Ef/uF37rvvvlv/4R/+4be56qqr/st97ud+7m+92Iu92Gv/1m/91nd//dd//ftw1VVXXXXV/wfoQQ96EFddddVVV1111VVXXfUf6Zprrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4L777rv17Nmzt/793//9b//DP/zD7/zDP/zDb3PVVVf9p7vmmmse/E3f9E1Pv++++279+q//+vf5h3/4h9/mqquuuuqq/+vQgx70IK666qqrrrrqqquuuuo/0zXXXPPgF3uxF3vtF3uxF3uta6655sEv9mIv9to8wNmzZ59x3333Pf3v//7vf/sf/uEffucf/uEffpurrrrqP8WHf/iHf9frvM7rvPc//MM//PZnfuZnvg5XXXXVVVf9X4ce9KAHcdVVV1111VVXXXXVVf+Vrrnmmge/2Iu92Gu/2Iu92Gtdc801D36xF3ux1+YB7rvvvlvPnj37jL//+7//rX/4h3/4nX/4h3/4ba666qr/EGfOnHnQN3/zN98K8Jmf+Zmv8w//8A+/zVVXXXXVVf+XoQc96EFcddVVV1111VVXXXXVf6czZ8486MVf/MVf58Ve7MVe65prrnnwi73Yi702D3DffffdCvAP//APv/Nbv/Vb3/0P//APv81VV131b/Y6r/M67/3hH/7h3/UP//APv/2Zn/mZr8NVV1111VX/l6EHPehBXHXVVVddddVVV1111f8k11xzzYNf7MVe7LVe7MVe7LWvueaaB7/Yi73Ya/MA9913360A//AP//Db//AP//A7v/Vbv/XdXHXVVS+ya6655sGf8zmf81vXXHPNgz/zMz/zdf7hH/7ht7nqqquuuur/KvSgBz2Iq6666qqrrrrqqquu+p/smmuuefCZM2ce/GIv9mKv9eIv/uKv/WIv9mKvzXO57777bv2Hf/iH3/6Hf/iH3/mt3/qt7+aqq656oV7ndV7nvT/8wz/8u+67775bP+RDPuQhXHXVVVdd9X8VetCDHsRVV1111VVXXXXVVVf9b3LNNdc8+MyZMw9+sRd7sdd68Rd/8dd+sRd7sdfmudx33323/sM//MNv/8M//MPv/NZv/dZ3c9VVVz2Ha6655sEf/uEf/l0v9mIv9tpf//Vf/z6/9Vu/9d1cddVVV131fxF60IMexFVXXXXVVVddddVVV/1vds011zz4zJkzD36xF3ux13rxF3/x136xF3ux1+a5nD179hl///d//1v/8A//8Dv33Xffrf/wD//w21x11f9zr/M6r/PeH/7hH/5dZ8+efcYHf/AHP5irrrrqqqv+L0IPetCDuOqqq6666qqrrrrqqv9Lzpw58yBJerEXe7HXfp3XeZ33erEXe7HX5rncd999t/7DP/zD7/zDP/zDb9933323/sM//MNvc9VV/w997ud+7m+92Iu92Gv/yI/8yGf/6I/+6Odw1VVXXXXV/zXoQQ96EFddddVVV1111VVXXfV/2TXXXPNg237xF3/x13mxF3ux13qd13md9+a53Hfffbf+wz/8w2//wz/8w+/cd999t/7DP/zDb3PVVf8PvNiLvdhrf+7nfu5v3Xfffbd+yId8yEO46qqrrrrq/xr0oAc9iKuuuuqqq6666qqrrvr/5pprrnnwi73Yi73Wi73Yi73267zO67w3z+W+++679R/+4R9++x/+4R9+57777rv1H/7hH36bq676P+pzPudzfuvFX/zFX/u3fuu3vvvrv/7r34errrrqqqv+L0EPetCDuOqqq6666qqrrrrqqv/vrrnmmge/2Iu92Gu/2Iu92Gu9zuu8znvzXO67775b/+Ef/uG3/+Ef/uF37rvvvlv/4R/+4be56qr/I86cOfOgb/7mb771vvvuu/WzPuuzXue+++67lauuuuqqq/6vQA960IO46qqrrrrqqquuuuqqq57TNddc8+AXe7EXe+0Xe7EXe61rrrnmwS/2Yi/22jzA2bNnn3Hfffc9/e///u9/+x/+4R9+5x/+4R9+m6uu+l/swz/8w7/rdV7ndd77t37rt77767/+69+Hq6666qqr/q9AD3rQg7jqqquuuuqqq6666qqrXrhrrrnmwS/2Yi/22i/2Yi/2Wtdcc82DX+zFXuy1eYD77rvv1rNnzz7j7//+73/rH/7hH37nH/7hH36bq676X+Saa6558Dd90zc9/b777rv167/+69/nH/7hH36bq6666qqr/i9AD3rQg7jqqquuuuqqq6666qqr/nXOnDnzoBd/8Rd/nRd7sRd7rWuuuebBL/ZiL/baPMB9991369mzZ2/9h3/4h9/5+7//+9/+h3/4h9/mqqv+h/vwD//w73qd13md9/6Hf/iH3/7Mz/zM1+Gqq6666qr/C9CDHvQgrrrqqquuuuqqq6666qp/n2uuuebBL/ZiL/ZaL/ZiL/ba11xzzYNf7MVe7LV5gPvuu+/Ws2fP3nrffffd+lu/9Vvf8w//8A+/zVVX/Q9zzTXXPPibvumbng7wWZ/1Wa/z93//97/NVVddddVV/9uhBz3oQVx11VVXXXXVVVddddVV/7GuueaaB7/Yi73Ya7/Yi73Ya11zzTUPfrEXe7HX5gHuu+++WwH+4R/+4bd/67d+63v+4R/+4be56qr/AV7ndV7nvT/8wz/8u86ePfuMD/7gD34wV1111VVX/W+HHvSgB3HVVVddddVVV1111VVX/ee65pprHvxiL/Zir33mzJkHvfiLv/hrv9iLvdhr8wBnz559hm3/wz/8w2//wz/8w+/81m/91ndz1VX/Da655poHf87nfM5vXXPNNQ/+zM/8zNf5h3/4h9/mqquuuuqq/83Qgx70IK666qqrrrrqqquuuuqq/1rXXHPNg8+cOfPgF3uxF3utF3/xF3/tF3uxF3ttnsvZs2ef8fd///e/9Q//8A+/81u/9VvfzVVX/Rd5ndd5nff+8A//8O+67777bv2QD/mQh3DVVVddddX/ZuhBD3oQV1111VVXXXXVVVddddV/rzNnzjzommuueciLvdiLvdaLv/iLv/aLvdiLvTbP5b777rv1H/7hH37nH/7hH377t37rt76bq676T3LNNdc8+MM+7MO+68Vf/MVf++u//uvf57d+67e+m6uuuuqqq/63Qg960IO46qqrrrrqqquuuuqqq/5nueaaax585syZB11zzTUPeZ3XeZ33erEXe7HX5rncd999t/7DP/zDb//DP/zD79x33323/sM//MNvc9VV/0Fe7MVe7LU+93M/97fvu+++Wz/kQz7kIVx11VVXXfW/FXrQgx7EVVddddVVV1111VVXXfU/2zXXXPNggBd7sRd7rdd5ndd57xd7sRd7bZ7Lfffdd+s//MM//PY//MM//M5999136z/8wz/8Nldd9e/wuZ/7ub/1Yi/2Yq/9W7/1W9/99V//9e/DVVddddVV/xuhBz3oQVx11VVXXXXVVVddddVV/7tcc801DwZ4sRd7sdd+sRd7sdd6ndd5nffmudx33323/sM//MNv/8M//MPv3Hfffbf+wz/8w29z1VX/Ci/2Yi/22p/7uZ/7W/fdd9+tn/VZn/U69913361cddVVV131vw160IMexFVXXXXVVVddddVVV131v98111zz4Bd7sRd77Rd7sRd7rdd5ndd5b57L2bNnn/H3f//3v/UP//APv3Pffffd+g//8A+/zVVX/Qs+93M/97de7MVe7LV/67d+67u//uu//n246qqrrrrqfxv0oAc9iKuuuuqqq6666qqrrrrq/55rrrnmwS/2Yi/22i/2Yi/2Wq/zOq/z3jyX++6779Z/+Id/+J1/+Id/+O377rvv1n/4h3/4ba666rlcc801D/6mb/qmp9933323fsM3fMP7/P3f//1vc9VVV1111f8m6EEPehBXXXXVVVddddVVV1111f99Z86cedCLv/iLv86LvdiLvdY111zz4Bd7sRd7bR7gvvvuu/Xs2bO3/sM//MPv/P3f//1v/8M//MNvc9VVwId/+Id/1+u8zuu892/91m9999d//de/D1ddddVVV/1vgh70oAdx1VVXXXXVVVddddVVV/3/c8011zz4xV7sxV7rxV7sxV77mmuuefCLvdiLvTYPcN9999169uzZW//+7//+t//hH/7hd/7hH/7ht7nq/6Vrrrnmwd/0Td/0dIDP/MzPfJ1/+Id/+G2uuuqqq6763wI96EEP4qqrrrrqqquuuuqqq6666pprrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4L777rv17Nmzt/793//9b//DP/zD7/zDP/zDb3PV/xvv+I7v+Fnv9E7v9Nn/8A//8Nuf+Zmf+TpcddVVV131vwV60IMexFVXXXXVVVddddVVV1111XO75pprHvxiL/Zir/1iL/Zir3XNNdc8+MVe7MVemwc4e/bsM+67776n33fffbf+1m/91vf8wz/8w29z1f9Z11xzzYO/6Zu+6ekAn/mZn/k6//AP//DbXHXVVVdd9b8BetCDHsRVV1111VVXXXXVVVddddW/5Jprrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4L777rtVkv7+7//+t37rt37re/7hH/7ht7nq/5TXeZ3Xee8P//AP/6777rvv1g/5kA95CFddddVVV/1vgB70oAdx1VVXXXXVVVddddVVV131r3XmzJkHXXPNNQ95sRd7sdd68Rd/8dd+sRd7sdfmudx33323/sM//MPv/MM//MNv/9Zv/dZ3c9X/amfOnHnQ537u5/72Nddc8+Cv//qvf5/f+q3f+m6uuuqqq676nw496EEP4qqrrrrqqquuuuqqq6666t/rmmuuefCZM2ce9GIv9mKv/eIv/uKv/WIv9mKvzXO57777bv2Hf/iH3/6Hf/iH3/mt3/qt7+aq/3Ve53Ve570//MM//Lvuu+++Wz/kQz7kIVx11VVXXfU/HXrQgx7EVVddddVVV1111VVXXXXVf7RrrrnmwWfOnHnwi73Yi73Wi7/4i7/2i73Yi702z+W+++679R/+4R9++x/+4R9+57d+67e+m6v+V/jcz/3c33qxF3ux1/76r//69/mt3/qt7+aqq6666qr/ydCDHvQgrrrqqquuuuqqq6666qqr/rNdc801Dz5z5syDr7nmmge/zuu8znu92Iu92GvzXO67775b/+Ef/uG3/+Ef/uF37rvvvlv/4R/+4be56n+cF3uxF3vtz/3cz/2t++6779YP+ZAPeQhXXXXVVVf9T4Ye9KAHcdVVV1111VVXXXXVVVdd9V/tmmuueTDAi73Yi73267zO67zXi73Yi702z+Xs2bPP+Pu///vf+od/+Iffue+++279h3/4h9/mqv8RPvdzP/e3XuzFXuy1f+u3fuu7v/7rv/59uOqqq6666n8q9KAHPYirrrrqqquuuuqqq6666qr/Ca655poHv9iLvdhrv9iLvdhrvc7rvM5781zuu+++W//hH/7hd/7hH/7ht++7775b/+Ef/uG3ueq/xTXXXPPgb/qmb3r62bNnn/GZn/mZr33ffffdylVXXXXVVf8ToQc96EFcddVVV1111VVXXXXVVVf9T3TmzJkHvfiLv/jrvNiLvdhrvc7rvM5781zuu+++W//hH/7ht//hH/7hd+67775b/+Ef/uG3ueq/zId/+Id/1+u8zuu892/91m9999d//de/D1ddddVVV/1PhB70oAdx1VVXXXXVVVddddVVV131v8E111zz4Bd7sRd7rRd7sRd77dd5ndd5b57Lfffdd+s//MM//PY//MM//M5999136z/8wz/8Nlf9p7nmmmse/E3f9E1Pv++++279+q//+vf5h3/4h9/mqquuuuqq/2nQgx70IK666qqrrrrqqquuuuqqq/43uuaaax78Yi/2Yq/9Yi/2Yq91zTXXPPjFXuzFXpsHuO+++249e/bsrX//93//2//wD//wO//wD//w21z1H+rDP/zDv+t1Xud13vsf/uEffvszP/MzX4errrrqqqv+p0EPetCDuOqqq6666qqrrrrqqquu+r/gmmuuefCLvdiLvfaLvdiLvdY111zz4Bd7sRd7bR7g7Nmzz7jvvvue/vd///e//Q//8A+/8w//8A+/zVX/LmfOnHnQN3/zN98K8Jmf+Zmv8w//8A+/zVVXXXXVVf+ToAc96EFcddVVV1111VVXXXXVVVf9X3TNNdc8+MVe7MVe+8Ve7MVe65prrnnwi73Yi702D3Dffffdevbs2Wf8/d///W/9wz/8w+/8wz/8w29z1b/a67zO67z3h3/4h3/XP/zDP/z2Z37mZ74OV1111VVX/U+CHvSgB3HVVVddddVVV1111VVXXfX/wZkzZx704i/+4q/zYi/2Yq91zTXXPPjFXuzFXpsHuO+++24F+Id/+Iff+a3f+q3v/od/+Iff5qp/0TXXXPPgz/mcz/mta6655sGf+Zmf+Tr/8A//8NtcddVVV131PwV60IMexFVXXXXVVVddddVVV1111f9H11xzzYNf7MVe7LVe7MVe7LWvueaaB7/Yi73Ya/MA9913360A//AP//Db//AP//A7v/Vbv/XdXPV8vc7rvM57f/iHf/h33Xfffbd+yId8yEO46qqrrrrqfwr0oAc9iKuuuuqqq6666qqrrrrqqqvgmmuuefCZM2ce/GIv9mKv9eIv/uKv/WIv9mKvzXO57777bv2Hf/iH3/6Hf/iH3/mt3/qt7+aqy6655poHf/iHf/h3vdiLvdhrf/3Xf/37/NZv/dZ3c9VVV1111f8E6EEPehBXXXXVVVddddVVV1111VVXPa9rrrnmwWfOnHnwi73Yi73Wi7/4i7/2i73Yi702z+W+++679R/+4R9++x/+4R9+57d+67e+m//HXuzFXuy1P/dzP/e3zp49+4wP/uAPfjBXXXXVVVf9T4Ae9KAHcdVVV1111VVXXXXVVVddddW/7JprrnnwmTNnHvxiL/Zir/XiL/7ir/1iL/Zir81zOXv27DP+/u///rf+4R/+4Xfuu+++W//hH/7ht/l/5HM/93N/68Ve7MVe+7d+67e+++u//uvfh6uuuuqqq/67oQc96EFcddVVV1111VVXXXXVVVdd9a935syZB0nSi73Yi73267zO67zXi73Yi702z+W+++679R/+4R9+5x/+4R9++7777rv1H/7hH36b/8Ne7MVe7LU/93M/97fuu+++Wz/rsz7rde67775bueqqq6666r8TetCDHsRVV1111VVXXXXVVVddddVV/37XXHPNg237xV/8xV/nxV7sxV7rdV7ndd6b53Lffffd+g//8A+//Q//8A+/c9999936D//wD7/N/zGf8zmf81sv/uIv/tq/9Vu/9d1f//Vf/z5cddVVV1313wk96EEP4qqrrrrqqquuuuqqq6666qr/HNdcc82DX+zFXuy1XuzFXuy1X+d1Xue9eS733Xffrf/wD//w2//wD//wO/fdd9+t//AP//Db/C935syZB33zN3/zrffdd9+tX//1X/8+//AP//DbXHXVVVdd9d8FPehBD+Kqq6666qqrrrrqqquuuuqq/xrXXHPNg1/sxV7stV/sxV7stV7ndV7nvXku9913363/8A//8Nv/8A//8Dv33Xffrf/wD//w2/wv9OEf/uHf9Tqv8zrv/Vu/9Vvf/fVf//Xvw1VXXXXVVf9d0IMe9CCuuuqqq6666qqrrrrqqquu+u9xzTXXPPjFXuzFXvvFXuzFXuuaa6558Iu92Iu9Ng9w9uzZZ/z93//9b/3DP/zD79x33323/sM//MNv87/ANddc8+Bv+qZvejrAZ37mZ77OP/zDP/w2V1111VVX/XdAD3rQg7jqqquuuuqqq6666qqrrrrqf4ZrrrnmwS/2Yi/22i/2Yi/2Wtdcc82DX+zFXuy1eYD77rvv1rNnzz7j7//+73/rH/7hH37nH/7hH36b/6He8R3f8bPe6Z3e6bP/4R/+4bc/8zM/83W46qqrrrrqvwN60IMexFVXXXXVVVddddVVV1111VX/M505c+ZBL/7iL/46L/ZiL/Za11xzzYNf7MVe7LV5gPvuu+/Ws2fP3voP//APv/P3f//3v/0P//APv83/ENdcc82Dv+mbvunpAJ/1WZ/1On//93//21x11VVXXfVfDT3oQQ/iqquuuuqqq6666qqrrrrqqv8drrnmmge/2Iu92Gu92Iu92Gtfc801D36xF3ux1+YB7rvvvlvPnj1769///d//9j/8wz/8zj/8wz/8Nv+NXud1Xue9P/zDP/y7zp49+4wP/uAPfjBXXXXVVVf9V0MPetCDuOqqq6666qqrrrrqqquuuup/p2uuuebBL/ZiL/baL/ZiL/Za11xzzYNf7MVe7LV5gPvuu+9WgH/4h3/47d/6rd/6nn/4h3/4bf4LXXPNNQ/+nM/5nN+65pprHvz1X//17/Nbv/Vb381VV1111VX/ldCDHvQgrrrqqquuuuqqq6666qqrrvq/4Zprrnnwi73Yi732i73Yi73WNddc8+AXe7EXe20e4OzZs8+w7X/4h3/47X/4h3/4nd/6rd/6bv6Tvc7rvM57f/iHf/h33Xfffbd+yId8yEO46qqrrrrqvxJ60IMexFVXXXXVVVddddVVV1111VX/N11zzTUPPnPmzINf7MVe7LVe/MVf/LVf7MVe7LV5LmfPnn3G3//93//WP/zDP/zOb/3Wb303L8A111zz4Pvuu+9W/pWuueaaB3/Yh33Yd734i7/4a3/913/9+/zWb/3Wd3PVVVddddV/FfSgBz2Iq6666qqrrrrqqquuuuqqq/5/OHPmzIOuueaah7zYi73Ya734i7/4a7/Yi73Ya/Nc7rvvvlv/4R/+4Xf+4R/+4bd/67d+67t5pm/6pm96OsBv/dZvffdv//Zvf8999913Ky+iF3uxF3utz/3cz/3t++6779YP+ZAPeQhXXXXVVVf9V0EPetCDuOqqq6666qqrrrrqqquuuur/p2uuuebBZ86cedCLvdiLvfaLv/iLv/aLvdiLvTbP5b777rv17Nmzt77Yi73Ya/NM9913361nz5699bd+67e+57d+67e+mxfB537u5/7Wi73Yi732b/3Wb33313/9178PV1111VVX/VdAD3rQg7jqqquuuuqqq6666qqrrrrqKoBrrrnmwQAv9mIv9lqv8zqv894v9mIv9tr8C+67775b/+Ef/uG3f+u3fut7/uEf/uG3eQGuueaaB3/TN33T0++7775bP+uzPut17rvvvlu56qqrrrrqPxt60IMexFVXXXXVVVddddVVV1111VVXPT/XXHPNgwG+6Zu+6em8CO67775bf/u3f/t7fuRHfuSzeT4+93M/97de7MVe7LV/67d+67u//uu//n246qqrrrrqPxvl+PHjXHXVVVddddVVV1111VVXXXXV83N4eLj7iq/4im/9iq/4im/Ni2Bzc/P4i73Yi73267zO67z3Qx7ykJc+PDy8dPbs2Vt5pn/4h3/4nTd/8zf/6M3NzePPeMYz/ua+++67lauuuuqqq/4zoQc96EFcddVVV1111VVXXXXVVVddddW/5MyZMw+65pprHnLNNdc8GODFXuzFXuuaa655MMCLvdiLvTYvwH333XfrP/zDP/zOP/zDP/z2fffdd+tbvdVbvfHLvdzLfRIP8HZv93biqquuuuqq/wzoQQ96EFddddVVV1111VVXXXXVVVdd9e91zTXXPBjgzJkzD7rmmmse8mIv9mKvdc011zz4xV7sxV6bf8HnfM7n3PC3f/u3d3PVVVddddV/NPSgBz2Iq6666qqrrrrqqquuuuqqq676z3LNNdc8+MVe7MVe68Ve7MVe+5prrnnwi73Yi702z+Uf/uEffvszP/MzX4errrrqqqv+o1G56qqrrrrqqquuuuqqq6666qr/RPfdd9+t9913362/9Vu/9T0AP/ETP2Geyz333PN7XHXVVVdd9Z+B4Kqrrrrqqquuuuqqq6666qqr/gvZTp7LN37jN34mV1111VVX/WdAD3rQg7jqqquuuuqqq6666qqrrrrqqv9qH/ZhH/adf/VXf/XVf/iHf/i3XHXVVVdd9Z8FPehBD+Kqq6666qqrrrrqqquuuuqqq6666qqrrvo/icpVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/Kv4RIxr77A3uKPoAAAAASUVORK5CYII=)

### Arguments

* `sketch_group`: `SketchGroup` - A sketch group is a collection of paths. (REQUIRED)
```js
{
	// The id of the sketch group (this will change when the engine's reference to it changes.
	id: uuid,
	// What the sketch is on (can be a plane or a face).
	on: {
	// The id of the plane.
	id: uuid,
	// Origin of the plane.
	origin: {
	x: number,
	y: number,
	z: number,
},
	type: "plane",
	// Type for a plane.
	value: "XY" | "XZ" | "YZ" | "Custom",
	// What should the plane’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the plane’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
} |
{
	// The extrude group the face is on.
	extrudeGroup: {
	// Chamfers or fillets on this extrude group.
	edgeCuts: [{
	// The engine id of the edge to fillet.
	edgeId: uuid,
	// The id of the engine command that called this fillet.
	id: uuid,
	radius: number,
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "fillet",
} |
{
	// The engine id of the edge to chamfer.
	edgeId: uuid,
	// The id of the engine command that called this chamfer.
	id: uuid,
	length: number,
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "chamfer",
}],
	// The id of the extrusion end cap
	endCapId: uuid,
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The sketch group.
	sketchGroup: {
	// The id of the sketch group (this will change when the engine's reference to it changes.
	id: uuid,
	// What the sketch is on (can be a plane or a face).
	on: SketchSurface,
	// The starting path.
	start: {
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
},
	// Tag identifiers that have been declared in this sketch group.
	tags: {
},
	// The paths in the sketch group.
	value: [{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "ToPoint",
} |
{
	// arc's direction
	ccw: string,
	// the arc's center
	center: [number, number],
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "TangentialArcTo",
} |
{
	// arc's direction
	ccw: string,
	// the arc's center
	center: [number, number],
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "TangentialArc",
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "Horizontal",
	// The x coordinate.
	x: number,
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "AngledLineTo",
	// The x coordinate.
	x: number,
	// The y coordinate.
	y: number,
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "Base",
}],
},
	// The id of the extrusion start cap
	startCapId: uuid,
	// The extrude surfaces.
	value: [{
	// The face id for the extrude plane.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The source range.
	sourceRange: [number, number],
	// The tag.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "extrudePlane",
} |
{
	// The face id for the extrude plane.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The source range.
	sourceRange: [number, number],
	// The tag.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "extrudeArc",
} |
{
	// The id for the chamfer surface.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The source range.
	sourceRange: [number, number],
	// The tag.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "chamfer",
} |
{
	// The id for the fillet surface.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The source range.
	sourceRange: [number, number],
	// The tag.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	type: "fillet",
}],
},
	// The id of the face.
	id: uuid,
	type: "face",
	// The tag of the face.
	value: string,
	// What should the face’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the face’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
},
	// The starting path.
	start: {
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
},
	// Tag identifiers that have been declared in this sketch group.
	tags: {
},
	// The paths in the sketch group.
	value: [{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "ToPoint",
} |
{
	// arc's direction
	ccw: string,
	// the arc's center
	center: [number, number],
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "TangentialArcTo",
} |
{
	// arc's direction
	ccw: string,
	// the arc's center
	center: [number, number],
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "TangentialArc",
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "Horizontal",
	// The x coordinate.
	x: number,
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "AngledLineTo",
	// The x coordinate.
	x: number,
	// The y coordinate.
	y: number,
} |
{
	// The from point.
	from: [number, number],
	// The tag of the path.
	tag: {
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
},
	// The to point.
	to: [number, number],
	type: "Base",
}],
}
```

### Returns

`number`



