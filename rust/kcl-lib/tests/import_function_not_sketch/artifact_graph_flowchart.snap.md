```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[75, 101, 1]"]
      %% Missing NodePath
    3["Segment<br>[107, 125, 1]"]
      %% Missing NodePath
    4["Segment<br>[131, 150, 1]"]
      %% Missing NodePath
    5["Segment<br>[156, 175, 1]"]
      %% Missing NodePath
    6["Segment<br>[181, 200, 1]"]
      %% Missing NodePath
    7["Segment<br>[206, 231, 1]"]
      %% Missing NodePath
    8["Segment<br>[237, 258, 1]"]
      %% Missing NodePath
    9["Segment<br>[264, 283, 1]"]
      %% Missing NodePath
    10["Segment<br>[289, 296, 1]"]
      %% Missing NodePath
    11[Solid2d]
  end
  1["Plane<br>[52, 69, 1]"]
    %% Missing NodePath
  12["Sweep Revolve<br>[302, 319, 1]"]
    %% Missing NodePath
  13[Wall]
    %% face_code_ref=Missing NodePath
  14[Wall]
    %% face_code_ref=Missing NodePath
  15[Wall]
    %% face_code_ref=Missing NodePath
  16[Wall]
    %% face_code_ref=Missing NodePath
  17[Wall]
    %% face_code_ref=Missing NodePath
  18[Wall]
    %% face_code_ref=Missing NodePath
  19[Wall]
    %% face_code_ref=Missing NodePath
  20[Wall]
    %% face_code_ref=Missing NodePath
  21["SweepEdge Adjacent"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Adjacent"]
  24["SweepEdge Adjacent"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 --- 10
  2 --- 11
  2 ---- 12
  12 <--x 3
  3 --- 16
  3 x--> 21
  12 <--x 4
  4 --- 15
  4 --- 21
  12 <--x 5
  5 --- 13
  5 --- 22
  12 <--x 6
  6 --- 20
  6 --- 23
  12 <--x 7
  7 --- 17
  7 --- 24
  12 <--x 8
  8 --- 19
  8 --- 25
  12 <--x 9
  9 --- 14
  9 --- 26
  12 <--x 10
  10 --- 18
  10 --- 27
  12 --- 13
  12 --- 14
  12 --- 15
  12 --- 16
  12 --- 17
  12 --- 18
  12 --- 19
  12 --- 20
  12 --- 21
  12 --- 22
  12 --- 23
  12 --- 24
  12 --- 25
  12 --- 26
  12 --- 27
  13 --- 22
  25 <--x 14
  14 --- 26
  15 --- 21
  16 --- 21
  27 <--x 16
  23 <--x 17
  17 --- 24
  26 <--x 18
  18 --- 27
  24 <--x 19
  19 --- 25
  22 <--x 20
  20 --- 23
```
