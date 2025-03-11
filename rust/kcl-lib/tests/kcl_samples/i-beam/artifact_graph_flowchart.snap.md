```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[405, 441, 0]"]
    3["Segment<br>[447, 474, 0]"]
    4["Segment<br>[480, 510, 0]"]
    5["Segment<br>[516, 552, 0]"]
    6["Segment<br>[558, 580, 0]"]
  end
  1["Plane<br>[379, 399, 0]"]
  7["Sweep Extrusion<br>[652, 680, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 7
```
