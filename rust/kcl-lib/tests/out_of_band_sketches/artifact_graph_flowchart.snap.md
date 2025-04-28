```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[45, 90, 0]"]
    3["Segment<br>[167, 190, 0]"]
    4["Segment<br>[211, 239, 0]"]
    9["Segment<br>[549, 573, 0]"]
    10["Segment<br>[594, 601, 0]"]
    11[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[301, 345, 0]"]
    7["Segment<br>[422, 445, 0]"]
    8["Segment<br>[466, 495, 0]"]
    12["Segment<br>[649, 677, 0]"]
    13["Segment<br>[698, 705, 0]"]
    14[Solid2d]
  end
  1["Plane<br>[12, 31, 0]"]
  5["Plane<br>[268, 287, 0]"]
  15["Sweep Extrusion<br>[716, 781, 0]"]
  16[Wall]
  17[Wall]
  18[Wall]
  19[Wall]
  20["Cap Start"]
  21["Cap End"]
  22["SweepEdge Opposite"]
  23["SweepEdge Adjacent"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Opposite"]
  27["SweepEdge Adjacent"]
  28["SweepEdge Opposite"]
  29["SweepEdge Adjacent"]
  30["Sweep Extrusion<br>[716, 781, 0]"]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35["Cap Start"]
  36["Cap End"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 9
  2 --- 10
  2 ---- 15
  2 --- 11
  3 --- 19
  3 --- 28
  3 --- 29
  3 x--> 20
  4 --- 18
  4 --- 26
  4 --- 27
  4 x--> 20
  5 --- 6
  6 --- 7
  6 --- 8
  6 --- 12
  6 --- 13
  6 ---- 30
  6 --- 14
  7 --- 34
  7 --- 43
  7 --- 44
  7 x--> 35
  8 --- 33
  8 --- 41
  8 --- 42
  8 x--> 35
  9 --- 17
  9 --- 24
  9 --- 25
  9 x--> 20
  10 --- 16
  10 --- 22
  10 --- 23
  10 x--> 20
  12 --- 32
  12 --- 39
  12 --- 40
  12 x--> 35
  13 --- 31
  13 --- 37
  13 --- 38
  13 x--> 35
  15 --- 16
  15 --- 17
  15 --- 18
  15 --- 19
  15 --- 20
  15 --- 21
  15 --- 22
  15 --- 23
  15 --- 24
  15 --- 25
  15 --- 26
  15 --- 27
  15 --- 28
  15 --- 29
  22 <--x 16
  22 <--x 21
  23 <--x 16
  23 <--x 19
  24 <--x 17
  24 <--x 21
  25 <--x 16
  25 <--x 17
  26 <--x 18
  26 <--x 21
  27 <--x 17
  27 <--x 18
  28 <--x 19
  28 <--x 21
  29 <--x 18
  29 <--x 19
  30 --- 31
  30 --- 32
  30 --- 33
  30 --- 34
  30 --- 35
  30 --- 36
  30 --- 37
  30 --- 38
  30 --- 39
  30 --- 40
  30 --- 41
  30 --- 42
  30 --- 43
  30 --- 44
  37 <--x 31
  37 <--x 36
  38 <--x 31
  38 <--x 34
  39 <--x 32
  39 <--x 36
  40 <--x 31
  40 <--x 32
  41 <--x 33
  41 <--x 36
  42 <--x 32
  42 <--x 33
  43 <--x 34
  43 <--x 36
  44 <--x 33
  44 <--x 34
```
