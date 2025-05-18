```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[80, 105, 1]"]
    3["Segment<br>[111, 128, 1]"]
    4["Segment<br>[134, 151, 1]"]
    5["Segment<br>[157, 175, 1]"]
    6["Segment<br>[181, 199, 1]"]
    7["Segment<br>[205, 213, 1]"]
    8[Solid2d]
  end
  1["Plane<br>[57, 74, 1]"]
  9["Sweep Extrusion<br>[219, 238, 1]"]
  10[Wall]
    %% face_code_ref=Missing NodePath
  11[Wall]
    %% face_code_ref=Missing NodePath
  12[Wall]
    %% face_code_ref=Missing NodePath
  13[Wall]
    %% face_code_ref=Missing NodePath
  14["Cap Start"]
    %% face_code_ref=Missing NodePath
  15["Cap End"]
    %% face_code_ref=Missing NodePath
  16["SweepEdge Opposite"]
  17["SweepEdge Opposite"]
  18["SweepEdge Opposite"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 ---- 9
  3 --- 12
  3 x--> 14
  3 --- 16
  3 --- 20
  4 --- 11
  4 x--> 14
  4 --- 17
  4 --- 21
  5 --- 10
  5 x--> 14
  5 --- 18
  5 --- 22
  6 --- 13
  6 x--> 14
  6 --- 19
  6 --- 23
  9 --- 10
  9 --- 11
  9 --- 12
  9 --- 13
  9 --- 14
  9 --- 15
  9 --- 16
  9 --- 17
  9 --- 18
  9 --- 19
  9 --- 20
  9 --- 21
  9 --- 22
  9 --- 23
  10 --- 18
  21 <--x 10
  10 --- 22
  11 --- 17
  20 <--x 11
  11 --- 21
  12 --- 16
  12 --- 20
  23 <--x 12
  13 --- 19
  22 <--x 13
  13 --- 23
  16 <--x 15
  17 <--x 15
  18 <--x 15
  19 <--x 15
```
