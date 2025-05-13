```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    6["Segment<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
    7["Segment<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]"]
    8["Segment<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]"]
    9["Segment<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]"]
    11[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    10["Segment<br>[ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
    12[Solid2d]
  end
  1["Plane<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]"]
  2["Plane<br>[ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]"]
  3["StartSketchOnFace<br>[713, 750, 0]"]
  13["Sweep Extrusion<br>[ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 7 }]"]
  14["Sweep Extrusion<br>[ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]"]
  15[Wall]
  16["Cap End"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  1 --- 4
  2 <--x 3
  2 --- 5
  10 <--x 2
  4 --- 6
  4 --- 7
  4 --- 8
  4 --- 9
  4 --- 11
  4 ---- 13
  5 --- 10
  5 --- 12
  5 ---- 14
  10 --- 15
  10 --- 17
  10 --- 18
  14 --- 15
  14 --- 16
  14 --- 17
  14 --- 18
  17 <--x 15
  18 <--x 15
  17 <--x 16
```
