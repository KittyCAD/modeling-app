'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const esbuild = require('esbuild')

async function build() {
  const artifact = path.resolve(process.argv[2] || '.vite/renderer/main_window')
  const output = path.resolve(
    process.argv[3] || 'test-results/palette-reduction-build'
  )
  const fixturePath = path.join(__dirname, 'home-presentation.json')
  const fixtureBytes = fs.readFileSync(fixturePath)
  const fixture = JSON.parse(fixtureBytes)
  if (!fixture.provenance || fixture.panel?.children?.length !== 3) {
    throw new Error(
      'Expected a captured Home palette fixture with provenance and three panel children.'
    )
  }
  const originalHtml = fs.readFileSync(
    path.join(artifact, 'index.html'),
    'utf8'
  )
  const stylesheets = [
    ...originalHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g),
  ].map(([tag]) => /href="([^"]+)"/.exec(tag)?.[1])
  if (
    stylesheets.length < 3 ||
    stylesheets.some((href) => !href || !href.startsWith('./'))
  ) {
    throw new Error('Expected local application CSS and font stylesheets.')
  }
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(path.join(output, 'assets'), { recursive: true })
  for (const file of fs.readdirSync(path.join(artifact, 'assets'))) {
    if (/\.(css|svg|png|jpe?g|webp|woff2?|ttf|otf)$/.test(file)) {
      fs.copyFileSync(
        path.join(artifact, 'assets', file),
        path.join(output, 'assets', file)
      )
    }
  }
  fs.cpSync(path.join(artifact, 'fonts'), path.join(output, 'fonts'), {
    recursive: true,
  })
  const digest = (value) =>
    crypto.createHash('sha256').update(value).digest('hex')
  const packageVersion = (name) =>
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../node_modules', name, 'package.json'),
        'utf8'
      )
    ).version
  const metadata = {
    sourceBuildRun: fixture.sourceBuildRun,
    sourceCommit: fixture.sourceCommit,
    provenance: fixture.provenance,
    sourceHtmlSha256: digest(originalHtml),
    sourceRendererScripts: [
      ...originalHtml.matchAll(/<script\b[^>]*src="(\.\/assets\/[^"\s]+)"/g),
    ].map(([, source]) => ({
      source,
      sha256: digest(fs.readFileSync(path.join(artifact, source))),
    })),
    presentationSha256: digest(fixtureBytes),
    stylesheets: stylesheets.map((href) => ({
      href,
      sha256: digest(fs.readFileSync(path.join(artifact, href))),
    })),
    capturedAssets: fixture.assets,
    fonts: fs
      .readdirSync(path.join(artifact, 'fonts'), { recursive: true })
      .filter((name) => /\.(woff2?|ttf|otf)$/.test(name))
      .sort()
      .map((name) => ({
        path: `fonts/${name}`,
        sha256: digest(fs.readFileSync(path.join(artifact, 'fonts', name))),
      })),
    react: packageVersion('react'),
    headlessui: packageVersion('@headlessui/react'),
    electron: packageVersion('electron'),
    limitations:
      'Standalone presentation reduction. Zoo Home background and business logic are absent. A passing reduction does not establish an application fix.',
  }
  const assetMatch = {
    stylesheets:
      JSON.stringify(metadata.stylesheets.map(({ sha256 }) => sha256)) ===
      JSON.stringify(fixture.assets?.stylesheets.map(({ sha256 }) => sha256)),
    fonts:
      JSON.stringify(metadata.fonts) === JSON.stringify(fixture.assets?.fonts),
  }
  fs.writeFileSync(
    path.join(output, 'metadata.json'),
    JSON.stringify({ ...metadata, assetMatch }, null, 2)
  )
  if (!assetMatch.stylesheets || !assetMatch.fonts) {
    throw new Error(
      'Capture/build CSS or font mismatch; see metadata.json. Reduction timings would not have verified presentation fidelity.'
    )
  }
  await esbuild.build({
    absWorkingDir: path.resolve(__dirname, '../../..'),
    entryPoints: [path.join(__dirname, 'renderer.tsx')],
    outfile: path.join(output, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      PALETTE_PRESENTATION: JSON.stringify(fixture),
    },
  })
  fs.copyFileSync(
    path.join(__dirname, 'main.cjs'),
    path.join(output, 'main.cjs')
  )
  fs.writeFileSync(
    path.join(output, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
<title>Palette presentation reduction</title></head>
<body class="body-bg"><div id="root" class="h-screen overflow-y-auto"></div>
<script type="module" src="./renderer.js"></script></body></html>`
  )
  console.log(
    JSON.stringify({
      output,
      assetMatch,
      electron: metadata.electron,
      provenance: metadata.provenance,
    })
  )
}

build().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
