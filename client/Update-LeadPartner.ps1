param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$exitCode = 0
$result = $null
try {
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot 'config.json' }
    . (Join-Path $PSScriptRoot 'Updater.Core.ps1')
    $result = Invoke-LeadPartnerUpdate -ConfigPath $ConfigPath
    if ($result.status -eq 'error') { $exitCode = 1 }
} catch {
    $exitCode = 1
    $result = [pscustomobject]@{status='error';currentVersion=$null;version=$null;message=$_.Exception.Message}
}
try {
    $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ConfigPath))
    Assert-LpNoReparse $directory
    $statusPath = Join-Path $directory 'status.json'
    Assert-LpNoReparse $statusPath
    Write-LpJson $statusPath @{checkedAt=[DateTime]::UtcNow.ToString('o');result=$result}
    $logPath = Join-Path $directory 'updater.log'
    Assert-LpNoReparse $logPath
    $line = [DateTime]::UtcNow.ToString('o') + ' ' + ($result | ConvertTo-Json -Depth 5 -Compress)
    if ($line.Length -gt 4096) { $line = $line.Substring(0,4096) }
    if ([IO.File]::Exists($logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 256KB) {
        $oldLog = Join-Path $directory 'updater.previous.log'; Assert-LpNoReparse $oldLog
        if ([IO.File]::Exists($oldLog)) { [IO.File]::Delete($oldLog) }
        [IO.File]::Move($logPath,$oldLog)
    }
    [IO.File]::AppendAllText($logPath,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
} catch {
    # Logging failure must still produce a meaningful nonzero process result.
    $exitCode = 1
    [Console]::Error.WriteLine('Updater status could not be saved: ' + $_.Exception.Message)
}
$result | ConvertTo-Json -Depth 5 -Compress | Write-Output
exit $exitCode
