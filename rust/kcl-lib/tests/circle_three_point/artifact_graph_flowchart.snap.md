```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[35, 96, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    6["Segment<br>[35, 96, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    8[Solid2d]
  end
  1["Cap End"]
    %% face_code_ref=Missing NodePath
  2["Cap Start"]
    %% face_code_ref=Missing NodePath
  3[Wall]
    %% face_code_ref=Missing NodePath
  4["Plane<br>[12, 29, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  7["Sweep Extrusion<br>[102, 122, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
  9["SweepEdge Adjacent"]
  10["SweepEdge Opposite"]
  7 --- 1
  10 <--x 1
  6 <--x 2
  7 --- 2
  6 --- 3
  7 --- 3
  3 --- 9
  3 --- 10
  4 --- 5
  5 --- 6
  5 ---- 7
  5 --- 8
  6 --- 9
  6 --- 10
  7 --- 9
  7 --- 10
```
