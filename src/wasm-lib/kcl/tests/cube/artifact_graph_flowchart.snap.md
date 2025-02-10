```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[185, 202, 0]"]
    3["Segment<br>[210, 232, 0]"]
    4["Segment<br>[240, 262, 0]"]
    5["Segment<br>[270, 292, 0]"]
    6["Segment<br>[300, 322, 0]"]
    7["Segment<br>[330, 337, 0]"]
    8[Solid2d]
  end
  1["Plane<br>[185, 202, 0]"]
  9["Sweep Extrusion<br>[345, 373, 0]"]
  10["Cap End"]
  11["Cap End"]
  12["Cap End"]
  13["Cap End"]
  14["Cap Start"]
  15["Cap End"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 9
  2 --- 8
  3 x--> 13
  4 x--> 12
  5 x--> 11
  6 x--> 10
  9 --- 10
  9 --- 11
  9 --- 12
  9 --- 13
  9 --- 14
  9 --- 15
```
