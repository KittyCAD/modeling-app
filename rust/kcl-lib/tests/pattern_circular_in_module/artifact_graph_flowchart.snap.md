```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[63, 90, 1]"]
    3["Segment<br>[98, 116, 1]"]
    4["Segment<br>[124, 143, 1]"]
    5["Segment<br>[151, 170, 1]"]
    6["Segment<br>[178, 185, 1]"]
    7[Solid2d]
  end
  subgraph path27 [Path]
    27["Path<br>[63, 90, 1]"]
    28["Segment<br>[98, 116, 1]"]
    29["Segment<br>[124, 143, 1]"]
    30["Segment<br>[151, 170, 1]"]
    31["Segment<br>[178, 185, 1]"]
    32[Solid2d]
  end
  1["Plane<br>[38, 55, 1]"]
  8["Sweep Extrusion<br>[342, 376, 1]"]
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
  23["Sweep Extrusion<br>[342, 376, 1]"]
  24["Sweep Extrusion<br>[342, 376, 1]"]
  25["Sweep Extrusion<br>[342, 376, 1]"]
  26["Plane<br>[38, 55, 1]"]
  33["Sweep Extrusion<br>[342, 376, 1]"]
  34[Wall]
    %% face_code_ref=Missing NodePath
  35[Wall]
    %% face_code_ref=Missing NodePath
  36[Wall]
    %% face_code_ref=Missing NodePath
  37[Wall]
    %% face_code_ref=Missing NodePath
  38["Cap Start"]
    %% face_code_ref=Missing NodePath
  39["Cap End"]
    %% face_code_ref=Missing NodePath
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Opposite"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Opposite"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Opposite"]
  47["SweepEdge Adjacent"]
  48["Sweep Extrusion<br>[342, 376, 1]"]
  49["Sweep Extrusion<br>[342, 376, 1]"]
  50["Sweep Extrusion<br>[342, 376, 1]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
  3 --- 9
  3 x--> 13
  3 --- 15
  3 --- 16
  4 --- 10
  4 x--> 13
  4 --- 17
  4 --- 18
  5 --- 11
  5 x--> 13
  5 --- 19
  5 --- 20
  6 --- 12
  6 x--> 13
  6 --- 21
  6 --- 22
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
  9 --- 15
  9 --- 16
  22 <--x 9
  16 <--x 10
  10 --- 17
  10 --- 18
  18 <--x 11
  11 --- 19
  11 --- 20
  20 <--x 12
  12 --- 21
  12 --- 22
  15 <--x 14
  17 <--x 14
  19 <--x 14
  21 <--x 14
  26 --- 27
  27 --- 28
  27 --- 29
  27 --- 30
  27 --- 31
  27 --- 32
  27 ---- 33
  28 --- 34
  28 x--> 38
  28 --- 40
  28 --- 41
  29 --- 35
  29 x--> 38
  29 --- 42
  29 --- 43
  30 --- 36
  30 x--> 38
  30 --- 44
  30 --- 45
  31 --- 37
  31 x--> 38
  31 --- 46
  31 --- 47
  33 --- 34
  33 --- 35
  33 --- 36
  33 --- 37
  33 --- 38
  33 --- 39
  33 --- 40
  33 --- 41
  33 --- 42
  33 --- 43
  33 --- 44
  33 --- 45
  33 --- 46
  33 --- 47
  34 --- 40
  34 --- 41
  47 <--x 34
  41 <--x 35
  35 --- 42
  35 --- 43
  43 <--x 36
  36 --- 44
  36 --- 45
  45 <--x 37
  37 --- 46
  37 --- 47
  40 <--x 39
  42 <--x 39
  44 <--x 39
  46 <--x 39
```
