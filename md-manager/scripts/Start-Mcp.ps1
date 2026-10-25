$ErrorActionPreference = 'Stop'
$pluginDirectory = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $pluginDirectory 'workbench.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$candidates = @($env:CODEX_NODE_PATH, (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $candidates += $nodeCommand.Source }
$nodeExecutable = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $nodeExecutable) { throw 'Node.js 24+ is required. Set CODEX_NODE_PATH to node.exe.' }
$nodeVersion = & $nodeExecutable --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24+ is required.' }
& $nodeExecutable (Join-Path $pluginDirectory 'runtime\mcp.mjs') --role $config.role
exit $LASTEXITCODE
