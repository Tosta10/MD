param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$pluginDirectory = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $pluginDirectory 'workbench.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $serverFile = Join-Path $pluginDirectory 'runtime\server.mjs'
    $role = $config.role
    $preferredPort = $config.preferredPort
    $requiredVersion = $config.version
} else {
    $serverFile = Join-Path $pluginDirectory 'dist\server.mjs'
    $role = 'both'
    $preferredPort = 39471
    $requiredVersion = (Get-Content -LiteralPath (Join-Path $pluginDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
}
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) { throw 'Build output missing. Run the build first.' }
$candidates = @($env:CODEX_NODE_PATH, (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $candidates += $nodeCommand.Source }
$nodeExecutable = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $nodeExecutable) { throw 'Node.js 24+ is required. Set CODEX_NODE_PATH to node.exe.' }
$nodeVersion = & $nodeExecutable --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24+ is required.' }
if (-not $DataDirectory) { $DataDirectory = $env:CODEX_WORKBENCH_HOME }
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:USERPROFILE '.codex-md-workbenches' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
[IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
$savedUiFile = Join-Path $DataDirectory "ui-$role.json"
if (Test-Path -LiteralPath $savedUiFile) {
    try {
        $savedUi = Get-Content -LiteralPath $savedUiFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($savedUi.url -match '^http://127\.0\.0\.1:\d+$') {
            $health = Invoke-RestMethod -Uri ($savedUi.url + '/health') -TimeoutSec 2
            if ($health.app -eq 'codex-workbenches' -and $health.role -eq $role -and $health.version -eq $requiredVersion -and $health.dataKey -eq $DataDirectory) { Start-Process $savedUi.url; exit 0 }
        }
    } catch { }
}
$localUrl = "http://127.0.0.1:$preferredPort"
try {
    $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 2
    if ($health.app -eq 'codex-workbenches' -and $health.role -eq $role -and $health.version -eq $requiredVersion -and $health.dataKey -eq $DataDirectory) { Start-Process $localUrl; exit 0 }
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
