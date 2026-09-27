// Ohne Apple-Entwicklerkonto signiert electron-builder nicht (identity: null).
// Dann trägt nur die Electron-Binärdatei ihre Linker-Signatur, die nach dem
// Packen nicht mehr zum Bundle passt — macOS meldet die App als „beschädigt“.
// Deshalb hier das ganze Bundle ad-hoc signieren, bevor die .dmg entsteht.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
