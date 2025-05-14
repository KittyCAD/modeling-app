```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[251, 276, 0]"]
    3["Segment<br>[282, 303, 0]"]
    4["Segment<br>[309, 330, 0]"]
    5["Segment<br>[336, 363, 0]"]
    6["Segment<br>[369, 403, 0]"]
    7["Segment<br>[409, 443, 0]"]
    8["Segment<br>[449, 457, 0]"]
    9[Solid2d]
  end
  1["Plane<br>[228, 245, 0]"]
  10["Sweep Extrusion<br>[463, 486, 0]"]
  11[Wall]
  12[Wall]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17["Cap Start"]
  18["Cap End"]
  19["SweepEdge Opposite"]
  20["SweepEdge Opposite"]
  21["SweepEdge Opposite"]
  22["SweepEdge Opposite"]
  23["SweepEdge Opposite"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Adjacent"]
  28["SweepEdge Adjacent"]
  29["SweepEdge Adjacent"]
  30["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 ---- 10
  3 --- 16
  3 x--> 17
  3 --- 24
  3 --- 30
  4 --- 14
  4 x--> 17
  4 --- 23
  4 --- 29
  5 --- 13
  5 x--> 17
  5 --- 22
  5 --- 28
  6 --- 15
  6 x--> 17
  6 --- 21
  6 --- 27
  7 --- 12
  7 x--> 17
  7 --- 20
  7 --- 26
  8 --- 11
  8 x--> 17
  8 --- 19
  8 --- 25
  10 --- 11
  10 --- 12
  10 --- 13
  10 --- 14
  10 --- 15
  10 --- 16
  10 --- 17
  10 --- 18
  10 --- 19
  10 --- 20
  10 --- 21
  10 --- 22
  10 --- 23
  10 --- 24
  10 --- 25
  10 --- 26
  10 --- 27
  10 --- 28
  10 --- 29
  10 --- 30
  11 --- 19
  11 --- 25
  26 <--x 11
  12 --- 20
  12 --- 26
  27 <--x 12
  13 --- 22
  13 --- 28
  29 <--x 13
  14 --- 23
  14 --- 29
  30 <--x 14
  15 --- 21
  15 --- 27
  28 <--x 15
  16 --- 24
  25 <--x 16
  16 --- 30
  19 <--x 18
  20 <--x 18
  21 <--x 18
  22 <--x 18
  23 <--x 18
  24 <--x 18
```
