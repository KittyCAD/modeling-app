```mermaid
flowchart LR
  subgraph path13 [Path]
    13["Path<br>[33, 66, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    14["Segment<br>[72, 112, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    15["Segment<br>[118, 145, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    16["Segment<br>[151, 178, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    17["Segment<br>[184, 192, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    28[Solid2d]
  end
  subgraph path21 [Path]
    21["Path<br>[270, 295, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    22["Segment<br>[301, 320, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    23["Segment<br>[326, 345, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    24["Segment<br>[351, 371, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    25["Segment<br>[377, 385, 0]"]
      %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    27[Solid2d]
  end
  1["Cap End"]
    %% face_code_ref=Missing NodePath
  2["Cap End"]
    %% face_code_ref=Missing NodePath
  3["Cap Start"]
    %% face_code_ref=Missing NodePath
  4["Cap Start"]
    %% face_code_ref=Missing NodePath
  5[Wall]
    %% face_code_ref=Missing NodePath
  6[Wall]
    %% face_code_ref=Missing NodePath
  7[Wall]
    %% face_code_ref=Missing NodePath
  8[Wall]
    %% face_code_ref=Missing NodePath
  9[Wall]
    %% face_code_ref=Missing NodePath
  10[Wall]
    %% face_code_ref=Missing NodePath
  11[Wall]
    %% face_code_ref=Missing NodePath
  12["Plane<br>[10, 27, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  18["Sweep Extrusion<br>[198, 217, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]
  19["StartSketchOnFace<br>[229, 264, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  20[Wall]
    %% face_code_ref=[ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  26["Sweep Extrusion<br>[391, 410, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]
  29["SweepEdge Adjacent"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Adjacent"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Adjacent"]
  34["SweepEdge Adjacent"]
  35["SweepEdge Adjacent"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Opposite"]
  39["SweepEdge Opposite"]
  40["SweepEdge Opposite"]
  41["SweepEdge Opposite"]
  42["SweepEdge Opposite"]
  43["SweepEdge Opposite"]
  44["SweepEdge Opposite"]
  18 --- 1
  37 <--x 1
  38 <--x 1
  39 <--x 1
  44 <--x 1
  26 --- 2
  40 <--x 2
  41 <--x 2
  42 <--x 2
  43 <--x 2
  14 <--x 3
  15 <--x 3
  16 <--x 3
  17 <--x 3
  18 --- 3
  22 <--x 4
  23 <--x 4
  24 <--x 4
  25 <--x 4
  26 --- 4
  15 --- 5
  18 --- 5
  5 --- 29
  29 <--x 5
  5 --- 37
  16 --- 6
  18 --- 6
  6 --- 30
  30 <--x 6
  6 --- 38
  17 --- 7
  18 --- 7
  7 --- 31
  31 <--x 7
  7 --- 39
  22 --- 8
  26 --- 8
  8 --- 32
  32 <--x 8
  8 --- 40
  23 --- 9
  26 --- 9
  9 --- 33
  33 <--x 9
  9 --- 41
  24 --- 10
  26 --- 10
  10 --- 34
  34 <--x 10
  10 --- 42
  25 --- 11
  26 --- 11
  11 --- 35
  35 <--x 11
  11 --- 43
  12 --- 13
  13 --- 14
  13 --- 15
  13 --- 16
  13 --- 17
  13 ---- 18
  13 --- 28
  14 --- 20
  14 --- 36
  14 --- 44
  15 --- 29
  15 --- 37
  16 --- 30
  16 --- 38
  17 --- 31
  17 --- 39
  18 --- 20
  18 --- 29
  18 --- 30
  18 --- 31
  18 --- 36
  18 --- 37
  18 --- 38
  18 --- 39
  18 --- 44
  20 x--> 19
  20 --- 21
  20 --- 36
  36 <--x 20
  20 --- 44
  21 --- 22
  21 --- 23
  21 --- 24
  21 --- 25
  21 ---- 26
  21 --- 27
  22 --- 32
  22 --- 40
  23 --- 33
  23 --- 41
  24 --- 34
  24 --- 42
  25 --- 35
  25 --- 43
  26 --- 32
  26 --- 33
  26 --- 34
  26 --- 35
  26 --- 40
  26 --- 41
  26 --- 42
  26 --- 43
```
