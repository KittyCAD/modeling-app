```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
    5["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    6["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    7["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]"]
    8["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]"]
    9["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]"]
    10["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]"]
    11["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 7 }]"]
    13[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
    12["Segment<br>[ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
    14[Solid2d]
  end
  1["Plane<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  2["Plane<br>[ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  15["Sweep Revolve<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  16["Sweep Extrusion<br>[ProgramBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  17["CompositeSolid Subtract<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25["Cap Start"]
  26["Cap End"]
  27["SweepEdge Opposite"]
  28["SweepEdge Adjacent"]
  29["SweepEdge Adjacent"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Adjacent"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 10
  3 --- 11
  3 --- 13
  3 ---- 15
  3 --- 17
  4 --- 12
  4 --- 14
  4 ---- 16
  4 --- 17
  15 <--x 5
  5 --- 24
  5 x--> 30
  15 <--x 6
  6 --- 22
  6 --- 30
  15 <--x 7
  7 --- 21
  7 --- 32
  15 <--x 8
  8 --- 23
  8 --- 29
  15 <--x 9
  9 --- 20
  9 --- 31
  15 <--x 10
  10 --- 19
  10 --- 33
  12 --- 18
  12 x--> 25
  12 --- 27
  12 --- 28
  15 --- 19
  15 --- 20
  15 --- 21
  15 --- 22
  15 --- 23
  15 --- 24
  15 --- 29
  15 --- 30
  15 --- 31
  15 --- 32
  15 --- 33
  16 --- 18
  16 --- 25
  16 --- 26
  16 --- 27
  16 --- 28
  27 <--x 18
  28 <--x 18
  31 <--x 19
  33 <--x 19
  29 <--x 20
  31 <--x 20
  32 <--x 21
  30 <--x 22
  29 <--x 23
  32 <--x 23
  30 <--x 24
  33 <--x 24
  27 <--x 26
```
