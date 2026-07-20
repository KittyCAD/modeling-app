```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[81, 109, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    3["Segment<br>[117, 136, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    4["Segment<br>[144, 164, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    5["Segment<br>[172, 192, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    6["Segment<br>[200, 207, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    7[Solid2d]
  end
  subgraph path23 [Path]
    23["Path<br>[373, 390, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    24["Segment<br>[373, 390, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    25["Segment<br>[373, 390, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    26["Segment<br>[373, 390, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    27["Segment<br>[373, 390, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  1["Plane<br>[56, 73, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  8["Sweep Extrusion<br>[215, 234, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]
  9[Wall]
    %% face_code_ref=Missing NodePath
  10[Wall]
    %% face_code_ref=Missing NodePath
  11[Wall]
    %% face_code_ref=Missing NodePath
  12[Wall]
    %% face_code_ref=Missing NodePath
  13["Cap Start"]
    %% face_code_ref=Missing NodePath
  14["Cap End"]
    %% face_code_ref=Missing NodePath
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  28[Wall]
    %% face_code_ref=Missing NodePath
  29[Wall]
    %% face_code_ref=Missing NodePath
  30[Wall]
    %% face_code_ref=Missing NodePath
  31[Wall]
    %% face_code_ref=Missing NodePath
  32["Cap Start"]
    %% face_code_ref=Missing NodePath
  33["Cap End"]
    %% face_code_ref=Missing NodePath
  34["SweepEdge Opposite"]
  35["SweepEdge Adjacent"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Opposite"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  1 --- 2
  1 <--x 23
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
  3 --- 12
  3 x--> 13
  3 --- 21
  3 --- 22
  3 --- 40
  3 --- 41
  4 --- 11
  4 x--> 13
  4 --- 19
  4 --- 20
  4 --- 38
  4 --- 39
  5 --- 10
  5 x--> 13
  5 --- 17
  5 --- 18
  5 --- 36
  5 --- 37
  6 --- 9
  6 x--> 13
  6 --- 15
  6 --- 16
  6 --- 34
  6 --- 35
  23 <--x 7
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  23 <---x 8
  8 <--x 28
  8 <--x 29
  8 <--x 30
  8 <--x 31
  8 <--x 32
  8 <--x 33
  8 --- 34
  8 --- 35
  8 --- 36
  8 --- 37
  8 --- 38
  8 --- 39
  8 --- 40
  8 --- 41
  9 --- 15
  9 --- 16
  18 <--x 9
  9 --- 34
  9 --- 35
  37 <--x 9
  10 --- 17
  10 --- 18
  20 <--x 10
  10 --- 36
  10 --- 37
  39 <--x 10
  11 --- 19
  11 --- 20
  22 <--x 11
  11 --- 38
  11 --- 39
  41 <--x 11
  16 <--x 12
  12 --- 21
  12 --- 22
  35 <--x 12
  12 --- 40
  12 --- 41
  15 <--x 14
  17 <--x 14
  19 <--x 14
  21 <--x 14
  34 <--x 14
  36 <--x 14
  38 <--x 14
  40 <--x 14
  27 <--x 15
  28 <--x 15
  27 <--x 16
  28 <--x 16
  26 <--x 17
  29 <--x 17
  26 <--x 18
  29 <--x 18
  25 <--x 19
  30 <--x 19
  25 <--x 20
  30 <--x 20
  24 <--x 21
  31 <--x 21
  24 <--x 22
  31 <--x 22
  23 --- 24
  23 --- 25
  23 --- 26
  23 --- 27
  24 --- 28
  24 x--> 32
  25 --- 29
  25 x--> 32
  26 --- 30
  26 x--> 32
  27 --- 31
  27 x--> 32
```
