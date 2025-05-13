```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    5["Segment<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    6["Segment<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]"]
    7["Segment<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]"]
    8["Segment<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]"]
    9["Segment<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]"]
    15[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    10["Segment<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    11["Segment<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]"]
    12["Segment<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]"]
    13["Segment<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]"]
    14[Solid2d]
  end
  1["Plane<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
  2["StartSketchOnFace<br>[343, 382, 0]"]
  16["Sweep Extrusion<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
  17["Sweep Extrusion<br>[ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25["Cap Start"]
  26["Cap End"]
  27["Cap End"]
  28["SweepEdge Opposite"]
  29["SweepEdge Opposite"]
  30["SweepEdge Opposite"]
  31["SweepEdge Opposite"]
  32["SweepEdge Opposite"]
  33["SweepEdge Opposite"]
  34["SweepEdge Opposite"]
  35["SweepEdge Adjacent"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Adjacent"]
  42["EdgeCut Fillet<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
  1 --- 3
  21 x--> 2
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 15
  3 ---- 16
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 --- 14
  4 ---- 17
  21 --- 4
  5 --- 20
  5 x--> 26
  5 --- 29
  5 --- 35
  6 --- 18
  6 x--> 26
  6 --- 30
  6 --- 37
  6 --- 42
  7 --- 21
  7 x--> 26
  7 --- 31
  7 --- 36
  8 --- 19
  8 x--> 26
  8 --- 28
  8 --- 38
  10 x--> 21
  10 --- 23
  10 --- 33
  10 --- 39
  11 x--> 21
  11 --- 22
  11 --- 32
  11 --- 40
  12 x--> 21
  12 --- 24
  12 --- 34
  12 --- 41
  16 --- 18
  16 --- 19
  16 --- 20
  16 --- 21
  16 --- 25
  16 --- 26
  16 --- 28
  16 --- 29
  16 --- 30
  16 --- 31
  16 --- 35
  16 --- 36
  16 --- 37
  16 --- 38
  17 --- 22
  17 --- 23
  17 --- 24
  17 --- 27
  17 --- 32
  17 --- 33
  17 --- 34
  17 --- 39
  17 --- 40
  17 --- 41
  30 <--x 18
  35 <--x 18
  37 <--x 18
  28 <--x 19
  36 <--x 19
  38 <--x 19
  29 <--x 20
  35 <--x 20
  38 <--x 20
  31 <--x 21
  36 <--x 21
  37 <--x 21
  32 <--x 22
  39 <--x 22
  40 <--x 22
  33 <--x 23
  39 <--x 23
  41 <--x 23
  34 <--x 24
  40 <--x 24
  41 <--x 24
  28 <--x 25
  29 <--x 25
  30 <--x 25
  31 <--x 25
  32 <--x 27
  33 <--x 27
  34 <--x 27
```
