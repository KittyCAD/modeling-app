```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[43, 82, 0]"]
    3["Segment<br>[88, 112, 0]"]
    4["Segment<br>[118, 224, 0]"]
    5["Segment<br>[230, 307, 0]"]
  end
  1["Plane<br>[12, 29, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
```
