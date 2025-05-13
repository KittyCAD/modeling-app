```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[80, 105, 1]"]
      %% Missing NodePath
    3["Segment<br>[111, 128, 1]"]
      %% Missing NodePath
    4["Segment<br>[134, 151, 1]"]
      %% Missing NodePath
    5["Segment<br>[157, 175, 1]"]
      %% Missing NodePath
    6["Segment<br>[181, 199, 1]"]
      %% Missing NodePath
    7["Segment<br>[205, 213, 1]"]
      %% Missing NodePath
    8[Solid2d]
  end
  1["Plane<br>[57, 74, 1]"]
    %% Missing NodePath
  9["Sweep Extrusion<br>[219, 238, 1]"]
    %% Missing NodePath
  10[Wall]
  11[Wall]
  12[Wall]
  13[Wall]
  14["Cap Start"]
  15["Cap End"]
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
  3 --- 19
  3 --- 23
  4 --- 11
  4 x--> 14
  4 --- 16
  4 --- 21
  5 --- 10
  5 x--> 14
  5 --- 18
  5 --- 22
  6 --- 13
  6 x--> 14
  6 --- 17
  6 --- 20
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
  18 <--x 10
  21 <--x 10
  22 <--x 10
  16 <--x 11
  21 <--x 11
  23 <--x 11
  19 <--x 12
  20 <--x 12
  23 <--x 12
  17 <--x 13
  20 <--x 13
  22 <--x 13
  16 <--x 15
  17 <--x 15
  18 <--x 15
  19 <--x 15
```
