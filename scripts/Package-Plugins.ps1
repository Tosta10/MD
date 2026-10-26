$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$packageDirectory = Join-Path $sourceRoot 'packages'
[IO.Directory]::CreateDirectory($packageDirectory) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$results = @()
foreach ($pluginName in @('md-manager','insight-workbench')) {
    $pluginDirectory = (Resolve-Path -LiteralPath (Join-Path $sourceRoot $pluginName)).Path
    $manifest = Get-Content -LiteralPath (Join-Path $pluginDirectory 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.version -ne $packageVersion) { throw 'Build before packaging.' }
    $archivePath = Join-Path $packageDirectory "$pluginName-$packageVersion.zip"
    if (Test-Path -LiteralPath $archivePath) {
        $previousDirectory = Join-Path $packageDirectory 'previous'
        [IO.Directory]::CreateDirectory($previousDirectory) | Out-Null
        $previousPath = Join-Path $previousDirectory "$pluginName-$packageVersion-$(Get-Date -Format yyyyMMddHHmmssfff).zip"
        Move-Item -LiteralPath $archivePath -Destination $previousPath
    }
    [IO.Compression.ZipFile]::CreateFromDirectory($pluginDirectory,$archivePath)
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\','/') })
        foreach ($entry in @('plugin.json','mcp.json','.codex-plugin/plugin.json','.mcp.json','runtime/mcp.mjs','runtime/server.mjs','runtime/image-worker.mjs','mcp.portable.json','public/next-ui.js','public/markdown.js','public/app-v2.js','public/workbench.css',"skills/$pluginName/SKILL.md",'THIRD-PARTY-NOTICES.txt')) {
            if ($entries -notcontains $entry) { throw "Missing archive entry: $entry" }
        }
    } finally { $archive.Dispose() }
    $results += [pscustomobject]@{name=$pluginName;version=$packageVersion;archive=$archivePath;bytes=(Get-Item -LiteralPath $archivePath).Length;sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $packageDirectory "checksums-$packageVersion.json") -Encoding UTF8
$results | ConvertTo-Json -Depth 4
