```mermaid
flowchart LR
  subgraph path7 [Path]
    7["Path<br>[43, 85, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    16["Segment<br>[93, 114, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    11["Segment<br>[122, 144, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    12["Segment<br>[152, 173, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    13["Segment<br>[181, 237, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    14["Segment<br>[245, 252, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    18[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[349, 406, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    15["Segment<br>[349, 406, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    17[Solid2d]
  end
  9["Plane<br>[12, 29, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  19["Sweep Extrusion<br>[268, 301, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  33[Wall]
    %% face_code_ref=Missing NodePath
  32[Wall]
    %% face_code_ref=Missing NodePath
  31[Wall]
    %% face_code_ref=Missing NodePath
  35[Wall]
    %% face_code_ref=Missing NodePath
  3["Cap Start"]
    %% face_code_ref=Missing NodePath
  1["Cap End"]
    %% face_code_ref=Missing NodePath
  28["SweepEdge Opposite"]
  23["SweepEdge Adjacent"]
  27["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  26["SweepEdge Opposite"]
  21["SweepEdge Adjacent"]
  30["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  10["Plane<br>[317, 334, 0]"]
    %% [ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  20["Sweep Extrusion<br>[422, 454, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  34[Wall]
    %% face_code_ref=Missing NodePath
  4["Cap Start"]
    %% face_code_ref=Missing NodePath
  2["Cap End"]
    %% face_code_ref=Missing NodePath
  29["SweepEdge Opposite"]
  24["SweepEdge Adjacent"]
  8["Pattern Transform<br>[505, 674, 0]<br>Copies: 4<br>Faces: 12<br>Edges: 12"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  5["CompositeSolid Subtract<br>[686, 730, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  19 --- 1
  26 <--x 1
  27 <--x 1
  28 <--x 1
  30 <--x 1
  20 --- 2
  29 <--x 2
  11 <--x 3
  12 <--x 3
  13 <--x 3
  16 <--x 3
  19 --- 3
  15 <--x 4
  20 --- 4
  6 --- 5
  7 --- 5
  6 --- 8
  10 --- 6
  6 --- 15
  6 --- 17
  6 ---- 20
  9 --- 7
  7 --- 11
  7 --- 12
  7 --- 13
  7 --- 14
  7 --- 16
  7 --- 18
  7 ---- 19
  20 <--x 8
  11 --- 21
  11 --- 26
  11 --- 31
  12 --- 22
  12 --- 27
  12 --- 32
  13 --- 23
  13 --- 28
  13 --- 33
  15 --- 24
  15 --- 29
  15 --- 34
  16 --- 25
  16 --- 30
  16 --- 35
  19 --- 21
  19 --- 22
  19 --- 23
  19 --- 25
  19 --- 26
  19 --- 27
  19 --- 28
  19 --- 30
  19 --- 31
  19 --- 32
  19 --- 33
  19 --- 35
  20 --- 24
  20 --- 29
  20 --- 34
  31 --- 21
  21 x--> 31
  32 --- 22
  22 x--> 32
  33 --- 23
  23 x--> 33
  34 --- 24
  35 --- 25
  25 x--> 35
  31 --- 26
  32 --- 27
  33 --- 28
  34 --- 29
  35 --- 30
```
