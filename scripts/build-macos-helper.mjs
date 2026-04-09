import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const sourceFile = path.join(rootDir, 'helper', 'macos', 'NotifyNativeHelper.swift')
const appDir = path.join(rootDir, 'vendor', 'macos', 'NotifyNativeHelper.app')
const contentsDir = path.join(appDir, 'Contents')
const macOsDir = path.join(contentsDir, 'MacOS')
const resourcesDir = path.join(contentsDir, 'Resources')
const executablePath = path.join(macOsDir, 'NotifyNativeHelper')

if (process.platform !== 'darwin') process.exit(0)

if (!existsSync(sourceFile)) {
  throw new Error(`missing helper source: ${sourceFile}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.status === 0) return result.stdout.trim()
  const stderr = (result.stderr || '').trim()
  const stdout = (result.stdout || '').trim()
  const detail = stderr || stdout || `exit code ${result.status ?? 'unknown'}`
  throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  return result.status === 0
}

function compileSingleArch({ swiftc, sdkPath, arch, outputPath }) {
  const target = `${arch}-apple-macos13.0`
  run(swiftc, [
    '-parse-as-library',
    '-target',
    target,
    '-sdk',
    sdkPath,
    '-O',
    sourceFile,
    '-o',
    outputPath,
  ])
}

function buildExecutable() {
  const swiftc = run('xcrun', ['--sdk', 'macosx', '--find', 'swiftc'])
  const sdkPath = run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'])
  const arm64Path = path.join(macOsDir, 'NotifyNativeHelper-arm64')
  const x64Path = path.join(macOsDir, 'NotifyNativeHelper-x86_64')

  try {
    compileSingleArch({ swiftc, sdkPath, arch: 'arm64', outputPath: arm64Path })
    compileSingleArch({ swiftc, sdkPath, arch: 'x86_64', outputPath: x64Path })
    run('xcrun', ['lipo', '-create', '-output', executablePath, arm64Path, x64Path])
    rmSync(arm64Path, { force: true })
    rmSync(x64Path, { force: true })
    return
  } catch (error) {
    rmSync(arm64Path, { force: true })
    rmSync(x64Path, { force: true })
    const nativeArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
    console.warn(
      `[notify-native] Falling back to single-arch helper build (${nativeArch}): ${error instanceof Error ? error.message : String(error)}`,
    )
    compileSingleArch({ swiftc, sdkPath, arch: nativeArch, outputPath: executablePath })
  }
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>NotifyNativeHelper</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.xihuai18.opencode-notify-native.helper</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>OpenCode Notify Native</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
`

rmSync(appDir, { recursive: true, force: true })
mkdirSync(macOsDir, { recursive: true })
mkdirSync(resourcesDir, { recursive: true })
writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8')

buildExecutable()
chmodSync(executablePath, 0o755)

if (!tryRun('codesign', ['--force', '--deep', '--sign', '-', appDir])) {
  console.warn('[notify-native] Unable to ad-hoc sign NotifyNativeHelper.app')
}
