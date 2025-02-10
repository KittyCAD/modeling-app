```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[61, 104, 1]"]
    3["Segment<br>[61, 104, 1]"]
    4[Solid2d]
  end
  1["Plane<br>[36, 55, 1]"]
  5["Sweep Extrusion<br>[110, 130, 1]"]
  6["Cap End"]
  7["Cap Start"]
  8["Cap End"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 x--> 6
  5 --- 6
  5 --- 7
  5 --- 8
```
