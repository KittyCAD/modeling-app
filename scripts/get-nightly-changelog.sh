#!/bin/bash
echo "## What's Changed"
git log ${PREVIOUS_TAG}..HEAD --oneline --pretty=format:%s | grep -v Bump | awk '{print "* "toupper(substr($0,0,1))substr($0,2)}'
echo ""
echo "**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/${PREVIOUS_TAG}...${TAG}"
