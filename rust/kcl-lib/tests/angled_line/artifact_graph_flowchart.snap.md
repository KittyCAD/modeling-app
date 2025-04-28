```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[35, 67, 0]"]
    3["Segment<br>[73, 97, 0]"]
    4["Segment<br>[103, 142, 0]"]
    5["Segment<br>[148, 174, 0]"]
    6["Segment<br>[180, 229, 0]"]
    7["Segment<br>[235, 262, 0]"]
    8["Segment<br>[268, 275, 0]"]
    9[Solid2d]
  end
  1["Plane<br>[10, 29, 0]"]
  10["Sweep Extrusion<br>[281, 300, 0]"]
  11[Wall]
  12[Wall]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17["Cap Start"]
  18["Cap End"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Opposite"]
  24["SweepEdge Adjacent"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Opposite"]
  28["SweepEdge Adjacent"]
  29["SweepEdge Opposite"]
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
  3 --- 29
  3 --- 30
  4 --- 14
  4 x--> 17
  4 --- 25
  4 --- 26
  5 --- 13
  5 x--> 17
  5 --- 23
  5 --- 24
  6 --- 15
  6 x--> 17
  6 --- 27
  6 --- 28
  7 --- 12
  7 x--> 17
  7 --- 21
  7 --- 22
  8 --- 11
  8 x--> 17
  8 --- 19
  8 --- 20
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
  19 <--x 11
  20 <--x 11
  22 <--x 11
  21 <--x 12
  22 <--x 12
  28 <--x 12
  23 <--x 13
  24 <--x 13
  26 <--x 13
  25 <--x 14
  26 <--x 14
  30 <--x 14
  24 <--x 15
  27 <--x 15
  28 <--x 15
  20 <--x 16
  29 <--x 16
  30 <--x 16
  19 <--x 18
  21 <--x 18
  23 <--x 18
  25 <--x 18
  27 <--x 18
  29 <--x 18
```
