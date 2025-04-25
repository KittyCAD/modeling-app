const fs = require('fs')
const latestRun = fs.readFileSync('/tmp/circular-deps.txt','utf-8')
const knownCircular = fs.readFileSync('./known-circular.txt','utf-8')

function parseLine (line) {
  let num = null
  let depPath = null
  const res = line.split(")",2)
  if (res.length === 2) {
    // should be a dep line
    num = parseInt(res[0])
    depPath = res[1]
  }
  return {
    num,
    depPath
  }
}

function makeDependencyHash (file) {
  const deps = {}
  file.split("\n").forEach((line)=>{
    const {num, depPath} = parseLine(line)
    if (depPath && !isNaN(num)) {
      deps[depPath] = 1
    }
  })
  return deps
}

const latestRunDepHash = makeDependencyHash(latestRun)
const knownDepHash = makeDependencyHash(knownCircular)

const dup1 = JSON.parse(JSON.stringify(latestRunDepHash))
const dup2 = JSON.parse(JSON.stringify(knownDepHash))
Object.keys(knownDepHash).forEach((key)=>{
  delete dup1[key]
})

Object.keys(latestRunDepHash).forEach((key)=>{
  delete dup2[key]
})

console.log(" ")
console.log("diff.js - line item diff")
console.log(" ")
console.log("Added(+)")
Object.keys(dup1).forEach((dep, index)=>{
  console.log(`${index+1}) ${dep}`)
})

console.log(" ")
console.log("Removed(-)")
if (Object.keys(dup2).length === 0) {
  console.log("None")
}
Object.keys(dup2).forEach((dep, index)=>{
  console.log(`${index+1}) ${dep}`)
})
