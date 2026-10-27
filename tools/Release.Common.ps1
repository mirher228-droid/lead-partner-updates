Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-ReleaseVersion {
    param([Parameter(Mandatory=$true)][string]$Version)
    if ($Version -notmatch '^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4}))?$') { throw 'Invalid release version; use a canonical Chrome version such as 1.2.30.' }
    foreach ($part in $Version.Split('.')) { if ([int]$part -gt 65535) { throw 'Release version component exceeds 65535.' } }
    if (($Version -replace '[.0]', '').Length -eq 0) { throw 'Release version must not be all zero.' }
}

function Assert-ReleasePath {
    param([Parameter(Mandatory=$true)][string]$Path, [switch]$Directory)
    $check = $Path
    if ($Directory -and $check.EndsWith('/')) { $check = $check.Substring(0, $check.Length - 1) }
    if ([string]::IsNullOrEmpty($check) -or $check.Length -gt 240 -or $check.Contains('\') -or $check.StartsWith('/') -or $check -match '[\x00-\x1f\x7f<>:"|?*]') { throw ('Unsafe archive path: ' + $Path) }
    foreach ($component in $check.Split('/')) {
        if ($component -eq '' -or $component -eq '.' -or $component -eq '..' -or $component.EndsWith('.') -or $component.EndsWith(' ') -or $component -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') { throw ('Unsafe or reserved archive path: ' + $Path) }
    }
}

function Assert-CommonFilePolicy {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][AllowEmptyCollection()][byte[]]$Bytes)
    if ($Path -match '(?i)(^|[/._ -])(admin|zakhar|telegram|tg|tdata|sessions?|profiles?|cookies?|credentials?|secrets?|private[-_ ]?key)([/._ -]|$)|(^|/)\.env(?:\.|$)|(^|/)(id_rsa|id_ed25519)(\.|$)|(^|/)login data$|(^|/)local state$') { throw ('Forbidden private or non-Common file: ' + $Path) }
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if (@('.js','.json','.css','.html','.png','.svg','.txt','.md','.webp','.jpg','.jpeg','.gif','.woff','.woff2','.ttf') -notcontains $extension) { throw ('Forbidden executable or unsupported extension: ' + $Path) }
    if (@('.js','.json','.css','.html','.svg','.txt','.md') -contains $extension) {
        $source = [Text.Encoding]::UTF8.GetString($Bytes)
        $secretPattern = '(?is)-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\b|["''](?:bot_token|github_token|access_token|refresh_token|client_secret|api_hash|password)["'']\s*[:=]\s*["''][A-Za-z0-9_+/=-]{16,}["'']'
        if ($source -match $secretPattern) { throw ('Possible secret or credential in file: ' + $Path) }
    }
}

function Get-ReleaseByteHash {
    param([Parameter(Mandatory=$true)][AllowEmptyCollection()][byte[]]$Bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
}


function Assert-ReleaseJsonFields {
    param([Parameter(Mandatory=$true)]$Value, [Parameter(Mandatory=$true)][string[]]$Fields)
    if ($Value -isnot [pscustomobject]) { throw 'Inventory entry must be a JSON object.' }
    $names = @($Value.PSObject.Properties.Name)
    if ($names.Count -ne $Fields.Count) { throw 'Unexpected or missing inventory JSON field.' }
    foreach ($name in $names) { if ($Fields -cnotcontains $name) { throw ('Unexpected inventory JSON field: ' + $name) } }
}
function Test-CommonArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ArchivePath,
        [Parameter(Mandatory=$true)][string]$Version,
        [string]$ReleaseTag,
        [string]$ExpectedSha256
    )
    Assert-ReleaseVersion $Version
    if ($ReleaseTag -and $ReleaseTag -cne ('common-v' + $Version)) { throw 'Release tag does not match the requested version.' }
    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'Common archive is missing.' }
    $archiveInfo = Get-Item -LiteralPath $ArchivePath
    if (($archiveInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Archive must not be a reparse point.' }
    if ($archiveInfo.Length -le 0 -or $archiveInfo.Length -gt 50MB) { throw 'Archive size exceeds the 50 MiB limit or is empty.' }
    $archiveHash = (Get-FileHash -LiteralPath $archiveInfo.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ExpectedSha256 -and ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $archiveHash -cne $ExpectedSha256.ToLowerInvariant())) { throw 'Archive SHA256 does not match the expected value.' }
    $files = @{}
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $filePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $totalSize = [int64]0
    $archive = [IO.Compression.ZipFile]::OpenRead($archiveInfo.FullName)
    try {
        if ($archive.Entries.Count -lt 1 -or $archive.Entries.Count -gt 1000) { throw 'ZIP entry count exceeds the 1000 entry limit or archive is empty.' }
        foreach ($entry in $archive.Entries) {
            $isDirectory = $entry.FullName.EndsWith('/')
            Assert-ReleasePath -Path $entry.FullName -Directory:$isDirectory
            if (-not $entry.FullName.StartsWith('Lead-Partner-Common/', [StringComparison]::Ordinal)) { throw 'ZIP must have exactly one Lead-Partner-Common/ root.' }
            $canonicalName = $entry.FullName.TrimEnd('/')
            if (-not $seen.Add($canonicalName)) { throw ('Duplicate archive path (case-insensitive): ' + $entry.FullName) }
            $pathParts = $canonicalName.Split('/')
            $parentPath = ''
            for ($partIndex = 0; $partIndex -lt ($pathParts.Length - 1); $partIndex++) {
                $parentPath = if ($parentPath.Length -eq 0) { $pathParts[$partIndex] } else { $parentPath + '/' + $pathParts[$partIndex] }
                if ($filePaths.Contains($parentPath)) { throw 'Archive file/directory path collision.' }
            }
            if (-not $isDirectory) {
                foreach ($seenPath in $seen) { if ($seenPath.StartsWith($canonicalName + '/', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive file/directory path collision.' } }
                $filePaths.Add($canonicalName) | Out-Null
            }
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            if (($entry.ExternalAttributes -band 0x400) -ne 0 -or ($unixType -ne 0 -and $unixType -ne 0x8000 -and $unixType -ne 0x4000)) { throw ('Archive link or reparse entry is forbidden: ' + $entry.FullName) }
            if ($isDirectory) { if ($entry.Length -ne 0) { throw 'Directory ZIP entries must be empty.' }; continue }
            if ($unixType -eq 0x4000) { throw 'Directory mode on a file ZIP entry is forbidden.' }
            if ($entry.Length -gt 20MB) { throw 'ZIP file size exceeds the 20 MiB limit.' }
            $totalSize += $entry.Length
            if ($totalSize -gt 100MB) { throw 'ZIP expanded size exceeds the 100 MiB limit.' }
            if ($entry.Length -gt 0 -and ($entry.CompressedLength -le 0 -or $entry.Length -gt ([Math]::Max(1, $entry.CompressedLength) * 1000))) { throw 'ZIP compression ratio exceeds the safe limit.' }
            $relativePath = $entry.FullName.Substring('Lead-Partner-Common/'.Length)
            if ($relativePath.Length -eq 0) { throw 'Empty file archive path.' }
            $inputStream = $entry.Open()
            $outputStream = New-Object IO.MemoryStream
            try {
                $buffer = New-Object byte[] 65536
                $readTotal = [int64]0
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $readTotal += $read
                    if ($readTotal -gt 20MB -or $readTotal -gt $entry.Length) { throw 'ZIP stream exceeds its declared size or safe limit.' }
                    $outputStream.Write($buffer, 0, $read)
                }
                if ($readTotal -ne $entry.Length) { throw 'ZIP stream size does not match metadata.' }
                $bytes = $outputStream.ToArray()
            } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            Assert-CommonFilePolicy -Path $relativePath -Bytes $bytes
            $files[$relativePath] = [pscustomobject]@{ Bytes=$bytes; Sha256=(Get-ReleaseByteHash $bytes) }
        }
    } finally { $archive.Dispose() }
    foreach ($requiredFile in @('manifest.json','sources-config.json','ROOTRELEASE_FILES.json')) { if (-not $files.ContainsKey($requiredFile)) { throw ('Required manifest or inventory file is missing: ' + $requiredFile) } }
    if ($files['manifest.json'].Bytes.Length -gt 1MB) { throw 'Common manifest exceeds the 1 MiB limit.' }
    try { $manifest = [Text.Encoding]::UTF8.GetString($files['manifest.json'].Bytes).TrimStart([char]0xfeff) | ConvertFrom-Json } catch { throw 'Common manifest is not valid JSON.' }
    if ($manifest.manifest_version -ne 3 -or $manifest.name -cne 'Lead-Partner · Общая' -or $manifest.short_name -cne 'LP Общая') { throw 'Manifest is not the approved Common edition (Admin and other editions are forbidden).' }
    $baselinePermissions = @('storage','tabs','unlimitedStorage','scripting','alarms')
    foreach ($permissionProperty in @('permissions','optional_permissions')) {
        $property = $manifest.PSObject.Properties[$permissionProperty]
        if ($null -eq $property) { continue }
        if ($property.Value -isnot [Array]) { throw 'Manifest permissions must be an array.' }
        foreach ($permission in $property.Value) {
            if ($permission -isnot [string] -or $baselinePermissions -cnotcontains $permission) { throw ('Common permission expansion is forbidden: ' + $permission) }
        }
    }
    if ($manifest.version -cne $Version) { throw 'Manifest version does not match the release version.' }
    try { $inventory = [Text.Encoding]::UTF8.GetString($files['ROOTRELEASE_FILES.json'].Bytes).TrimStart([char]0xfeff) | ConvertFrom-Json } catch { throw 'ROOTRELEASE inventory is not valid JSON.' }
    Assert-ReleaseJsonFields -Value $inventory -Fields @('schemaVersion','version','files')
    if (($inventory.schemaVersion -isnot [int] -and $inventory.schemaVersion -isnot [long]) -or $inventory.schemaVersion -ne 1 -or $inventory.version -cne $Version) { throw 'ROOTRELEASE inventory schema or version does not match the release.' }
    if ($inventory.files -isnot [Array] -or $inventory.files.Count -ne ($files.Count - 1)) { throw 'ROOTRELEASE inventory has duplicate, missing or extra entries; list every archive file once, excluding itself.' }
    $inventorySeen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $inventory.files) {
        Assert-ReleaseJsonFields -Value $item -Fields @('path','sha256')
        if ($item.path -isnot [string] -or $item.sha256 -isnot [string]) { throw 'Invalid inventory file entry.' }
        Assert-ReleasePath -Path $item.path
        if (-not $inventorySeen.Add($item.path)) { throw 'Duplicate ROOTRELEASE inventory path.' }
        if ($item.path -eq 'ROOTRELEASE_FILES.json' -or -not $files.ContainsKey($item.path)) { throw ('ROOTRELEASE inventory refers to a missing or invalid file: ' + $item.path) }
        if ($item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $item.sha256 -cne $files[$item.path].Sha256) { throw ('ROOTRELEASE inventory hash mismatch: ' + $item.path) }
    }
    return [pscustomobject]@{ Version=$Version; Sha256=$archiveHash; Size=[int64]$archiveInfo.Length; FileCount=$files.Count; ExpandedSize=$totalSize }
}
function Test-CommonReleaseMetadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]$Release,
        [Parameter(Mandatory=$true)][string]$ExpectedTag,
        [Parameter(Mandatory=$true)][string]$LatestTag
    )
    if ($ExpectedTag -cnotmatch '^common-v(.+)$') { throw 'Release tag must use common-v<version>.' }
    $version = $Matches[1]
    Assert-ReleaseVersion $version
    if ($Release.tag_name -cne $ExpectedTag) { throw 'GitHub release tag does not match the requested tag.' }
    if ($Release.draft -ne $false) { throw 'The Common release must be published, not a draft.' }
    if ($Release.prerelease -ne $false) { throw 'The Common release must be stable; prereleases cannot serve the latest channel.' }
    if ($LatestTag -cne $ExpectedTag) { throw 'The requested release is not the latest stable release; refusing to publish a broken latest channel.' }
    $assetName = 'Lead-Partner-Common-' + $version + '.zip'
    $found = @()
    foreach ($asset in $Release.assets) {
        if (@($assetName, 'update.json', 'Lead-Partner-Common-AutoUpdate-Setup.zip') -cnotcontains $asset.name) { throw ('Unexpected non-Common or wrong-version release asset: ' + $asset.name) }
        if ($asset.name -ceq $assetName) { $found += $asset }
    }
    if ($found.Count -ne 1) { throw ('Release must contain exactly one required Common ZIP asset: ' + $assetName) }
    if ($found[0].size -le 0 -or $found[0].size -gt 50MB) { throw 'Common ZIP asset size exceeds the 50 MiB limit or is empty.' }
    return [pscustomobject]@{Version=$version;Tag=$ExpectedTag;AssetName=$assetName;AssetSize=[int64]$found[0].size}
}