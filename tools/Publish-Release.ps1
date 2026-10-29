# Offline validation and release artifact construction. No GitHub credentials or network requests.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$ReleaseTag,
    [string]$ExpectedSha256,
    [string]$ClientDirectory = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ClientDirectory)) { $ClientDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'client' }
. (Join-Path $PSScriptRoot 'Release.Common.ps1')
if (-not $ReleaseTag) { $ReleaseTag = 'common-v' + $Version }
$metadata = Test-CommonArchive -ArchivePath $ArchivePath -Version $Version -ReleaseTag $ReleaseTag -ExpectedSha256 $ExpectedSha256
$setupFiles = @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt','SilentRunner.cs','Build-SilentRunner.ps1')
foreach ($setupFile in $setupFiles) {
    $clientPath = Join-Path $ClientDirectory $setupFile
    if (-not (Test-Path -LiteralPath $clientPath -PathType Leaf)) { throw ('Required client file is missing: ' + $setupFile) }
    $clientInfo = Get-Item -LiteralPath $clientPath
    if ($clientInfo.Length -eq 0 -or $clientInfo.Length -gt 2MB -or ($clientInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Invalid client file: ' + $setupFile) }
}
[IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($OutputDirectory)) | Out-Null
$setupPath = Join-Path $OutputDirectory 'Lead-Partner-Common-AutoUpdate-Setup.zip'
$temporarySetupPath = Join-Path $OutputDirectory ('.setup-' + [Guid]::NewGuid().ToString('N') + '.zip')
try {
    $archive = [IO.Compression.ZipFile]::Open($temporarySetupPath, [IO.Compression.ZipArchiveMode]::Create)
    try { foreach ($setupFile in $setupFiles) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $ClientDirectory $setupFile), $setupFile, [IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $archive.Dispose() }
    Move-Item -LiteralPath $temporarySetupPath -Destination $setupPath -Force
} finally { if (Test-Path -LiteralPath $temporarySetupPath) { Remove-Item -LiteralPath $temporarySetupPath -Force } }
$channel = [ordered]@{
    schema=1
    channel='common'
    version=$Version
    repository='mirher228-droid/lead-partner-updates'
    archive=[ordered]@{
        url=('https://github.com/mirher228-droid/lead-partner-updates/releases/download/' + $ReleaseTag + '/Lead-Partner-Common-' + $Version + '.zip')
        sha256=$metadata.Sha256
        size=$metadata.Size
    }
    publishedAt=[DateTimeOffset]::UtcNow.ToString('o')
}
$channelPath = Join-Path $OutputDirectory 'update.json'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($channelPath), (($channel | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ Version=$Version; ArchiveSha256=$metadata.Sha256; ArchiveSize=$metadata.Size; ChannelPath=[IO.Path]::GetFullPath($channelPath); SetupPath=[IO.Path]::GetFullPath($setupPath) }
