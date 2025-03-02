```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[405, 441, 0]"]
    3["Segment<br>[447, 468, 0]"]
    4["Segment<br>[474, 498, 0]"]
    5["Segment<br>[504, 531, 0]"]
    6["Segment<br>[537, 550, 0]"]
  end
  1["Plane<br>[379, 399, 0]"]
  7["Sweep Extrusion<br>[622, 650, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 7
```
