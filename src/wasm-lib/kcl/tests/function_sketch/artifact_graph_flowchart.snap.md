```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[55, 80, 0]"]
    3["Segment<br>[88, 106, 0]"]
    4["Segment<br>[114, 132, 0]"]
    5["Segment<br>[140, 159, 0]"]
    6["Segment<br>[167, 175, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[28, 47, 0]"]
  8["Sweep Extrusion<br>[183, 202, 0]"]
  9["Cap End"]
  10["Cap End"]
  11["Cap End"]
  12["Cap End"]
  13["Cap Start"]
  14["Cap End"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 x--> 12
  4 x--> 11
  5 x--> 10
  6 x--> 9
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
```
