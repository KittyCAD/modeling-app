from pyorigami import (
    ArrowHead, Caption, Diagram, DiagramHeader, SimpleArrow,
    Square, Step, Title, ValleyFold,
)

diagram = Diagram(
    header=DiagramHeader(body=[Title("Two diagonal creases")]),
    body=[
        Step(body=[
            Square("a", "b", "c", "d"),
            ValleyFold("a", "c"),
            SimpleArrow("b", "d", ArrowHead.UNFOLD, ArrowHead.VALLEY),
            Caption("Fold and unfold the first diagonal."),
        ]),
        Step(body=[
            Square("a", "b", "c", "d"),
            ValleyFold("b", "d"),
            SimpleArrow("a", "c", ArrowHead.UNFOLD, ArrowHead.VALLEY),
            Caption("Fold and unfold the other diagonal."),
        ]),
    ],
)
