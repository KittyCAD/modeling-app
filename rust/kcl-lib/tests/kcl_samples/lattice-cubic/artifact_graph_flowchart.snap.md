```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[749, 1208, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[777, 836, 0]"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    4["Segment<br>[846, 933, 0]"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path5 [Path]
    5["Path Region<br>[1222, 1260, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    6["Segment<br>[1222, 1260, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    7["Segment<br>[1222, 1260, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path50 [Path]
    50["Path<br>[1970, 2189, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    51["Segment<br>[2012, 2077, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path52 [Path]
    52["Path Region<br>[2203, 2243, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    53["Segment<br>[2203, 2243, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path89 [Path]
    89["Path Region<br>[2749, 2768, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    90["Segment<br>[2749, 2768, 0]"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  subgraph path125 [Path]
    125["Path Region<br>[3153, 3172, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    126["Segment<br>[3153, 3172, 0]"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  1["Plane<br>[749, 1208, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  8["Sweep Revolve<br>[1279, 1324, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  9[Wall]
    %% face_code_ref=Missing NodePath
  10["Pattern Transform<br>[1440, 1557, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  11["PrimitiveFace<br>[1440, 1557, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  12["PrimitiveFace<br>[1440, 1557, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  13["Pattern Transform<br>[1584, 1704, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  14["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  15["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  16["Pattern Transform<br>[1584, 1704, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  17["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  18["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  19["Pattern Transform<br>[1584, 1704, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  20["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  21["PrimitiveFace<br>[1584, 1704, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  22["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  23["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  24["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  25["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  26["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  27["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  28["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  29["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  30["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  33["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  34["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  35["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  36["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  37["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  38["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  39["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  40["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  41["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  42["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  43["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  44["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  45["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  46["Pattern Transform<br>[1736, 1861, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  47["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  48["PrimitiveFace<br>[1736, 1861, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  49["Plane<br>[1914, 1955, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  54["Sweep Extrusion<br>[2259, 2307, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  55[Wall]
    %% face_code_ref=Missing NodePath
  56["Cap Start"]
    %% face_code_ref=Missing NodePath
  57["Cap End"]
    %% face_code_ref=Missing NodePath
  58["SweepEdge Opposite"]
  59["SweepEdge Adjacent"]
  60["Pattern Transform<br>[2461, 2575, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  61["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  62["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  63["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  64["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  65["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  66["PrimitiveFace<br>[2461, 2575, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  67["Pattern Transform<br>[2607, 2732, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  68["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  69["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  70["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  71["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  72["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  73["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  74["Pattern Transform<br>[2607, 2732, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  75["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  76["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  77["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  78["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  79["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  80["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  81["Pattern Transform<br>[2607, 2732, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  82["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  83["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  84["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  85["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  86["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  87["PrimitiveFace<br>[2607, 2732, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  88["Sweep Extrusion<br>[2749, 2768, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  91[Wall]
    %% face_code_ref=Missing NodePath
  92["Cap Start"]
    %% face_code_ref=Missing NodePath
  93["Cap End"]
    %% face_code_ref=Missing NodePath
  94["SweepEdge Opposite"]
  95["SweepEdge Adjacent"]
  96["Pattern Transform<br>[2883, 2997, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  97["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  98["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  99["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  100["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  101["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  102["PrimitiveFace<br>[2883, 2997, 0]"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  103["Pattern Transform<br>[3011, 3136, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  104["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  105["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  106["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  107["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  108["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  109["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  110["Pattern Transform<br>[3011, 3136, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  111["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  112["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  113["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  114["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  115["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  116["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  117["Pattern Transform<br>[3011, 3136, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  118["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  119["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  120["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  121["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  122["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  123["PrimitiveFace<br>[3011, 3136, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  124["Sweep Extrusion<br>[3153, 3172, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  127[Wall]
    %% face_code_ref=Missing NodePath
  128["Cap Start"]
    %% face_code_ref=Missing NodePath
  129["Cap End"]
    %% face_code_ref=Missing NodePath
  130["SweepEdge Opposite"]
  131["SweepEdge Adjacent"]
  132["Pattern Transform<br>[3302, 3416, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  133["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  134["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  135["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  136["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  137["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  138["PrimitiveFace<br>[3302, 3416, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  139["Pattern Transform<br>[3430, 3564, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  140["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  141["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  142["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  143["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  144["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  145["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  146["Pattern Transform<br>[3430, 3564, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  147["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  148["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  149["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  150["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  151["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  152["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  153["Pattern Transform<br>[3430, 3564, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  154["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  155["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  156["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  157["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  158["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  159["PrimitiveFace<br>[3430, 3564, 0]"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  160["SketchBlock<br>[749, 1208, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  161["SketchBlockConstraint Coincident<br>[936, 971, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  162["SketchBlockConstraint Coincident<br>[974, 1009, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  163["SketchBlockConstraint Coincident<br>[1012, 1045, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  164["SketchBlockConstraint Coincident<br>[1048, 1080, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  165["SketchBlockConstraint Vertical<br>[1083, 1098, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  166["SketchBlockConstraint Distance<br>[1101, 1165, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  167["SketchBlockConstraint Radius<br>[1168, 1206, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  168["SketchBlock<br>[1970, 2189, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  169["SketchBlockConstraint Coincident<br>[2080, 2116, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  170["SketchBlockConstraint Distance<br>[2119, 2187, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 5
  1 <--x 160
  2 --- 3
  2 --- 4
  2 <--x 5
  160 --- 2
  3 <--x 6
  4 <--x 7
  5 --- 6
  5 --- 7
  5 ---- 8
  5 --- 10
  5 --- 13
  5 --- 22
  8 <--x 7
  7 --- 9
  8 --- 9
  8 x--> 10
  8 x--> 13
  8 x--> 22
  10 x--> 11
  10 x--> 12
  13 x--> 14
  13 x--> 15
  16 x--> 17
  16 x--> 18
  19 x--> 20
  19 x--> 21
  22 x--> 23
  22 x--> 24
  25 x--> 26
  25 x--> 27
  28 x--> 29
  28 x--> 30
  31 x--> 32
  31 x--> 33
  34 x--> 35
  34 x--> 36
  37 x--> 38
  37 x--> 39
  40 x--> 41
  40 x--> 42
  43 x--> 44
  43 x--> 45
  46 x--> 47
  46 x--> 48
  49 --- 50
  49 <--x 52
  49 <--x 89
  49 <--x 125
  49 <--x 168
  50 --- 51
  50 <--x 52
  50 <--x 89
  50 <--x 125
  168 --- 50
  51 <--x 53
  51 <--x 90
  51 <--x 126
  52 --- 53
  52 ---- 54
  52 --- 60
  52 --- 67
  53 --- 55
  53 x--> 57
  53 --- 58
  53 --- 59
  54 --- 55
  54 --- 56
  54 --- 57
  54 --- 58
  54 --- 59
  54 x--> 60
  54 x--> 67
  55 --- 58
  55 --- 59
  58 <--x 56
  60 x--> 61
  60 x--> 62
  60 x--> 63
  60 x--> 64
  60 x--> 65
  60 x--> 66
  67 x--> 68
  67 x--> 69
  67 x--> 70
  67 x--> 71
  67 x--> 72
  67 x--> 73
  74 x--> 75
  74 x--> 76
  74 x--> 77
  74 x--> 78
  74 x--> 79
  74 x--> 80
  81 x--> 82
  81 x--> 83
  81 x--> 84
  81 x--> 85
  81 x--> 86
  81 x--> 87
  89 ---- 88
  88 --- 91
  88 --- 92
  88 --- 93
  88 --- 94
  88 --- 95
  88 x--> 96
  88 x--> 103
  89 --- 90
  89 --- 96
  89 --- 103
  90 --- 91
  90 x--> 93
  90 --- 94
  90 --- 95
  91 --- 94
  91 --- 95
  94 <--x 92
  96 x--> 97
  96 x--> 98
  96 x--> 99
  96 x--> 100
  96 x--> 101
  96 x--> 102
  103 x--> 104
  103 x--> 105
  103 x--> 106
  103 x--> 107
  103 x--> 108
  103 x--> 109
  110 x--> 111
  110 x--> 112
  110 x--> 113
  110 x--> 114
  110 x--> 115
  110 x--> 116
  117 x--> 118
  117 x--> 119
  117 x--> 120
  117 x--> 121
  117 x--> 122
  117 x--> 123
  125 ---- 124
  124 --- 127
  124 --- 128
  124 --- 129
  124 --- 130
  124 --- 131
  124 x--> 132
  124 x--> 139
  125 --- 126
  125 --- 132
  125 --- 139
  126 --- 127
  126 x--> 129
  126 --- 130
  126 --- 131
  127 --- 130
  127 --- 131
  130 <--x 128
  132 x--> 133
  132 x--> 134
  132 x--> 135
  132 x--> 136
  132 x--> 137
  132 x--> 138
  139 x--> 140
  139 x--> 141
  139 x--> 142
  139 x--> 143
  139 x--> 144
  139 x--> 145
  146 x--> 147
  146 x--> 148
  146 x--> 149
  146 x--> 150
  146 x--> 151
  146 x--> 152
  153 x--> 154
  153 x--> 155
  153 x--> 156
  153 x--> 157
  153 x--> 158
  153 x--> 159
```
