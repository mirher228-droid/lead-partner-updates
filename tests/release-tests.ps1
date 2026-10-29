# Test contract: changing validation to accept an untrusted archive or mislabel a channel must fail these tests.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = Split-Path -Parent $PSScriptRoot
$validatorPath = Join-Path $repoRoot 'tools/Release.Common.ps1'
if (-not (Test-Path -LiteralPath $validatorPath)) { throw 'Release validation implementation is missing.' }
. $validatorPath
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('LeadPartner-release-tests-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$script:testCount = 0
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action, [string]$MessagePattern) {
    $caught = $null
    try { & $Action | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-True ($null -ne $caught) 'Unsafe archive was accepted.'
    Assert-True ($caught -match $MessagePattern) ('Unexpected rejection: ' + $caught)
    $script:testCount++
}
function New-Fixture([string]$Name, [hashtable]$Overrides = @{}, [string[]]$ExtraNames = @(), [switch]$OmitInventory, [switch]$BadInventoryHash, [switch]$OmitInventoryFile, [switch]$ExtraInventoryFile, [switch]$DuplicateInventory, [switch]$Symlink, [switch]$OmitSourcesConfig, [switch]$StringInventorySchema, [switch]$ExtraInventoryField) {
    $files = [ordered]@{
        'manifest.json' = '{"manifest_version":3,"name":"Lead-Partner · Общая","short_name":"LP Общая","version":"1.2.30","background":{"service_worker":"background.js"}}'
        'background.js' = 'console.log("Common fixture");'
        'sources-config.json' = '{"url":"https://example.test/catalog"}'
    }
    foreach ($key in $Overrides.Keys) { $files[$key] = $Overrides[$key] }
    if ($OmitSourcesConfig) { $files.Remove('sources-config.json') }
    $inventoryFiles = @()
    foreach ($key in $files.Keys) {
        if ($OmitInventoryFile -and $key -eq 'background.js') { continue }
        $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($files[$key])))).Replace('-', '').ToLowerInvariant() } finally { $hashAlgorithm.Dispose() }
        if ($BadInventoryHash -and $key -eq 'background.js') { $hash = '0' * 64 }
        $inventoryFiles += [ordered]@{ path = $key; sha256 = $hash }
    }
    if ($ExtraInventoryFile) { $inventoryFiles += [ordered]@{ path = 'missing.js'; sha256 = ('0' * 64) } }
    if ($DuplicateInventory) { $inventoryFiles[2] = $inventoryFiles[0] }
    if (-not $OmitInventory) { $inventoryData = [ordered]@{schemaVersion=1;version='1.2.30';files=$inventoryFiles}; if ($StringInventorySchema) { $inventoryData.schemaVersion = '1' }; if ($ExtraInventoryField) { $inventoryData['unknown'] = 'extra' }; $files['ROOTRELEASE_FILES.json'] = ($inventoryData | ConvertTo-Json -Depth 8) }
    $archivePath = Join-Path $testRoot ($Name + '.zip')
    $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($key in $files.Keys) {
            $entry = $archive.CreateEntry('Lead-Partner-Common/' + $key)
            if ($Symlink -and $key -eq 'background.js') { $entry.ExternalAttributes = -1577123840 }
            $stream = $entry.Open()
            try { $bytes = [Text.Encoding]::UTF8.GetBytes($files[$key]); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
        foreach ($extraName in $ExtraNames) {
            $entry = $archive.CreateEntry($extraName)
            $stream = $entry.Open()
            try { $bytes = [Text.Encoding]::UTF8.GetBytes('unlisted'); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
    } finally { $archive.Dispose() }
    return $archivePath
}
try {
    $valid = New-Fixture 'valid'
    $metadata = Test-CommonArchive -ArchivePath $valid -Version '1.2.30' -ReleaseTag 'common-v1.2.30'
    Assert-True ($metadata.Version -eq '1.2.30') 'Validated version was not returned.'
    Assert-True ($metadata.Size -eq (Get-Item -LiteralPath $valid).Length) 'Archive size is incorrect.'
    Assert-True ($metadata.Sha256 -match '^[a-f0-9]{64}$') 'Archive SHA256 is not normalized.'
    $script:testCount++
    Assert-Rejected { Test-CommonArchive -ArchivePath $valid -Version '1.2.31' } 'version'
    Assert-Rejected { Test-CommonArchive -ArchivePath $valid -Version '1.2.30' -ReleaseTag 'common-v1.2.31' } 'tag'
    Assert-Rejected { Test-CommonArchive -ArchivePath $valid -Version '01.2.30' } 'version'
    Assert-Rejected { Test-CommonArchive -ArchivePath $valid -Version '1.2.30' -ExpectedSha256 ('0' * 64) } 'SHA256'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'inventory-hash' -BadInventoryHash) -Version '1.2.30' } 'inventory.*hash|hash.*inventory'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'inventory-missing' -OmitInventory) -Version '1.2.30' } 'inventory|ROOTRELEASE'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'unlisted' -OmitInventoryFile) -Version '1.2.30' } 'inventory|unlisted'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'inventory-extra' -ExtraInventoryFile) -Version '1.2.30' } 'inventory|missing'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'inventory-duplicate' -DuplicateInventory) -Version '1.2.30' } 'duplicate'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'admin' @{ 'manifest.json' = '{"manifest_version":3,"name":"Lead-Partner Admin","version":"1.2.30"}' }) -Version '1.2.30' } 'Common|Admin|edition'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'zakhar' @{'zakhar-rules.js'='private'}) -Version '1.2.30' } 'forbidden|private'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'session' @{'browser.session'='private'}) -Version '1.2.30' } 'forbidden|private|extension'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'telegram' @{'windows-telegram/state.json'='private'}) -Version '1.2.30' } 'forbidden|private'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'private-key' @{'key.txt'='-----BEGIN PRIVATE KEY-----'}) -Version '1.2.30' } 'secret|credential'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'token' @{'settings.json'='{"bot_token":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"}'}) -Version '1.2.30' } 'secret|credential'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'traversal' @{} @('Lead-Partner-Common/../outside.js')) -Version '1.2.30' } 'path|traversal'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'backslash' @{} @('Lead-Partner-Common\escape.js')) -Version '1.2.30' } 'path'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'duplicate-case' @{} @('Lead-Partner-Common/BACKGROUND.JS')) -Version '1.2.30' } 'duplicate'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'executable' @{'run.ps1'='Write-Output unsafe'}) -Version '1.2.30' } 'extension|executable'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'root' @{} @('Other/background.js')) -Version '1.2.30' } 'root|path'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'symlink' -Symlink) -Version '1.2.30' } 'link|reparse'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'reserved' @{'CON.txt'='unsafe'}) -Version '1.2.30' } 'path|reserved'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'path-collision' @{'child.js'='file'; 'child.js/other.js'='nested'}) -Version '1.2.30' } 'collision|path'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'ratio' @{'bomb.js'=('x' * 2MB)}) -Version '1.2.30' } 'ratio|limit'
    $tooManyEntries = @(); for ($entryIndex=0; $entryIndex -lt 1000; $entryIndex++) { $tooManyEntries += ('Lead-Partner-Common/extra-' + $entryIndex + '.js') }
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'entry-limit' @{} $tooManyEntries) -Version '1.2.30' } 'entry.*limit|count'
    $unsafeManifest = '{"manifest_version":3,"name":"Lead-Partner · Общая","short_name":"LP Общая","version":"1.2.30","permissions":["storage","nativeMessaging"]}'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'unsafe-permission' @{'manifest.json'=$unsafeManifest}) -Version '1.2.30' } 'permission|access'
    $optionalManifest = '{"manifest_version":3,"name":"Lead-Partner · Общая","short_name":"LP Общая","version":"1.2.30","optional_permissions":["debugger"]}'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'optional-permission' @{'manifest.json'=$optionalManifest}) -Version '1.2.30' } 'permission|access'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'tg' @{'tg-config.json'='private'}) -Version '1.2.30' } 'forbidden|private'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'missing-sources' -OmitSourcesConfig) -Version '1.2.30' } 'sources|inventory|missing'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'schema-string' -StringInventorySchema) -Version '1.2.30' } 'schema|inventory'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'schema-extra' -ExtraInventoryField) -Version '1.2.30' } 'field|schema|inventory'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'private-key-name' @{'private-key.txt'='private'}) -Version '1.2.30' } 'forbidden|private'
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'admin-space' @{'Admin tools.js'='private'}) -Version '1.2.30' } 'forbidden|private'
    $longSource = 'x' * (20MB + 1)
    Assert-Rejected { Test-CommonArchive -ArchivePath (New-Fixture 'oversize' @{'huge.js'=$longSource}) -Version '1.2.30' } 'limit|size|large'
    $release = [pscustomobject]@{tag_name='common-v1.2.30';draft=$false;prerelease=$false;assets=@([pscustomobject]@{name='Lead-Partner-Common-1.2.30.zip';size=487585})}
    $releaseMetadata = Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30'
    Assert-True ($releaseMetadata.Version -eq '1.2.30' -and $releaseMetadata.AssetName -eq 'Lead-Partner-Common-1.2.30.zip') 'Release metadata did not select the expected Common ZIP.'
    $script:testCount++
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.31' } 'latest'
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.31' -LatestTag 'common-v1.2.31' } 'tag'
    $release.prerelease = $true
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30' } 'stable|prerelease'
    $release.prerelease = $false; $release.draft = $true
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30' } 'draft|published'
    $release.draft = $false; $release.assets = @()
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30' } 'missing|ZIP|asset'
    $release.assets = @([pscustomobject]@{name='Lead-Partner-Common-1.2.29.zip';size=487585})
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30' } 'asset|version'
    $release.assets = @([pscustomobject]@{name='Lead-Partner-Common-1.2.30.zip';size=487585}, [pscustomobject]@{name='Admin.zip';size=10})
    Assert-Rejected { Test-CommonReleaseMetadata -Release $release -ExpectedTag 'common-v1.2.30' -LatestTag 'common-v1.2.30' } 'asset|Common'
    $clientDirectory = Join-Path $testRoot 'client'
    [IO.Directory]::CreateDirectory($clientDirectory) | Out-Null
    $setupFiles = @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt','SilentRunner.cs','Build-SilentRunner.ps1')
    foreach ($setupFile in $setupFiles) { [IO.File]::WriteAllText((Join-Path $clientDirectory $setupFile), ('fixture ' + $setupFile), [Text.UTF8Encoding]::new($false)) }
    $outputDirectory = Join-Path $testRoot 'output'
    $buildResult = & (Join-Path $repoRoot 'tools/Publish-Release.ps1') -ArchivePath $valid -Version '1.2.30' -OutputDirectory $outputDirectory -ClientDirectory $clientDirectory
    $channelBytes = [IO.File]::ReadAllBytes((Join-Path $outputDirectory 'update.json'))
    Assert-True (-not ($channelBytes[0] -eq 239 -and $channelBytes[1] -eq 187 -and $channelBytes[2] -eq 191)) 'Channel JSON must be UTF8 without BOM.'
    $channel = [Text.Encoding]::UTF8.GetString($channelBytes) | ConvertFrom-Json
    Assert-True ($channel.schema -eq 1 -and $channel.channel -eq 'common') 'Wrong channel schema.'
    Assert-True ($channel.repository -eq 'mirher228-droid/lead-partner-updates') 'Repository is not pinned.'
    Assert-True ($channel.version -eq '1.2.30') 'Wrong channel version.'
    Assert-True ($channel.archive.url -eq 'https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.30/Lead-Partner-Common-1.2.30.zip') 'Archive URL is not pinned.'
    Assert-True ($channel.archive.sha256 -eq (Get-FileHash -LiteralPath $valid -Algorithm SHA256).Hash.ToLowerInvariant()) 'Channel hash is wrong.'
    Assert-True ($channel.archive.size -eq (Get-Item -LiteralPath $valid).Length) 'Channel size is wrong.'
    [DateTimeOffset]$channel.publishedAt | Out-Null
    $setupArchive = [IO.Compression.ZipFile]::OpenRead((Join-Path $outputDirectory 'Lead-Partner-Common-AutoUpdate-Setup.zip'))
    try { Assert-True ($setupArchive.Entries.Count -eq 9) 'Setup ZIP must contain exactly approved client files.'; foreach ($setupFile in $setupFiles) { Assert-True ($null -ne $setupArchive.GetEntry($setupFile)) ('Setup file missing: ' + $setupFile) } } finally { $setupArchive.Dispose() }
    $script:testCount++
    # This must run through -File: invoking with & inside this test has different parameter-default scope.
    $cliRoot = Join-Path $testRoot 'cli repository with spaces'
    $cliTools = Join-Path $cliRoot 'tools'
    $cliClient = Join-Path $cliRoot 'client'
    [IO.Directory]::CreateDirectory($cliTools) | Out-Null
    [IO.Directory]::CreateDirectory($cliClient) | Out-Null
    foreach ($toolName in @('Publish-Release.ps1','Release.Common.ps1')) { Copy-Item -LiteralPath (Join-Path $repoRoot ('tools/' + $toolName)) -Destination (Join-Path $cliTools $toolName) }
    foreach ($setupFile in $setupFiles) { Copy-Item -LiteralPath (Join-Path $clientDirectory $setupFile) -Destination (Join-Path $cliClient $setupFile) }
    $cliOutput = Join-Path $testRoot 'cli output with spaces'
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $startInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $cliTools 'Publish-Release.ps1') + '" -ArchivePath "' + $valid + '" -Version 1.2.30 -OutputDirectory "' + $cliOutput + '"'
    $startInfo.WorkingDirectory = $testRoot
    # ProcessStartInfo does not apply pwsh's native WindowsPowerShell module-path compatibility shim.
    $startInfo.EnvironmentVariables['PSModulePath'] = Join-Path (Split-Path -Parent $startInfo.FileName) 'Modules'
    $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    $cliProcess = [Diagnostics.Process]::Start($startInfo)
    try {
        $cliStdout = $cliProcess.StandardOutput.ReadToEnd()
        $cliStderr = $cliProcess.StandardError.ReadToEnd()
        $cliProcess.WaitForExit()
        Assert-True ($cliProcess.ExitCode -eq 0) ('powershell.exe -File CLI failed: ' + $cliStderr + $cliStdout)
    } finally { $cliProcess.Dispose() }
    $cliChannel = Get-Content -LiteralPath (Join-Path $cliOutput 'update.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($cliChannel.archive.sha256 -ceq $channel.archive.sha256 -and $cliChannel.archive.size -eq $channel.archive.size) 'Subprocess CLI emitted incorrect archive integrity metadata.'
    $cliSetup = [IO.Compression.ZipFile]::OpenRead((Join-Path $cliOutput 'Lead-Partner-Common-AutoUpdate-Setup.zip'))
    try { Assert-True ($cliSetup.Entries.Count -eq 9 -and $null -ne $cliSetup.GetEntry('Updater.Core.ps1') -and $null -ne $cliSetup.GetEntry('SilentRunner.cs') -and $null -ne $cliSetup.GetEntry('Build-SilentRunner.ps1')) 'Subprocess CLI did not find its sibling client directory.' } finally { $cliSetup.Dispose() }
    $script:testCount++
    Remove-Item -LiteralPath (Join-Path $clientDirectory 'Updater.Core.ps1')
    Assert-Rejected { & (Join-Path $repoRoot 'tools/Publish-Release.ps1') -ArchivePath $valid -Version '1.2.30' -OutputDirectory (Join-Path $testRoot 'missing-client') -ClientDirectory $clientDirectory } 'missing|client'
    Write-Output ('PASS release validation/build: ' + $script:testCount + ' checks')
} finally { if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force } }
