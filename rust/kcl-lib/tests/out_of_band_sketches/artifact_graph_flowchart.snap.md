```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
    5["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    6["Segment<br>[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    9["Segment<br>[ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    10["Segment<br>[ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    14[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
    7["Segment<br>[ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    8["Segment<br>[ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    11["Segment<br>[ProgramBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    12["Segment<br>[ProgramBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    13[Solid2d]
  end
  1["Plane<br>[ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  2["Plane<br>[ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]"]
  15["Sweep Extrusion<br>[ProgramBodyItem { index: 6 }, ExpressionStatementExpr]"]
  16["Sweep Extrusion<br>[ProgramBodyItem { index: 6 }, ExpressionStatementExpr]"]
  17[Wall]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25["Cap Start"]
  26["Cap Start"]
  27["Cap End"]
  28["Cap End"]
  29["SweepEdge Opposite"]
  30["SweepEdge Opposite"]
  31["SweepEdge Opposite"]
  32["SweepEdge Opposite"]
  33["SweepEdge Opposite"]
  34["SweepEdge Opposite"]
  35["SweepEdge Opposite"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 9
  3 --- 10
  3 --- 14
  3 ---- 15
  4 --- 7
  4 --- 8
  4 --- 11
  4 --- 12
  4 --- 13
  4 ---- 16
  5 --- 20
  5 x--> 26
  5 --- 31
  5 --- 40
  6 --- 19
  6 x--> 26
  6 --- 29
  6 --- 39
  7 --- 23
  7 x--> 25
  7 --- 35
  7 --- 44
  8 --- 22
  8 x--> 25
  8 --- 36
  8 --- 42
  9 --- 17
  9 x--> 26
  9 --- 32
  9 --- 37
  10 --- 18
  10 x--> 26
  10 --- 30
  10 --- 38
  11 --- 24
  11 x--> 25
  11 --- 33
  11 --- 43
  12 --- 21
  12 x--> 25
  12 --- 34
  12 --- 41
  15 --- 17
  15 --- 18
  15 --- 19
  15 --- 20
  15 --- 26
  15 --- 28
  15 --- 29
  15 --- 30
  15 --- 31
  15 --- 32
  15 --- 37
  15 --- 38
  15 --- 39
  15 --- 40
  16 --- 21
  16 --- 22
  16 --- 23
  16 --- 24
  16 --- 25
  16 --- 27
  16 --- 33
  16 --- 34
  16 --- 35
  16 --- 36
  16 --- 41
  16 --- 42
  16 --- 43
  16 --- 44
  32 <--x 17
  37 <--x 17
  39 <--x 17
  30 <--x 18
  37 <--x 18
  38 <--x 18
  29 <--x 19
  39 <--x 19
  40 <--x 19
  31 <--x 20
  38 <--x 20
  40 <--x 20
  34 <--x 21
  41 <--x 21
  43 <--x 21
  36 <--x 22
  42 <--x 22
  44 <--x 22
  35 <--x 23
  41 <--x 23
  44 <--x 23
  33 <--x 24
  42 <--x 24
  43 <--x 24
  33 <--x 27
  34 <--x 27
  35 <--x 27
  36 <--x 27
  29 <--x 28
  30 <--x 28
  31 <--x 28
  32 <--x 28
```
