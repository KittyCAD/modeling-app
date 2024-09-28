---
title: "ShellData"
excerpt: "Data for shells."
layout: manual
---

Data for shells.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `thickness` |`number`| The thickness of the shell. | No |
| `faces` |`[` **anyOf:** **oneOf:** enum: `start` **OR** enum: `end` **OR** [`TagIdentifier`](/docs/kcl/types#tag-identifier) `]`| The faces you want removed. | No |


