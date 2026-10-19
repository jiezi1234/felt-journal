param([string]$DevTools = 'D:\Tools\wxchat_devtools\sdk\微信web开发者工具')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$compilerRoot = Join-Path $DevTools 'resources\app.asar.unpacked\node_modules\wcc-exec'
$wcc = Join-Path $compilerRoot 'wcc.exe'
$wcsc = Join-Path $compilerRoot 'wcsc.exe'
if (!(Test-Path -LiteralPath $wcc) -or !(Test-Path -LiteralPath $wcsc)) { throw '找不到微信编译器，请传入 -DevTools 开发者工具安装目录' }
$artifactRoot = Join-Path $projectRoot 'artifacts\compile'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$routes = (Get-Content -LiteralPath (Join-Path $projectRoot 'miniprogram\app.json') -Raw | ConvertFrom-Json).pages
$sources = @($routes)
$sources += @('components/felt-board/index','components/photo-panel/index','components/felt-swatch/index','components/main-nav/index','components/record-card/index','components/day-board-card/index','components/memory-card/index','components/sticker-flight/index','custom-tab-bar/index')
$wxml = @($sources | ForEach-Object { "$_.wxml" })
$wxml += @('board-content','board-drawers','themes-content','theme-form') | ForEach-Object { "templates/$_.wxml" }
Push-Location (Join-Path $projectRoot 'miniprogram')
try {
& $wcc -o (Join-Path $artifactRoot 'wxml.js') @wxml
if ($LASTEXITCODE -ne 0) { throw 'WXML 编译失败' }
$css = @('app.wxss') + @($sources | ForEach-Object { "$_.wxss" })
$sharedStyles = @('styles/board-editor.wxss')
for ($i = 0; $i -lt $css.Count; $i++) {
  $imports = @($css + $sharedStyles | Where-Object { $_ -ne $css[$i] })
  & $wcsc -o (Join-Path $artifactRoot "wxss-$i.js") $css[$i] @imports
  if ($LASTEXITCODE -ne 0) { throw "WXSS 编译失败: $($css[$i])" }
}
Write-Output "PASS: $($wxml.Count) WXML 模板与 $($css.Count) WXSS 样式经微信官方编译器编译通过"
} finally { Pop-Location }
