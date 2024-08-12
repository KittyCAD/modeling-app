---
title: "chamfer"
excerpt: "Cut a straight transitional edge along a tagged path."
layout: manual
---

Cut a straight transitional edge along a tagged path.

Chamfer is similar in function and use to a fillet, except a fillet will blend the transition along an edge, rather than cut a sharp, straight transitional edge.

```js
chamfer(data: ChamferData, extrude_group: ExtrudeGroup, tag?: TagDeclarator) -> ExtrudeGroup
```

### Examples

```js
const width = 20
const length = 10
const thickness = 1
const chamferLength = 2

const mountingPlateSketch = startSketchOn("XY")
  |> startProfileAt([-width / 2, -length / 2], %)
  |> lineTo([width / 2, -length / 2], %, $edge1)
  |> lineTo([width / 2, length / 2], %, $edge2)
  |> lineTo([-width / 2, length / 2], %, $edge3)
  |> close(%, $edge4)

const mountingPlate = extrude(thickness, mountingPlateSketch)
  |> chamfer({
       length: chamferLength,
       tags: [
         getNextAdjacentEdge(edge1),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge4)
       ]
     }, %)
```

![Rendered example of chamfer 0](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAADPfd1WAAGJLElEQVR4Ae3gAZAkSZIkSRKLqpm7R0REZmZmVlVVVVV3d3d3d/fMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMdHd3d3dXV1VVVVVmZkZGRIS7m5kKz0xmV3d1d3dPz8zMzMxMYn3Qgx7EVVddddVVV1111VVXXXXVVVddddVVV131fxKVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoqV1111VVXXXXVVVddddVVV1111VVXXXXV/1VUrrrqqquuuuqqq6666qqrrrrqqquuuuqq/6uoXHXVVVddddVVV1111VVXXXXVVVddddVV/1dRueqqq6666qqrrrrqqquuuuqqq6666qqr/q+ictVVV1111VVXXXXVVVddddVVV1111VVX/V9F5aqrrrrqqquuuuqqq6666qqrrrrqqquu+r+KylVXXXXVVVddddVVV1111VVXXXXVVVdd9X8Vlauuuuqqq6666qqrrrrqqquuuuqqq6666v8qKlddddVVV1111VVXXXXVVVddddVVV1111f9VVK666qqrrrrqqquuuuqqq6666qqrrrrqqv+rqFx11VVXXXXVVVddddVVV1111VVXXXXVVf9XUbnqqquuuuqqq6666qqrrrrqqquuuuqqq/6vonLVVVddddVVV1111VVXXXXVVVddddVVV/1fReWqq6666qqrrrrqqquuuuqqq6666qqrrvq/ispVV1111VVXXXXVVVddddVVV1111VVXXfV/FZWrrrrqqquuuuqqq6666qqrrrrqqquuuur/KipXXXXVVVddddVVV1111VVXXXXVVVddddX/VVSuuuqqq6666qqrrrrqqquuuuqqq6666qr/q6hcddVVV1111VVXXXXVVVddddVVV1111VX/V1G56qqrrrrqqquuuuqqq6666qqrrrrqqqv+r6Jy1VVXXXXVVVddddVVV1111VVXXXXVVVf9X0Xlqquuuuqqq6666qqrrrrqqquuuuqqq676v4rKVVddddVVV1111VVXXXXVVVddddVVV131fxWVq6666qqrrrrqqquuuuqqq6666qqrrrrq/yoq/w9dc801D37t137t97rmmmsezFVXXXXVVVddddX/I8txxaKbc9VVV1111VX/gwgwz0mAeU4CzHMSYJ6TAPOcBJjnJMA8JwHmOQkwz0mAeU4CzHMSYJ6TAPOc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c7jqqudyzTXXPPjDP/zDv+uaa655yG/+5m9+14/+6I9+Dldd9UzXXHPNg8+cOfOg13md13nvF3uxF3vtf/iHf/jtf/iHf/id3/qt3/purvrPgh70oAdx1X+sa6655sGv/dqv/V7v9E7v9Nn33Xffrb/1W7/13T/6oz/6OVx11QNcc801D37t137t93qnd3qnz/6Hf/iH3/76r//697nvvvtu5aqrnss111zz4M/5nM/5rX/4h3/47a//+q9/H6666gX43M/93N/6+7//+9/+0R/90c/hqqtegJd93Vf4LIC//M0/+xyuuuoFeMd3fMfPevEXf/HX/szP/MzX4aqrno9rrrnmwa/92q/9Xq/zOq/z3p/1WZ/1Ovfdd9+tXHXVczlz5syD3umd3umzX+zFXuy1f+u3fuu7f/RHf/RzuOqqB7jmmmse/GIv9mKv/Tqv8zrvdc011zzk7//+73/rt37rt77nH/7hH36bq/4joQc96EFc9e93zTXXPPi1X/u13+ud3umdPvu+++679bd+67e++0d/9Ec/h6uuei7XXHPNg1/7tV/7vd7pnd7ps3/kR37ks3/7t3/7e+67775bueqq5+Md3/EdP+t1Xud13vvrv/7r3+cf/uEffpurrnoBXud1Xue9X+d1Xue9PvMzP/N1uOqqF+JlX/cVPgvgL3/zzz6Hq656Aa655poHf/iHf/h3/f3f//1v/+iP/ujncNVVL8A7vuM7ftbrvM7rvPdv/dZvffeP/uiPfg5XXfV8XHPNNQ9+x3d8x896sRd7sdf+7d/+7e/5kR/5kc/mqquey5kzZx704i/+4q/zOq/zOu915syZB//Wb/3Wd//DP/zD7/zDP/zDb3PVvxd60IMexFX/Ntdcc82DX/u1X/u9Xud1Xue9AX7rt37ru3/7t3/7e+67775bueqq53LNNdc8+LVf+7Xf653e6Z0++0d+5Ec++7d/+7e/57777ruVq656Pq655poHf/iHf/h3nTlz5sGf9Vmf9Tr33XffrVx11QtwzTXXPPibvumbnv6Zn/mZr/MP//APv81VV70QL/u6r/BZAH/5m3/2OVx11QtxzTXXPPhzPudzfuuzPuuzXue+++67lauuegGuueaaB3/4h3/4dwF8/dd//fvcd999t3LVVc/HNddc8+DXfu3Xfq/XeZ3Xee/f+q3f+u7f/u3f/p77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8Vmf9VmvA/BN3/RNT7/mmmsezFVXXfXcKMePH+eqq656ttd5ndd578/93M/9rd/6rd/67q//+q9/H6666qr/VC/2Yi/22i/+4i/+2l//9V//Plx11VX/6a5/yI2vDXD30+/6Ha666qr/VGfPnn3G67zO67w3oFtvvfWvueqqq/5THB4e7v7DP/zD72xubh5/n/d5n6/e2to68Q//8A+/zVVXXXU/yvHjx7nqqqvgmmuuefAnfdIn/dQrvuIrvvXHf/zHv8yf/umf/gxXXXXVf6prrrnmwV/xFV/xV1//9V//PmfPnr2Vq6666j/d9Q+58bUB7n76Xb/DVVdd9Z/q8PBw9x/+4R9+58M//MO/68/+7M9+5vDwcJerrrrqP80//MM//M6f/dmf/cz7vM/7fNUrvdIrvfU//MM//M7h4eEuV111FXqFV3iFB3PVVf/PnTlz5sGf+7mf+1u/9Vu/9d0/+qM/+jlcddVV/yU+/MM//Lvuu+++W3/0R3/0c7jqqqv+SzziZR71Xtsndh78l7/5Z5/DVVdd9V/itV/7td/rxV/8xV/n67/+69+bq6666j/dmTNnHvQ6r/M67/1iL/Zir/31X//173P27Nlbueqq/9/QL/7iLz6dq676f+yaa6558H333XcrV1111X+pa6655sH33XffrVx11VX/pepW9+Bn3HnbrTceu56rrrrqv84111zzYID77rvvVq666qr/Mtdcc82DAe67775bueqq/7/Qgx70IK666v+ja6655sEf/uEf/l0An/mZn/k6XHXVVf9lrrnmmgd/0zd909M/5EM+5CH33XffrVx11VX/ZV72dV/hswD+8jf/7HO46qqr/sucOXPmQZ/7uZ/721//9V//Pv/wD//w21x11VX/Ja655poHv/Zrv/Z7ve7rvu77fOZnfuZr33fffbdy1VX//1COHz/OVVf9f/M6r/M67/25n/u5v/Vbv/Vb3/31X//178NVV131X+qTPumTfurrv/7r3+fWW2/9a6666qr/Utc/5MbXBrj76Xf9DlddddV/maOjo0tHR0eX3ud93uerfuEXfuFruOqqq/5LHB4e7v7DP/zD72xsbBx7n/d5n6/e3Nw8/g//8A+/w1VX/f9COX78OFdd9f/FNddc8+BP+qRP+qlXfMVXfOsv+ZIveZvf/u3f/h6uuuqq/1Lv+I7v+FnX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V1111f8MBFddddVV/wO84zu+42cB/NZv/dZ3c9VVV1111VVXXXXVVf+L/dZv/dZ333vvvU9/x3d8x8/iqquuuuq/H8FVV1111X+zF3uxF3vtd3qnd/rsr//6r38frrrqqquuuuqqq6666v+Ar//6r3/vF3/xF3/tF3uxF3ttrrrqqqv+exFcddVVV/03e6d3eqfP+szP/MzXue+++27lqquuuuqqq6666qqr/g84e/bsM37rt37rez78wz/8u7jqqquu+u9FcNVVV1313+jDP/zDvwvgH/7hH36bq6666qqrrrrqqquu+j/kt37rt777H/7hH377wz/8w7+Lq6666qr/PgRXXXXVVf9NXuzFXuy1X+zFXuy1P/MzP/N1uOqqq6666qqrrrrqqv+DfvRHf/RzXuzFXuy1X+zFXuy1ueqqq67670Fw1VVXXfXf5MM//MO/6+u//uvfh6uuuuqqq6666qqrrvo/6r777rv167/+69/nwz/8w7/rmmuueTBXXXXVVf/1CK666qqr/ht87ud+7m/91m/91nf/wz/8w29z1VVXXXXVVVddddVV/4f9wz/8w2//1m/91ne/4zu+42dx1VVXXfVfj+Cqq6666r/Yi73Yi732mTNnHvyjP/qjn8NVV1111VVXXXXVVVf9P/Dbv/3b33PmzJkHv87rvM57c9VVV131X4vgqquuuuq/0DXXXPPgz/3cz/2tr//6r38frrrqqquuuuqqq6666v+J++6779av//qvf+93fMd3/KxrrrnmwVx11VVX/dchuOqqq676L/ThH/7h3/UjP/Ijn/0P//APv81VV1111VVXXXXVVVf9P3L27Nln/OiP/ujnfPiHf/h3cdVVV131X4fgqquuuuq/yDu+4zt+FsCP/uiPfg5XXXXVVVddddVVV131/9A//MM//DbAO77jO34WV1111VX/NQiuuuqqq/4LXHPNNQ9+p3d6p8/++q//+vfhqquuuuqqq6666qqr/p+67777bv36r//693md13md936xF3ux1+aqq6666j8fwVVXXXXVf4EP//AP/67P/MzPfJ377rvvVq666qqrrrrqqquuuur/sfvuu+/WH/3RH/2cD//wD/8urrrqqqv+8xFcddVVV/0ne8d3fMfPAviHf/iH3+aqq6666qqrrrrqqquu4rd+67e++x/+4R9++8M//MO/i6uuuuqq/1wEV1111VX/iV7sxV7std/pnd7psz/zMz/zdbjqqquuuuqqq6666qqrnuVHf/RHP+eaa655yIu92Iu9NlddddVV/3kIrrrqqqv+E334h3/4d33mZ37m63DVVVddddVVV1111VVXPYf77rvv1h/5kR/5rA//8A//Lq666qqr/vMQXHXVVVf9J/ncz/3c3/qHf/iH3/6Hf/iH3+aqq6666qqrrrrqqquueh7/8A//8Du/9Vu/9d0f/uEf/l1cddVVV/3nILjqqquu+k/wYi/2Yq995syZB3/913/9+3DVVVddddVVV1111VVXvUC//du//T0v9mIv9tqv8zqv895cddVVV/3HI7jqqquu+k/wuZ/7ub/19V//9e/DVVddddVVV1111VVXXfVC3Xfffbd+1md91uu84zu+42ddc801D+aqq6666j8WwVVXXXXVf7DP/dzP/a0f+ZEf+ex/+Id/+G2uuuqqq6666qqrrrrqqn/Rfffdd+tv/dZvffeHf/iHfxdXXXXVVf+xCK666qqr/gO9zuu8znsD/OiP/ujncNVVV1111VVXXXXVVVe9yH77t3/7ewDe6Z3e6bO56qqrrvqPQ3DVVVdd9R/kmmuuefCHf/iHf9eP/MiPfA5XXXXVVVddddVVV1111b/Kfffdd+vXf/3Xv8/rvM7rvPc111zzYK666qqr/mMQXHXVVVf9B/nwD//w7/qRH/mRz/6Hf/iH3+aqq6666qqrrrrqqquu+le77777bv2RH/mRz/6cz/mc3+Kqq6666j8GwVVXXXXVf4B3fMd3/CyAH/3RH/0crrrqqquuuuqqq6666qp/s9/6rd/67rNnz976ju/4jp/FVVddddW/H8FVV1111b/Ti73Yi732O73TO33213/9178PV1111VVXXXXVVVddddW/29d//de/z+u8zuu894u92Iu9NlddddVV/z4EV1111VX/Tu/0Tu/0WZ/5mZ/5Ovfdd9+tXHXVVVddddVVV1111VX/bvfdd9+tP/qjP/o5H/7hH/5dXHXVVVf9+xBcddVVV/07vOM7vuNnAfzDP/zDb3PVVVddddVVV1111VVX/Yf5rd/6re/+h3/4h9/+8A//8O/iqquuuurfjuCqq6666t/oxV7sxV77dV7ndd77Mz/zM1+Hq6666qqrrrrqqquuuuo/3I/+6I9+zou92Iu99ou/+Iu/NlddddVV/zYEV1111VX/Rh/+4R/+XV//9V//Plx11VVXXXXVVVddddVV/ynuu+++W7/+67/+fT78wz/8u7nqqquu+rchuOqqq676N/jcz/3c3/qHf/iH3/6Hf/iH3+aqq6666qqrrrrqqquu+k/zD//wD7/9m7/5m9/14R/+4d/FVVddddW/HsFVV1111b/Si73Yi732mTNnHvz1X//178NVV1111VVXXXXVVVdd9Z/ut37rt777mmuuefDrvM7rvDdXXXXVVf86BFddddVV/wrXXHPNgz/3cz/3t77+67/+fbjqqquuuuqqq6666qqr/kucPXv2GV//9V//Pu/4ju/4Wddcc82Dueqqq6560RFcddVVV/0rfPiHf/h3/ciP/Mhn/8M//MNvc9VVV1111VVXXXXVVVf9l7nvvvtu/a3f+q3v/vAP//Dv4qqrrrrqRUdw1VVXXfUiep3XeZ33BvjRH/3Rz+Gqq6666qqrrrrqqquu+i/327/9298D8I7v+I6fxVVXXXXVi4bgqquuuupFcM011zz4wz/8w7/rR37kRz6Hq6666qqrrrrqqquuuuq/xX333Xfr13/917/P67zO67z3i7/4i782V1111VX/MoKrrrrqqhfBh3/4h3/X13/917/PP/zDP/w2V1111VVXXXXVVVddddV/m/vuu+/WH/3RH/2cD//wD/9urrrqqqv+ZQRXXXXVVf+Cd3zHd/wsgN/6rd/6bq666qqrrrrqqquuuuqq/3a/9Vu/9d333nvv09/xHd/xs7jqqquueuEIrrrqqqteiBd7sRd77Xd6p3f67M/8zM98Ha666qqrrrrqqquuuuqq/zG+/uu//r1f/MVf/LVf7MVe7LW56qqrrnrBCK666qqrXoh3eqd3+qzP/MzPfB2uuuqqq6666qqrrrrqqv9Rzp49+4zf+q3f+p4P//AP/y6uuuqqq14wgquuuuqqF+DDP/zDv+u+++679R/+4R9+m6uuuuqqq6666qqrrrrqf5zf+q3f+u5/+Id/+O0P//AP/y6uuuqqq54/gquuuuqq5+PFXuzFXvvFXuzFXvvrv/7r34errrrqqquuuuqqq6666n+sH/3RH/2cF3uxF3vtF3uxF3ttrrrqqqueF8FVV1111fPx4R/+4d/19V//9e/DVVddddVVV1111VVXXfU/2n333Xfr13/917/Ph3/4h3/XNddc82Cuuuqqq54TwVVXXXXVc/ncz/3c3/qt3/qt7/6Hf/iH3+aqq6666qqrrrrqqquu+h/vH/7hH377t37rt777Hd/xHT+Lq6666qrnRHDVVVdd9QCv8zqv894AP/qjP/o5XHXVVVddddVVV1111VX/a/z2b//295w5c+bBr/M6r/PeXHXVVVc9G8FVV1111TNdc801D/7wD//w7/qRH/mRz+Gqq6666qqrrrrqqquu+l/lvvvuu/Xrv/7r3/sd3/EdP+uaa655MFddddVVVxBcddVVVz3Th3/4h3/Xj/zIj3z2P/zDP/w2V1111VVXXXXVVVddddX/OmfPnn3Gj/7oj37Oh3/4h38XV1111VVXEFx11VVXAe/4ju/4WQA/+qM/+jlcddVVV1111VVXXXXVVf9r/cM//MNvA7zjO77jZ3HVVVddBQRXXXXV/3sv9mIv9trv9E7v9Nlf//Vf/z5cddVVV1111VVXXXXVVf+r3Xfffbd+/dd//fu8zuu8znu/2Iu92Gtz1VVX/X9HcNVVV/2/907v9E6f9Zmf+Zmvc999993KVVddddVVV1111VVXXfW/3n333Xfrj/7oj37Oh3/4h38XV1111f93BFddddX/a+/4ju/4WQD/8A//8NtcddVVV1111VVXXXXVVf9n/NZv/dZ3/8M//MNvf/iHf/h3cdVVV/1/RnDVVVf9v/ViL/Zir/06r/M67/2Zn/mZr8NVV1111VVXXXXVVVdd9X/Oj/7oj37ONddc85AXe7EXe22uuuqq/68Irrrqqv+3PvzDP/y7vv7rv/59uOqqq6666qqrrrrqqqv+T7rvvvtu/ZEf+ZHP+vAP//Dv4qqrrvr/iuCqq676f+lzP/dzf+sf/uEffvsf/uEffpurrrrqqquuuuqqq6666v+sf/iHf/id3/qt3/ruD//wD/8urrrqqv+PCK666qr/d17sxV7stc+cOfPgr//6r38frrrqqquuuuqqq6666qr/8377t3/7e17sxV7stV/ndV7nvbnqqqv+vyG46qqr/l+55pprHvy5n/u5v/X1X//178NVV1111VVXXXXVVVdd9f/Cfffdd+tnfdZnvc47vuM7ftY111zzYK666qr/Twiuuuqq/1c+/MM//Lt+5Ed+5LP/4R/+4be56qqrrrrqqquuuuqqq/7fuO+++279rd/6re/+8A//8O/iqquu+v+E4Kqrrvp/43Ve53XeG+BHf/RHP4errrrqqquuuuqqq6666v+d3/7t3/4egHd6p3f6bK666qr/Lwiuuuqq/xeuueaaB3/4h3/4d/3Ij/zI53DVVVddddVVV1111VVX/b9033333fr1X//17/M6r/M6733NNdc8mKuuuur/A4Krrrrq/4UP//AP/66v//qvf59/+Id/+G2uuuqqq6666qqrrrrqqv+37rvvvlt/5Ed+5LM/53M+57e46qqr/j8guOqqq/7Pe8d3fMfPAvit3/qt7+aqq6666qqrrrrqqquu+n/vt37rt7777Nmzt77jO77jZ3HVVVf9X0dw1VVX/Z/2Yi/2Yq/9Tu/0Tp/99V//9e/DVVddddVVV1111VVXXXXVM33913/9+7zO67zOe7/Yi73Ya3PVVVf9X0Zw1VVX/Z/2Tu/0Tp/1mZ/5ma9z33333cpVV1111VVXXXXVVVddddUz3Xfffbf+6I/+6Od8+Id/+Hdx1VVX/V9GcNVVV/2f9Y7v+I6fBfAP//APv81VV1111VVXXXXVVVddddVz+a3f+q3v/od/+Iff/vAP//Dv4qqrrvq/iuCqq676P+nFXuzFXvt1Xud13vszP/MzX4errrrqqquuuuqqq6666qoX4Ed/9Ec/58Ve7MVe+8Vf/MVfm6uuuur/IoKrrrrq/6QP//AP/66v//qvfx+uuuqqq6666qqrrrrqqqteiPvuu+/Wr//6r3+fD//wD/9urrrqqv+LCK666qr/cz73cz/3t37rt37ru//hH/7ht7nqqquuuuqqq6666qqrrvoX/MM//MNv/+Zv/uZ3ffiHf/h3cdVVV/1fQ3DVVVf9n/JiL/Zir33mzJkH/+iP/ujncNVVV1111VVXXXXVVVdd9SL6rd/6re++5pprHvw6r/M6781VV131fwnBVVdd9X/GNddc8+DP/dzP/a2v//qvfx+uuuqqq6666qqrrrrqqqv+Fc6ePfuMr//6r3+fd3zHd/ysa6655sFcddVV/1cQXHXVVf9nfPiHf/h3/ciP/Mhn/8M//MNvc9VVV1111VVXXXXVVVdd9a9033333fpbv/Vb3/3hH/7h38VVV131fwXBVVdd9X/C67zO67w3wI/+6I9+DlddddVVV1111VVXXXXVVf9Gv/3bv/09AO/4ju/4WVx11VX/FxBcddVV/+tdc801D/7wD//w7/r6r//69+Gqq6666qqrrrrqqquuuurf4b777rv167/+69/ndV7ndd77xV/8xV+bq6666n87gquuuup/vQ//8A//rs/8zM98nfvuu+9Wrrrqqquuuuqqq6666qqr/p3uu+++W3/0R3/0cz78wz/8u7nqqqv+tyO46qqr/ld7x3d8x88C+Id/+Iff5qqrrrrqqquuuuqqq6666j/Ib/3Wb333vffe+/R3fMd3/Cyuuuqq/80Irrrqqv+1XuzFXuy13+md3umzP/MzP/N1uOqqq6666qqrrrrqqquu+g/29V//9e/94i/+4q/9Yi/2Yq/NVVdd9b8VwVVXXfW/1ju90zt91md+5me+DlddddVVV1111VVXXXXVVf8Jzp49+4zf+q3f+p4P//AP/y6uuuqq/60Irrrqqv+VPvdzP/e37rvvvlv/4R/+4be56qqrrrrqqquuuuqqq676T/Jbv/Vb3/1bv/Vb3/3hH/7h38VVV131vxHBVVdd9b/Oi73Yi732mTNnHvz1X//178NVV1111VVXXXXVVVddddV/st/+7d/+nhd7sRd77Rd7sRd7ba666qr/bQiuuuqq/3U+93M/97e+/uu//n246qqrrrrqqquuuuqqq676L3Dffffd+lmf9Vmv8+Ef/uHfdc011zyYq6666n8Tgquuuup/lc/93M/9rR/5kR/57H/4h3/4ba666qqrrrrqqquuuuqqq/6L3Hfffbf+1m/91ne/4zu+42dx1VVX/W9CcNVVV/2v8Tqv8zrvDfCjP/qjn8NVV1111VVXXXXVVVddddV/sd/+7d/+njNnzjz4dV7ndd6bq6666n8Lgquuuup/hWuuuebBH/7hH/5dP/IjP/I5XHXVVVddddVVV1111VVX/Te47777bv36r//6937Hd3zHz7rmmmsezFVXXfW/AcFVV131v8KHf/iHf9eP/MiPfPY//MM//DZXXXXVVVddddVVV1111VX/Tc6ePfuMH/3RH/2cz/mcz/ktrrrqqv8NCK666qr/8d7xHd/xswB+9Ed/9HO46qqrrrrqqquuuuqqq676b/Zbv/Vb33327Nlb3/Ed3/GzuOqqq/6nI7jqqqv+R3uxF3ux136nd3qnz/76r//69+Gqq6666qqrrrrqqquuuup/iK//+q9/n9d5ndd57xd7sRd7ba666qr/yQiuuuqq/9He6Z3e6bM+8zM/83Xuu+++W7nqqquuuuqqq6666qqrrvof4r777rv1R3/0Rz/nwz/8w7+Lq6666n8ygquuuup/rHd8x3f8LIB/+Id/+G2uuuqqq6666qqrrrrqqqv+h/mt3/qt7/6Hf/iH3/7wD//w7+Kqq676n4rgqquu+h/pxV7sxV77dV7ndd77Mz/zM1+Hq6666qqrrrrqqquuuuqq/6F+9Ed/9HNe7MVe7LVf7MVe7LW56qqr/iciuOqqq/5H+vAP//Dv+vqv//r34aqrrrrqqquuuuqqq6666n+w++6779av//qvf+8P//AP/y6uuuqq/4kIrrrqqv9xPvdzP/e3/uEf/uG3/+Ef/uG3ueqqq6666qqrrrrqqquu+h/uH/7hH37nt37rt777wz/8w7+Lq6666n8agquuuup/lBd7sRd77TNnzjz467/+69+Hq6666qqrrrrqqquuuuqq/yV++7d/+3uuueaaB7/O67zOe3PVVVf9T0Jw1VVX/Y9xzTXXPPhzP/dzf+vrv/7r34errrrqqquuuuqqq6666qr/Re67775bv/7rv/593vEd3/Gzrrnmmgdz1VVX/U9BcNVVV/2P8eEf/uHf9SM/8iOf/Q//8A+/zVVXXXXVVVddddVVV1111f8y9913362/9Vu/9d0f/uEf/l1cddVV/1MQXHXVVf8jvM7rvM57A/zoj/7o53DVVVddddVVV1111VVXXfW/1G//9m9/D8A7vdM7fTZXXXXV/wQEV1111X+7a6655sEf/uEf/l0/8iM/8jlcddVVV1111VVXXXXVVVf9L3bffffd+vVf//Xv8zqv8zrv/WIv9mKvzVVXXfXfjeCqq676b/fhH/7h3/X1X//17/MP//APv81VV1111VVXXXXVVVddddX/cvfdd9+tP/IjP/LZH/7hH/5dXHXVVf/dCK666qr/Vu/4ju/4WQC/9Vu/9d1cddVVV1111VVXXXXVVVf9H/Fbv/Vb33327Nlb3/Ed3/GzuOqqq/47EVx11VX/bV7sxV7std/pnd7ps7/+67/+fbjqqquuuuqqq6666qqrrvo/5uu//uvf58Vf/MVf+8Ve7MVem6uuuuq/C8FVV1313+ad3umdPuszP/MzX+e+++67lauuuuqqq6666qqrrrrqqv9j7rvvvlt/67d+63s+/MM//Lu46qqr/rtQ3/Ed3/GzuOqqq/7LvfiLv/hrv9iLvdhrv9iLvdhvv9iLvdhrcdVVV1111VX/BW546I2vDfDw0w/hqquuuuqqq/4rfe7nfu5v/f3f//1vc9VVV/1XI7jqqqv+y734i7/4a585c+bBP/IjP/LZXHXVVVddddV/oQtHF7lwdJGrrrrqqquu+q/0W7/1W9995syZB19zzTUP5qqrrvqvhh70oAdx1VVX/df6pm/6pqd//dd//fv8wz/8w29z1VVXXXXVVf+FXvZ1X+GzAP7yN//sc7jqqquuuuqq/0Iv9mIv9tof8REf8d0f/MEf/GCuuuqq/0oEV1111X+pz/3cz/2t3/qt3/ruf/iHf/htrrrqqquuuuqqq6666qqr/p/4h3/4h9/+zd/8ze/68A//8O/iqquu+q9EcNVVV/2XebEXe7HXPnPmzIN/9Ed/9HO46qqrrrrqqquuuuqqq676f+a3fuu3vvuaa6558Ou8zuu8N1ddddV/FYKrrrrqv8Q111zz4M/93M/9ra//+q9/H6666qqrrrrqqquuuuqqq/4fOnv27DO+/uu//n3e8R3f8bOuueaaB3PVVVf9VyC46qqr/kt8+Id/+Hf9yI/8yGf/wz/8w29z1VVXXXXVVVddddVVV131/9R9991364/+6I9+zod/+Id/F1ddddV/BYKrrrrqP907vuM7fhbAj/7oj34OV1111VVXXXXVVVddddVV/8/9wz/8w28DvOM7vuNncdVVV/1nI7jqqqv+U11zzTUPfqd3eqfP/vqv//r34aqrrrrqqquuuuqqq6666iruu+++W7/+67/+fV7ndV7nvV/8xV/8tbnqqqv+MxFcddVV/6k+/MM//Ls+8zM/83Xuu+++W7nqqquuuuqqq6666qqrrrrqsvvuu+/WH/3RH/2cD//wD/9urrrqqv9MBFddddV/mnd8x3f8LIB/+Id/+G2uuuqqq6666qqrrrrqqquueg6/9Vu/9d1///d//1vv+I7v+FlcddVV/1kIrrrqqv8UL/ZiL/ba7/RO7/TZn/mZn/k6XHXVVVddddVVV1111VVXXfV8/ciP/Mhnv/iLv/hrv9iLvdhrc9VVV/1nILjqqqv+U3z4h3/4d33mZ37m63DVVVddddVVV1111VVXXXXVC3T27Nln/MiP/MjnfPiHf/h3cdVVV/1nILjqqqv+w33u537ub/3DP/zDb//DP/zDb3PVVVddddVVV1111VVXXXXVC/UP//APv/1bv/Vb3/3hH/7h38VVV131H43gqquu+g/1Yi/2Yq995syZB3/913/9+3DVVVddddVVV1111VVXXXXVi+S3f/u3v+fFXuzFXvvFXuzFXpurrrrqPxLBVVdd9R/qcz/3c3/r67/+69+Hq6666qqrrrrqqquuuuqqq15k9913362f9Vmf9Tof/uEf/l3XXHPNg7nqqqv+oxBcddVV/2E+93M/97d+5Ed+5LP/4R/+4be56qqrrrrqqquuuuqqq6666l/lvvvuu/W3fuu3vvvDP/zDv5urrrrqPwrBVVdd9R/idV7ndd4b4Ed/9Ec/h6uuuuqqq6666qqrrrrqqqv+TX77t3/7e2z7Hd/xHT+Lq6666j8CwVVXXfXvds011zz4wz/8w7/rR37kRz6Hq6666qqrrrrqqquuuuqqq/7N7rvvvlu//uu//r1f53Ve572vueaaB3PVVVf9exFcddVV/24f/uEf/l0/8iM/8tn/8A//8NtcddVVV1111VVXXXXVVVdd9e9y9uzZZ/zoj/7o53zO53zOb3HVVVf9exFcddVV/y7v+I7v+FkAP/qjP/o5XHXVVVddddVVV1111VVXXfUf4rd+67e+++zZs7e+4zu+42dx1VVX/XsQXHXVVf9mL/ZiL/ba7/RO7/TZX//1X/8+XHXVVVddddVVV1111VVXXfUf6uu//uvf53Ve53Xe+8Ve7MVem6uuuurfiuCqq676N3und3qnz/rMz/zM17nvvvtu5aqrrrrqqquuuuqqq6666qr/UPfdd9+tP/qjP/o5H/7hH/5dXHXVVf9WBFddddW/yTu+4zt+FsA//MM//DZXXXXVVVddddVVV1111VVX/af4rd/6re/+h3/4h9/+8A//8O/iqquu+rcguOqqq/7VXuzFXuy1X+d1Xue9P/MzP/N1uOqqq6666qqrrrrqqquuuuo/1Y/+6I9+zou92Iu99ou92Iu9NlddddW/FsFVV131r/bhH/7h3/X1X//178NVV1111VVXXXXVVVddddVV/+nuu+++W7/+67/+vT/8wz/8u7jqqqv+tQiuuuqqf5XP/dzP/a1/+Id/+O1/+Id/+G2uuuqqq6666qqrrrrqqquu+i/xD//wD7/zW7/1W9/94R/+4d/FVVdd9a9BcNVVV73IXuzFXuy1z5w58+Cv//qvfx+uuuqqq6666qqrrrrqqquu+i/127/9299zzTXXPPh1Xud13purrrrqRUVw1VVXvUiuueaaB3/u537ub33913/9+3DVVVddddVVV1111VVXXXXVf7n77rvv1q//+q9/n3d8x3f8rGuuuebBXHXVVS8KgquuuupF8uEf/uHf9SM/8iOf/Q//8A+/zVVXXXXVVVddddVVV1111VX/Le67775bf+u3fuu7P/zDP/y7uOqqq14UBFddddW/6HVe53XeG+BHf/RHP4errrrqqquuuuqqq6666qqr/lv99m//9vcAvNM7vdNnc9VVV/1LCK666qoX6pprrnnwh3/4h3/Xj/zIj3wOV1111VVXXXXVVVddddVVV/23u++++279+q//+vd5ndd5nfd+sRd7sdfmqquuemEIrrrqqhfqwz/8w7/r67/+69/nH/7hH36bq6666qqrrrrqqquuuuqqq/5HuO+++279kR/5kc/+8A//8O/iqquuemEIrrrqqhfoHd/xHT8L4Ld+67e+m6uuuuqqq6666qqrrrrqqqv+R/mt3/qt7z579uyt7/iO7/hZXHXVVS8IwVVXXfV8vdiLvdhrv9M7vdNnf/3Xf/37cNVVV1111VVXXXXVVVddddX/SF//9V//Pi/+4i/+2i/2Yi/22lx11VXPD8FVV131fL3TO73TZ33mZ37m69x33323ctVVV1111VVXXXXVVVddddX/SPfdd9+tv/Vbv/U9H/7hH/5dXHXVVc8PwVVXXfU8PvzDP/y77rvvvlv/4R/+4be56qqrrrrqqquuuuqqq6666n+03/qt3/ruf/iHf/jtD//wD/8urrrqqudGcNVVVz2HF3uxF3vtF3uxF3vtr//6r38frrrqqquuuuqqq6666qqrrvpf4Ud/9Ec/58Ve7MVe+8Vf/MVfm6uuuuqBCK666qrn8OEf/uHf9fVf//Xvw1VXXXXVVVddddVVV1111VX/a9x33323fv3Xf/37fPiHf/h3X3PNNQ/mqquuuh/BVVdd9Syf+7mf+1u/9Vu/9d3/8A//8NtcddVVV1111VVXXXXVVVdd9b/KP/zDP/z2b/7mb37XO77jO34WV1111f0Irrrqqste7MVe7LUBfvRHf/RzuOqqq6666qqrrrrqqquuuup/pd/6rd/67muuuebBr/M6r/PeXHXVVQAEV111Fddcc82DP/dzP/e3fuRHfuRzuOqqq6666qqrrrrqqquuuup/rbNnzz7j67/+69/nHd/xHT/rmmuueTBXXXUVwVVXXcWHf/iHf9eP/MiPfPY//MM//DZXXXXVVVddddVVV1111VVX/a9233333fqjP/qjn/PhH/7h38VVV11FcNVV/8+94zu+42cB/OiP/ujncNVVV1111VVXXXXVVVddddX/Cf/wD//w2wDv+I7v+FlcddX/bwRXXfX/2DXXXPPgd3qnd/rsr//6r38frrrqqquuuuqqq6666qqrrvo/47777rv167/+69/ndV7ndd77xV/8xV+bq676/4vgqqv+H/vwD//w7/rMz/zM17nvvvtu5aqrrrrqqquuuuqqq6666qr/U+67775bf/RHf/RzPvzDP/y7ueqq/78Irrrq/6l3fMd3/CyAf/iHf/htrrrqqquuuuqqq6666qqrrvo/6bd+67e+++///u9/68M//MO/i6uu+v+J4Kqr/h96sRd7sdd+ndd5nff+zM/8zNfhqquuuuqqq6666qqrrrrqqv/TfuRHfuSzr7nmmge/2Iu92Gtz1VX//xBcddX/Qx/+4R/+XV//9V//Plx11VVXXXXVVVddddVVV131f97Zs2ef8SM/8iOf8+Ef/uHfxVVX/f9DcNVV/8987ud+7m/9wz/8w2//wz/8w29z1VVXXXXVVVddddVVV1111f8L//AP//Dbv/Vbv/XdH/7hH/5dXHXV/y8EV131/8iLvdiLvfaZM2ce/PVf//Xvw1VXXXXVVVddddVVV1111VX/r/z2b//297zYi73Ya7/O67zOe3PVVf9/EFx11f8jn/u5n/tbX//1X/8+XHXVVVddddVVV1111VVXXfX/zn333XfrZ33WZ73OO77jO37WNddc82Cuuur/B4Krrvp/4nM/93N/60d+5Ec++x/+4R9+m6uuuuqqq6666qqrrrrqqqv+X7rvvvtu/a3f+q3v/vAP//Dv5qqr/n8guOqq/wde53Ve570BfvRHf/RzuOqqq6666qqrrrrqqquuuur/td/+7d/+Htt+x3d8x8/iqqv+7yO46qr/46655poHf/iHf/h3/ciP/MjncNVVV1111VVXXXXVVVddddX/e/fdd9+tX//1X//er/M6r/Pe11xzzYO56qr/2wiuuur/uA//8A//rq//+q9/n3/4h3/4ba666qqrrrrqqquuuuqqq666Cjh79uwzfvRHf/RzPudzPue3uOqq/9sIrrrq/7B3fMd3/CyA3/qt3/purrrqqquuuuqqq6666qqrrrrqAX7rt37ru8+ePXvrO77jO34WV131fxfBVVf9H/ViL/Zir/1O7/ROn/31X//178NVV1111VVXXXXVVVddddVVVz0fX//1X/8+r/M6r/PeL/ZiL/baXHXV/00EV131f9Q7vdM7fdZnfuZnvs599913K1ddddVVV1111VVXXXXVVVdd9Xzcd999t/7oj/7o53z4h3/4d3HVVf83EVx11f9B7/iO7/hZAP/wD//w21x11VVXXXXVVVddddVVV1111QvxW7/1W9/9D//wD7/94R/+4d/FVVf930Nw1VX/x7zYi73Ya7/O67zOe3/mZ37m63DVVVddddVVV1111VVXXXXVVS+CH/3RH/2cF3uxF3vtF3uxF3ttrrrq/xaCq676P+bDP/zDv+vrv/7r34errrrqqquuuuqqq6666qqrrnoR3Xfffbd+/dd//Xt/+Id/+Hdx1VX/txBcddX/IZ/7uZ/7W//wD//w2//wD//w21x11VVXXXXVVVddddVVV1111b/CP/zDP/zOb/3Wb333h3/4h38XV131fwfBVVf9H/FiL/Zir33mzJkHf/3Xf/37cNVVV1111VVXXXXVVVddddVV/wa//du//T3XXHPNg1/ndV7nvbnqqv8bCK666v+Aa6655sGf+7mf+1tf//Vf/z5cddVVV1111VVXXXXVVVddddW/0X333Xfr13/917/PO77jO37WNddc82Cuuup/P4Krrvo/4MM//MO/60d+5Ec++x/+4R9+m6uuuuqqq6666qqrrrrqqquu+ne47777bv2t3/qt7/7wD//w7+Kqq/73I7jqqv/lXud1Xue9AH70R3/0c7jqqquuuuqqq6666qqrrrrqqv8Av/3bv/09AO/0Tu/02Vx11f9uBFdd9b/YNddc8+AP//AP/+4f+ZEf+Ryuuuqqq6666qqrrrrqqquuuuo/yH333Xfr13/917/P67zO67z3i73Yi702V131vxfBVVf9L/bhH/7h3/WZn/mZr/MP//APv81VV1111VVXXXXVVVddddVVV/0Huu+++279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F3vtF3uxF3ttrrrqvw7BVVf9F/rwD//w7/r6r//69+Gqq6666qqrrrrqqquuuuqqq/6fue+++279+q//+vf+8A//8O/iqqv+6xBcddV/kc/93M/9rd/6rd/67n/4h3/4ba666qqrrrrqqquuuuqqq6666v+hf/iHf/id3/qt3/ruD//wD/8urrrqvwbBVVf9F3ixF3ux1z5z5syDf/RHf/RzuOqqq6666qqrrrrqqquuuuqq/8d++7d/+3uuueaaB7/O67zOe3PVVf/5CK666j/ZNddc8+DP/dzP/a2v//qvfx+uuuqqq6666qqrrrrqqquuuur/ufvuu+/Wr//6r3+fd3zHd/ysa6655sFcddV/LoKrrvpP9uEf/uHf9SM/8iOf/Q//8A+/zVVXXXXVVVddddVVV1111VVXXcV9991362/91m9994d/+Id/F1dd9Z+L4Kqr/hO94zu+42cB/OiP/ujncNVVV1111VVXXXXVVVddddVVVz3Lb//2b38PwDu90zt9Nldd9Z+H4Kqr/pNcc801D36nd3qnz/76r//69+Gqq6666qqrrrrqqquuuuqqq656Dvfdd9+tX//1X/8+r/M6r/PeL/ZiL/baXHXVfw6Cq676T/LhH/7h3/WZn/mZr3PffffdylVXXXXVVVddddVVV1111VVXXfU87rvvvlt/5Ed+5LM//MM//Lu46qr/HARXXfWf4B3f8R0/C+Af/uEffpurrrrqqquuuuqqq6666qqrrrrqBfqt3/qt7/6Hf/iH337Hd3zHz+Kqq/7jEVx11X+wF3uxF3vtd3qnd/rsz/zMz3wdrrrqqquuuuqqq6666qqrrrrqqn/Rj/7oj37Oi7/4i7/2i73Yi702V131H4vgqqv+g334h3/4d33mZ37m63DVVVddddVVV1111VVXXXXVVVe9SO67775bf+RHfuRzPvzDP/y7uOqq/1gEV131H+hzP/dzf+sf/uEffvsf/uEffpurrrrqqquuuuqqq6666qqrrrrqRfYP//APv/1bv/Vb3/3hH/7h38VVV/3HIbjqqv8gL/ZiL/baZ86cefDXf/3Xvw9XXXXVVVddddVVV1111VVXXXXVv9pv//Zvf8+LvdiLvfaLv/iLvzZXXfUfg+Cqq/6DfO7nfu5vff3Xf/37cNVVV1111VVXXXXVVVddddVVV/2b3Hfffbd+1md91ut8+Id/+Hdfc801D+aqq/79CK666j/A537u5/7Wj/7oj37OP/zDP/w2V1111VVXXXXVVVddddVVV1111b/Zfffdd+tv/uZvfteHf/iHfxdXXfXvR3DVVf9Or/M6r/PeAD/yIz/y2Vx11VVXXXXVVVddddVVV1111VX/br/1W7/13QDv+I7v+FlcddW/D8FVV/07XHPNNQ/+8A//8O/6kR/5kc/hqquuuuqqq6666qqrrrrqqquu+g9x9uzZZ3z913/9+7zO67zOe19zzTUP5qqr/u0Irrrq3+HDP/zDv+tHfuRHPvsf/uEffpurrrrqqquuuuqqq6666qqrrrrqP8x9991364/+6I9+zud8zuf8Fldd9W9HcNVV/0bv+I7v+FkAP/qjP/o5XHXVVVddddVVV1111VVXXXXVVf/hfuu3fuu7z549e+s7vuM7fhZXXfVvQ3DVVf8GL/ZiL/ba7/RO7/TZX//1X/8+XHXVVVddddVVV1111VVXXXXVVf9pvv7rv/59Xud1Xue9X/zFX/y1ueqqfz2Cq676N3ind3qnz/rMz/zM17nvvvtu5aqrrrrqqquuuuqqq6666qqrrvpPc9999936oz/6o5/z4R/+4d/NVVf96xFcddW/0ju+4zt+FsA//MM//DZXXXXVVVddddVVV1111VVXXXXVf7rf+q3f+u6///u//60P//AP/y6uuupfh+Cqq/4VXuzFXuy1X+d1Xue9P/MzP/N1uOqqq6666qqrrrrqqquuuuqqq/7L/MiP/Mhnv9iLvdhrv9iLvdhrc9VVLzqCq676V/jwD//w7/r6r//69+Gqq6666qqrrrrqqquuuuqqq676L3X27NlnfP3Xf/37fPiHf/h3cdVVLzqCq656EX3u537ub/3DP/zDb//DP/zDb3PVVVddddVVV1111VVXXXXVVVf9l/uHf/iH3/6t3/qt7/7wD//w7+Kqq140BFdd9SJ4sRd7sdc+c+bMg7/+67/+fbjqqquuuuqqq6666qqrrrrqqqv+2/z2b//291xzzTUPfp3XeZ335qqr/mUEV131L7jmmmse/Lmf+7m/9fVf//Xvw1VXXXXVVVddddVVV1111VVXXfXf6r777rv167/+69/nHd/xHT/rmmuueTBXXfXCEVx11b/gwz/8w7/rR37kRz77H/7hH36bq6666qqrrrrqqquuuuqqq6666r/dfffdd+tv/dZvffeHf/iHfzdXXfXCEVx11QvxOq/zOu8N8KM/+qOfw1VXXXXVVVddddVVV1111VVXXfU/xm//9m9/j22/4zu+42dx1VUvGMFVV70A11xzzYM//MM//Lt+5Ed+5HO46qqrrrrqqquuuuqqq6666qqr/ke57777bv36r//6936d13md936xF3ux1+aqq54/gquuegE+/MM//Lu+/uu//n3+4R/+4be56qqrrrrqqquuuuqqq6666qqr/sc5e/bsM370R3/0cz78wz/8u7jqqueP4Kqrno93fMd3/CyA3/qt3/purrrqqquuuuqqq6666qqrrrrqqv+xfuu3fuu7z549e+s7vuM7fhZXXfW8CK666rm82Iu92Gu/0zu902d//dd//ftw1VVXXXXVVVddddVVV1111VVX/Y/39V//9e/z4i/+4q/9Yi/2Yq/NVVc9J4Krrnou7/RO7/RZn/mZn/k69913361cddVVV1111VVXXXXVVVddddVV/+Pdd999t/7Wb/3W93z4h3/4d3HVVc+J4KqrHuDDP/zDvwvgH/7hH36bq6666qqrrrrqqquuuuqqq6666n+N3/qt3/ruf/iHf/jtD//wD/8urrrq2QiuuuqZXuzFXuy1X+zFXuy1P/MzP/N1uOqqq6666qqrrrrqqquuuuqqq/7X+dEf/dHPebEXe7HXfrEXe7HX5qqrriC46qpn+vAP//Dv+vqv//r34aqrrrrqqquuuuqqq6666qqrrvpf6b777rv167/+69/7wz/8w7/rmmuueTBXXQUEV10FfO7nfu5v/dZv/dZ3/8M//MNvc9VVV1111VVXXXXVVVddddVVV/2v9Q//8A+/81u/9Vvf/Y7v+I6fxVVXAcFV/++92Iu92GsD/OiP/ujncNVVV1111VVXXXXVVVddddVVV/2v99u//dvfc8011zz4dV7ndd6bq/6/I7jq/7VrrrnmwZ/7uZ/7Wz/yIz/yOVx11VVXXXXVVVddddVVV1111VX/J9x33323fv3Xf/37vOM7vuNnXXPNNQ/mqv/PCK76f+3DP/zDv+tHfuRHPvsf/uEffpurrrrqqquuuuqqq6666qqrrrrq/4z77rvv1h/90R/9nA//8A//Lq76/4zgqv+33vEd3/GzAH70R3/0c7jqqquuuuqqq6666qqrrrrqqqv+z/mHf/iH3wZ4p3d6p8/mqv+vCK76f+maa6558Du90zt99td//de/D1ddddVVV1111VVXXXXVVVddddX/Sffdd9+tX//1X/8+r/M6r/PeL/ZiL/baXPX/EcFV/y99+Id/+Hd95md+5uvcd999t3LVVVddddVVV1111VVXXXXVVVf9n3Xffffd+iM/8iOf/eEf/uHfxVX/HxFc9f/OO77jO34WwD/8wz/8NlddddVVV1111VVXXXXVVVddddX/eb/1W7/13f/wD//w2x/+4R/+XVz1/w3BVf+vvNiLvdhrv9M7vdNnf+ZnfubrcNVVV1111VVXXXXVVVddddVVV/2/8aM/+qOfc8011zz4xV7sxV6bq/4/Ibjq/5UP//AP/67P/MzPfB2uuuqqq6666qqrrrrqqquuuuqq/1fuu+++W3/kR37kcz78wz/8u7jq/xOCq/7f+NzP/dzf+od/+Iff/od/+Iff5qqrrrrqqquuuuqqq6666qqrrvp/5x/+4R9++7d+67e++8M//MO/i6v+vyC46v+FF3uxF3vtM2fOPPjrv/7r34errrrqqquuuuqqq6666qqrrrrq/63f/u3f/p4Xe7EXe+3XeZ3XeW+u+v+A4Kr/Fz73cz/3t77+67/+fbjqqquuuuqqq6666qqrrrrqqqv+X7vvvvtu/azP+qzXead3eqfPvuaaax7MVf/XEVz1f97nfu7n/taP/uiPfs4//MM//DZXXXXVVVddddVVV1111VVXXXXV/3v33Xffrb/5m7/5XR/+4R/+XVz1fx3BVf+nvc7rvM57A/zIj/zIZ3PVVVddddVVV1111VVXXXXVVVdd9Uy/9Vu/9d0A7/iO7/hZXPV/GcFV/2ddc801D/7wD//w7/qRH/mRz+Gqq6666qqrrrrqqquuuuqqq6666gHOnj37jK//+q9/n9d5ndd572uuuebBXPV/FcFV/2d9+Id/+Hf9yI/8yGf/wz/8w29z1VVXXXXVVVddddVVV1111VVXXfVc7rvvvlt/9Ed/9HM+53M+57e46v8qgqv+T3rHd3zHzwL40R/90c/hqquuuuqqq6666qqrrrrqqquuuuoF+K3f+q3vPnv27K3v+I7v+Flc9X8RwVX/57zYi73Ya7/TO73TZ3/913/9+3DVVVddddVVV1111VVXXXXVVVdd9S/4+q//+vd5ndd5nfd+8Rd/8dfmqv9rCK76P+ed3umdPuszP/MzX+e+++67lauuuuqqq6666qqrrrrqqquuuuqqf8F9991364/+6I9+zod/+Id/N1f9X0Nw1f8p7/iO7/hZAP/wD//w21x11VVXXXXVVVddddVVV1111VVXvYh+67d+67v//u///rc+/MM//Lu46v8Sgqv+z3ixF3ux136d13md9/7Mz/zM1+Gqq6666qqrrrrqqquuuuqqq6666l/pR37kRz77xV7sxV77xV7sxV6bq/6vILjq/4wP//AP/66v//qvfx+uuuqqq6666qqrrrrqqquuuuqqq/4Nzp49+4yv//qvf58P//AP/y6u+r+C4Kr/Ez73cz/3t/7hH/7ht//hH/7ht7nqqquuuuqqq6666qqrrrrqqquu+jf6h3/4h9/+rd/6re/+8A//8O/iqv8LCK76X+/FXuzFXvvMmTMP/vqv//r34aqrrrrqqquuuuqqq6666qqrrrrq3+m3f/u3v+eaa6558Ou8zuu8N1f9b0dw1f9q11xzzYM/93M/97e+/uu//n246qqrrrrqqquuuuqqq6666qqrrvoPcN9999369V//9e/zju/4jp91zTXXPJir/jcjuOp/tQ//8A//rh/5kR/57H/4h3/4ba666qqrrrrqqquuuuqqq6666qqr/oPcd999t/7Wb/3Wd3/4h3/4d3PV/2YEV/2v9Tqv8zrvDfCjP/qjn8NVV1111VVXXXXVVVddddVVV1111X+w3/7t3/4e237Hd3zHz+Kq/60Irvpf6Zprrnnwh3/4h3/Xj/zIj3wOV1111VVXXXXVVVddddVVV1111VX/Ce67775bv/7rv/69X+d1Xue9X+zFXuy1uep/I4Kr/lf68A//8O/6zM/8zNf5h3/4h9/mqquuuuqqq6666qqrrrrqqquuuuo/ydmzZ5/xoz/6o5/z4R/+4d/FVf8bEVz1v847vuM7fhbAP/zDP/w2V1111VVXXXXVVVddddVVV1111VX/yX7rt37ru8+ePXvrO77jO34WV/1vwz8C2wGfP7RRFMAAAAAASUVORK5CYII=)

### Arguments

* `data`: `ChamferData` - Data for chamfers. (REQUIRED)
```js
{
	// The length of the chamfer.
	length: number,
	// The tags of the paths you want to chamfer.
	tags: [uuid |
{
	// Engine information for a tag.
	info: {
	// The id of the tagged object.
	id: uuid,
	// The path the tag is on.
	path: {
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
	// The sketch group the tag is on.
	sketchGroup: uuid,
	// The surface information for the tag.
	surface: {
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
},
},
	value: string,
}],
}
```
* `extrude_group`: `ExtrudeGroup` - An extrude group is a collection of extrude surfaces. (REQUIRED)
```js
{
	// The id of the extrusion end cap
	endCapId: uuid,
	// Chamfers or fillets on this extrude group.
	filletOrChamfers: [{
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
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The sketch group.
	sketchGroup: {
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
	// The id of the extrusion end cap
	endCapId: uuid,
	// Chamfers or fillets on this extrude group.
	filletOrChamfers: [{
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
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The sketch group.
	sketchGroup: SketchGroup,
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
}
```
* `tag`: `TagDeclarator` (OPTIONAL)
```js
{
	digest: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number],
	end: number,
	start: number,
	value: string,
}
```

### Returns

`ExtrudeGroup` - An extrude group is a collection of extrude surfaces.
```js
{
	// The id of the extrusion end cap
	endCapId: uuid,
	// Chamfers or fillets on this extrude group.
	filletOrChamfers: [{
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
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The sketch group.
	sketchGroup: {
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
	// The id of the extrusion end cap
	endCapId: uuid,
	// Chamfers or fillets on this extrude group.
	filletOrChamfers: [{
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
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The sketch group.
	sketchGroup: SketchGroup,
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
}
```



