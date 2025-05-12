```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[565, 614, 0]"]
    3["Segment<br>[620, 644, 0]"]
    4["Segment<br>[650, 688, 0]"]
    5["Segment<br>[694, 719, 0]"]
    6["Segment<br>[725, 764, 0]"]
    7["Segment<br>[770, 777, 0]"]
    8[Solid2d]
  end
  1["Plane<br>[542, 559, 0]"]
  9["Sweep Extrusion<br>[806, 924, 0]"]
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
  3 --- 13
  3 x--> 14
  3 --- 16
  3 --- 23
  4 --- 11
  4 x--> 14
  4 --- 19
  4 --- 22
  5 --- 10
  5 x--> 14
  5 --- 18
  5 --- 21
  6 --- 12
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
  19 <--x 11
  23 <--x 11
  17 <--x 12
  21 <--x 12
  16 <--x 13
  23 <--x 13
  16 <--x 15
  17 <--x 15
  18 <--x 15
  19 <--x 15
```
