git add src/lang/std/artifactMapGraphs
if git status src/lang/std/artifactMapGraphs | grep -q "Changes to be committed"
then echo "modified=true"
else echo "modified=false"
fi