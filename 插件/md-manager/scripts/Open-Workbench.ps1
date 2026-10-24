param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$pluginDirectory = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $pluginDirectory 'workbench.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $serverFile = Join-Path $pluginDirectory 'runtime\server.mjs'
    $role = $config.role
    $preferredPort = $config.preferredPort
} else {
    $serverFile = Join-Path $pluginDirectory 'dist\server.mjs'
    $role = 'both'
    $preferredPort = 39471
}
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) { throw 'Build output missing. Run the build first.' }
$candidates = @($env:CODEX_NODE_PATH, (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $candidates += $nodeCommand.Source }
$nodeExecutable = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $nodeExecutable) { throw 'Node.js 24+ is required. Set CODEX_NODE_PATH to node.exe.' }
if (-not $DataDirectory) { $DataDirectory = $env:CODEX_WORKBENCH_HOME }
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:USERPROFILE '.codex-md-workbenches' }
[IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
$localUrl = "http://127.0.0.1:$preferredPort"
try {
    $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 2
    if ($health.app -eq 'codex-workbenches' -and $health.role -eq $role) { Start-Process $localUrl; exit 0 }
} catch { }
$testListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$preferredPort)
try { $testListener.Start(); $selectedPort = $preferredPort } catch {
    $testListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $testListener.Start(); $selectedPort = $testListener.LocalEndpoint.Port
} finally { $testListener.Stop() }
$localUrl = "http://127.0.0.1:$selectedPort"
$outLog = Join-Path $DataDirectory "ui-$role-$selectedPort.log"
$errLog = Join-Path $DataDirectory "ui-$role-$selectedPort.err.log"
$arguments = @(('"' + $serverFile + '"'),'--role',$role,'--port',[string]$selectedPort,'--data-dir',('"' + $DataDirectory + '"'))
$process = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    if ($process.HasExited) { throw "Server stopped. See $errLog" }
    try { $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 1; if ($health.app -eq 'codex-workbenches') { Start-Process $localUrl; exit 0 } } catch { }
}
throw "Workbench did not become ready. See $errLog"
