```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[35, 70, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    4["Segment<br>[35, 70, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    6[Solid2d]
  end
  1[Wall]
    %% face_code_ref=Missing NodePath
  2["Plane<br>[12, 29, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  5["Sweep Revolve<br>[76, 120, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
  7["SweepEdge Adjacent"]
  4 --- 1
  5 --- 1
  1 --- 7
  2 --- 3
  3 --- 4
  3 ---- 5
  3 --- 6
  5 <--x 4
  4 --- 7
  5 --- 7
```
