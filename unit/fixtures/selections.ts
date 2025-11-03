import { Selections } from "@src/machines/modelingSharedTypes";

export const oneCap : Selections = {
    "graphSelections": [
        {
            "artifact": {
                "type": "cap",
                "id": "f60df527-1928-55b5-a970-81b21b875fc1",
                "subType": "end",
                "edgeCutEdgeIds": [],
                "sweepId": "523b9fc1-d681-5ef3-b407-128525533bfe",
                "pathIds": [],
                "faceCodeRef": {
                    "range": [
                        0,
                        0,
                        0
                    ],
                    "nodePath": {
                        "steps": []
                    },
                    "pathToNode": []
                },
                "cmdId": "f5cca6d8-813c-5e62-81d9-e4e8e17ede93"
            },
            "codeRef": {
                "range": [
                    170,
                    211,
                    0
                ],
                "nodePath": {
                    "steps": [
                        {
                            "type": "ProgramBodyItem",
                            "index": 3
                        },
                        {
                            "type": "VariableDeclarationDeclaration"
                        },
                        {
                            "type": "VariableDeclarationInit"
                        },
                        {
                            "type": "PipeBodyItem",
                            "index": 0
                        }
                    ]
                },
                "pathToNode": [
                    [
                        "body",
                        ""
                    ],
                    [
                        3,
                        "index"
                    ],
                    [
                        "declaration",
                        "VariableDeclaration"
                    ],
                    [
                        "init",
                        ""
                    ],
                    [
                        "body",
                        "PipeExpression"
                    ],
                    [
                        0,
                        "index"
                    ]
                ]
            }
        }
    ],
    "otherSelections": []
}
