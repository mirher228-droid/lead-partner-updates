# Windows PowerShell 5.1. This file only defines functions; importing it does not update an installation.
Set-StrictMode -Version 2
$script:LpRepository = 'mirher228-droid/lead-partner-updates'
$script:LpEndpoint = 'https://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json'
$script:LpMaxZip = 50MB
$script:LpMaxExpanded = 100MB
$script:LpMaxFile = 20MB

function Get-LpProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -ne $p) { return ,$p.Value }
    return $null
}
function Assert-LpFields($Object, [string[]]$Names) {
    if ($null -eq $Object -or $Object -is [array] -or $Object -is [string]) { throw 'Expected JSON object.' }
    foreach ($p in $Object.PSObject.Properties.Name) { if ($Names -cnotcontains $p) { throw "Unexpected JSON field: $p" } }
    foreach ($n in $Names) { if ($null -eq $Object.PSObject.Properties[$n]) { throw "Missing JSON field: $n" } }
}
function Read-LpJson([string]$Path, [long]$Max = 2MB) {
    $f = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($f.PSIsContainer -or $f.Length -gt $Max) { throw 'JSON size/type is invalid.' }
    return ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop)
}
function Write-LpJson([string]$Path, $Value) {
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $previous = $temporary + '.previous'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, $previous) } else { [IO.File]::Move($temporary, $Path) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }; if ([IO.File]::Exists($previous)) { [IO.File]::Delete($previous) } }
}
function Get-LpHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Assert-LpVersion($Version) {
    if ($Version -isnot [string] -or $Version -cnotmatch '^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4}))?$') { throw 'Invalid numeric extension version.' }
    foreach ($part in $Version.Split('.')) { if ([int]$part -gt 65535) { throw 'Version component exceeds Chrome limit.' } }
}
function Compare-LpVersion([string]$A, [string]$B) {
    Assert-LpVersion $A; Assert-LpVersion $B
    $aa = @($A.Split('.') | ForEach-Object { [int]$_ }); $bb = @($B.Split('.') | ForEach-Object { [int]$_ })
    for ($i=0; $i -lt 4; $i++) {
        $av=0; $bv=0; if($i -lt $aa.Count){$av=$aa[$i]}; if($i -lt $bb.Count){$bv=$bb[$i]}
        if($av -gt $bv){return 1}; if($av -lt $bv){return -1}
    }
    return 0
}
function Assert-LpNoReparse([string]$Path) {
    $itemPath = [IO.Path]::GetFullPath($Path)
    while ($itemPath) {
        if (Test-Path -LiteralPath $itemPath) {
            $item = Get-Item -LiteralPath $itemPath -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not supported.' }
        }
        $parent = [IO.Path]::GetDirectoryName($itemPath)
        if ($parent -eq $itemPath) { break }; $itemPath = $parent
    }
}
function Assert-LpRelative([string]$Path) {
    if (-not $Path -or $Path.Length -gt 220 -or $Path.Contains('\') -or $Path.StartsWith('/') -or $Path.Contains(':') -or $Path -match '[\x00-\x1f\x7f]') { throw 'Unsafe relative package path.' }
    foreach ($part in $Path.Split('/')) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>"|?*]' -or $part -match '[ .]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') { throw 'Unsafe Windows path component.' }
    }
}
function Get-LpChild([string]$Root, [string]$Relative) {
    Assert-LpRelative $Relative
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $full.StartsWith(($Root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped its root.' }
    Assert-LpNoReparse $full
    return $full
}
function Remove-LpStateTree([string]$State, [string]$Name) {
    # Name is an internal constant; absolute containment and reparse checks precede recursive deletion.
    $target=Get-LpChild $State $Name
    if (Test-Path -LiteralPath $target) {
        Assert-LpTree $target
        Remove-Item -LiteralPath $target -Force -Recurse -ErrorAction Stop
    }
}
function Assert-LpTree([string]$Root) {
    Assert-LpNoReparse $Root
    if (Test-Path -LiteralPath $Root -PathType Container) {
        $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($Root)
        while($pending.Count -gt 0){
            foreach($item in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop){
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Tree contains a reparse point.' }
                if($item.PSIsContainer){$pending.Push($item.FullName)}
            }
        }
    }
}
function Assert-LpCommonManifest($Manifest) {
    if ((Get-LpProperty $Manifest 'manifest_version') -ne 3 -or (Get-LpProperty $Manifest 'name') -cne 'Lead-Partner · Общая' -or (Get-LpProperty $Manifest 'short_name') -cne 'LP Общая') { throw 'Only the Common extension is supported.' }
    Assert-LpVersion (Get-LpProperty $Manifest 'version')
    $key = Get-LpProperty $Manifest 'key'
    if ($null -ne $key -and ($key -isnot [string] -or -not $key -or $key.Length -gt 16384)) { throw 'Invalid extension identity key.' }
}
function Get-LpAccessValues($Manifest,[string]$Name) {
    $values=Get-LpProperty $Manifest $Name
    if($null -eq $values){return}
    if($values -isnot [array]){throw "Manifest $Name must be an array."}
    foreach($value in $values){if($value -isnot [string] -or -not $value){throw "Invalid manifest $Name item."};$value}
}
function Get-LpContentMatches($Manifest) {
    $scripts=Get-LpProperty $Manifest 'content_scripts'
    if($null -eq $scripts){return}
    if($scripts -isnot [array]){throw 'Manifest content_scripts must be an array.'}
    foreach($contentScript in $scripts){Get-LpAccessValues $contentScript 'matches'}
}
function Assert-LpAccessSubset($Current,$Incoming) {
    foreach($name in @('permissions','host_permissions','optional_permissions','optional_host_permissions')){
        $old=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach($value in @(Get-LpAccessValues $Current $name)){[void]$old.Add($value)}
        foreach($value in @(Get-LpAccessValues $Incoming $name)){
            if($value -in @('nativeMessaging','proxy','debugger')){throw 'Sensitive browser permission is not allowed for Common.'}
            if(-not $old.Contains($value)){throw "Automatic update expands $name; use a reviewed manual release."}
        }
    }
    $oldMatches=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach($value in @(Get-LpContentMatches $Current)){[void]$oldMatches.Add($value)}
    foreach($value in @(Get-LpContentMatches $Incoming)){if(-not $oldMatches.Contains($value)){throw 'Automatic update expands content script hosts; use a reviewed manual release.'}}
}
function Assert-LpArtifact([string]$Path,[switch]$Directory) {
    if ($Path -match '(?i)(^|[/._ -])(admin|zakhar|telegram|tg|tdata|profiles?|sessions?|cookies?|credentials?|secrets?|private[-_ ]?key)([/._ -]|$)|(^|/)\.env(?:\.|$)|(^|/)(id_rsa|id_ed25519)(\.|$)|(^|/)login data$|(^|/)local state$') { throw "Forbidden package artifact: $Path" }
    if(-not $Directory -and @('.js','.json','.css','.html','.png','.svg','.txt','.md','.webp','.jpg','.jpeg','.gif','.woff','.woff2','.ttf') -notcontains [IO.Path]::GetExtension($Path).ToLowerInvariant()){throw "Unsupported package artifact extension: $Path"}
}
function Assert-LpPublicContent([string]$Path,[byte[]]$Bytes) {
    if($Path -match '(?i)\.(js|json|txt|html|css|svg)$'){
        $content=[Text.Encoding]::UTF8.GetString($Bytes)
        if($content -match '-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----' -or $content -match '\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[A-Z0-9]{16}\b|\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b') {throw "Private credential content in package: $Path"}
    }
}
function Get-LpInventory([string]$Root, [string]$Version, [switch]$Verify) {
    $inventory = Read-LpJson (Join-Path $Root 'ROOTRELEASE_FILES.json')
    Assert-LpFields $inventory @('schemaVersion','version','files')
    if (($inventory.schemaVersion -isnot [int] -and $inventory.schemaVersion -isnot [long]) -or $inventory.schemaVersion -ne 1 -or $inventory.version -cne $Version -or $inventory.files -isnot [array] -or $inventory.files.Count -lt 1 -or $inventory.files.Count -ge 1000) { throw 'Invalid release inventory.' }
    $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $inventory.files) {
        Assert-LpFields $file @('path','sha256')
        if ($file.path -isnot [string] -or $file.sha256 -isnot [string] -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid inventory item.' }
        Assert-LpRelative $file.path; Assert-LpArtifact $file.path
        if ($file.path -ieq 'ROOTRELEASE_FILES.json' -or -not $paths.Add($file.path)) { throw 'Duplicate or self-referential inventory entry.' }
        $target=Get-LpChild $Root $file.path
        if ($Verify) {
            if (-not [IO.File]::Exists($target)) { throw "Missing inventory file: $($file.path)" }
            $fileBytes=[IO.File]::ReadAllBytes($target)
            if ((Get-LpHash $fileBytes) -cne $file.sha256) { throw "Inventory hash mismatch: $($file.path)" }
            Assert-LpPublicContent $file.path $fileBytes
        }
    }
    if (-not $paths.Contains('manifest.json') -or -not $paths.Contains('sources-config.json')) { throw 'Incomplete Common inventory.' }
    if ($Verify) {
        $actual=@(Get-ChildItem -LiteralPath $Root -File -Recurse -Force)
        if ($actual.Count -ne ($paths.Count+1)) { throw 'Package files do not match inventory.' }
        foreach($f in $actual) {
            $rel=$f.FullName.Substring($Root.TrimEnd('\','/').Length+1).Replace('\','/')
            if ($rel -cne 'ROOTRELEASE_FILES.json' -and -not $paths.Contains($rel)) { throw 'Unlisted package file.' }
        }
    }
    return $inventory
}
function Assert-LpChannel($Channel) {
    Assert-LpFields $Channel @('schema','channel','version','repository','archive','publishedAt')
    if (($Channel.schema -isnot [int] -and $Channel.schema -isnot [long]) -or $Channel.schema -ne 1 -or $Channel.channel -cne 'common' -or $Channel.repository -cne $script:LpRepository) { throw 'Unsupported update channel.' }
    Assert-LpVersion $Channel.version
    Assert-LpFields $Channel.archive @('url','sha256','size')
    $expected='https://github.com/' + $script:LpRepository + '/releases/download/common-v' + $Channel.version + '/Lead-Partner-Common-' + $Channel.version + '.zip'
    if ($Channel.archive.url -isnot [string] -or $Channel.archive.url -cne $expected) { throw 'Release URL must match the pinned HTTPS repository and version.' }
    if ($Channel.archive.sha256 -isnot [string] -or $Channel.archive.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $Channel.archive.size -is [string] -or $Channel.archive.size -is [bool] -or $Channel.archive.size -lt 1 -or $Channel.archive.size -gt $script:LpMaxZip -or [double]$Channel.archive.size -ne [long]$Channel.archive.size) { throw 'Invalid archive integrity metadata.' }
    $date=[DateTimeOffset]::MinValue
    # PowerShell 7 automatically deserializes ISO timestamps; Windows PowerShell 5.1 keeps strings.
    if($Channel.publishedAt -is [DateTime] -or $Channel.publishedAt -is [DateTimeOffset]) { $date=[DateTimeOffset]$Channel.publishedAt }
    elseif ($Channel.publishedAt -isnot [string] -or $Channel.publishedAt -notmatch '^\d{4}-\d\d-\d\dT' -or -not [DateTimeOffset]::TryParse($Channel.publishedAt,[ref]$date)) { throw 'Invalid publication timestamp.' }
}
function Assert-LpRedirect([uri]$Uri) {
    if ($Uri.Scheme -cne 'https' -or -not $Uri.IsDefaultPort -or $Uri.UserInfo -or $Uri.Fragment) { throw 'Unsafe HTTP redirect.' }
    if ($Uri.Host -ieq 'github.com' -and $Uri.AbsolutePath.StartsWith(('/'+$script:LpRepository+'/'),[StringComparison]::Ordinal)) { return }
    if ($Uri.Host -ieq 'release-assets.githubusercontent.com' -and $Uri.AbsolutePath.StartsWith('/github-production-release-asset/')) { return }
    if ($Uri.Host -ieq 'objects.githubusercontent.com' -and $Uri.AbsolutePath.StartsWith('/github-production-release-asset-')) { return }
    throw 'Redirect left the trusted GitHub release hosts.'
}
function Get-LpRequestBytes([string]$Url, [long]$MaxBytes, [scriptblock]$Request) {
    if ($Request) {
        [byte[]]$bytes = & $Request $Url
        if ($null -eq $bytes -or $bytes.LongLength -gt $MaxBytes) { throw 'Response exceeds download limit.' }
        return ,$bytes
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $uri=[uri]$Url
    for($redirect=0; $redirect -le 5; $redirect++) {
        Assert-LpRedirect $uri
        $web=[Net.HttpWebRequest]::Create($uri); $web.Method='GET'; $web.AllowAutoRedirect=$false
        $web.Timeout=20000; $web.ReadWriteTimeout=30000; $web.UserAgent='LeadPartner-Common-Updater/1'; $web.UseDefaultCredentials=$false
        $response=$null
        try {
            $response=$web.GetResponse(); $code=[int]$response.StatusCode
            if($code -in @(301,302,303,307,308)) {
                if($redirect -eq 5 -or -not $response.Headers['Location']) { throw 'Too many release redirects.' }
                $uri=[uri]::new($uri,$response.Headers['Location']); continue
            }
            if($code -ne 200 -or $response.ContentLength -gt $MaxBytes) { throw 'Invalid or oversized HTTP response.' }
            $stream=$response.GetResponseStream(); $memory=[IO.MemoryStream]::new()
            try {
                $buffer=New-Object byte[] 65536
                while(($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {
                    if($memory.Length+$read -gt $MaxBytes) {throw 'Response exceeds download limit.'}; $memory.Write($buffer,0,$read)
                }
                return ,$memory.ToArray()
            } finally {$stream.Dispose();$memory.Dispose()}
        } finally {if($response){$response.Dispose()}}
    }
    throw 'Release download failed.'
}
function Expand-LpArchive([string]$ZipPath,[string]$State,$Channel) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Remove-LpStateTree $State 'stage'
    $stage=Get-LpChild $State 'stage'; [void][IO.Directory]::CreateDirectory($stage)
    $zip=[IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if($zip.Entries.Count -lt 1 -or $zip.Entries.Count -gt 1000){throw 'ZIP entry count limit exceeded.'}
        $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); [long]$total=0
        foreach($entry in $zip.Entries) {
            $name=$entry.FullName
            if(-not $name.StartsWith('Lead-Partner-Common/',[StringComparison]::Ordinal)){throw 'ZIP must contain only Lead-Partner-Common/.'}
            $relative=$name.Substring(20).TrimEnd('/')
            if(-not $relative){if($name -ceq 'Lead-Partner-Common/'){continue};throw 'Invalid archive root.'}
            Assert-LpRelative $relative; Assert-LpArtifact $relative -Directory:($name.EndsWith('/'))
            if(-not $seen.Add($relative)){throw 'Duplicate case-insensitive ZIP entry.'}
            [long]$attrs=$entry.ExternalAttributes; $unix=($attrs -shr 16) -band 0xF000
            if(($unix -ne 0 -and $unix -ne 0x8000 -and $unix -ne 0x4000) -or ($attrs -band 0x400) -ne 0 -or ($unix -eq 0x4000 -and -not $name.EndsWith('/'))){throw 'ZIP links, device or reparse entries are forbidden.'}
            if($entry.Length -gt $script:LpMaxFile -or $entry.Length -lt 0){throw 'ZIP file size limit exceeded.'}
            $total+=$entry.Length
            if($total -gt $script:LpMaxExpanded -or ($entry.Length -gt 0 -and ($entry.CompressedLength -eq 0 -or $entry.Length/$entry.CompressedLength -gt 1000))){throw 'ZIP expansion limit exceeded.'}
            $destination=Get-LpChild $stage $relative
            if($name.EndsWith('/')){[void][IO.Directory]::CreateDirectory($destination);continue}
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
            $input=$entry.Open();$output=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try {
                $buffer=New-Object byte[] 65536;[long]$written=0
                while(($read=$input.Read($buffer,0,$buffer.Length)) -gt 0){$written+=$read;if($written -gt $entry.Length -or $written -gt $script:LpMaxFile){throw 'ZIP stream exceeded its declared length.'};$output.Write($buffer,0,$read)}
                if($written -ne $entry.Length){throw 'Truncated ZIP entry.'}
            } finally {$input.Dispose();$output.Dispose()}
        }
    } finally {$zip.Dispose()}
    $manifest=Read-LpJson (Join-Path $stage 'manifest.json');Assert-LpCommonManifest $manifest
    if($manifest.version -cne $Channel.version){throw 'Archive manifest version mismatch.'}
    $inventory=Get-LpInventory $stage $Channel.version -Verify
    return @{path=$stage;manifest=$manifest;inventory=$inventory}
}
function Test-LpBrowserRunning {
    # Include background processes: closing the last window alone is insufficient.
    return (@(Get-Process -Name chrome,msedge,browser,chromium,brave,vivaldi,opera,firefox -ErrorAction SilentlyContinue).Count -gt 0)
}
function Copy-LpAtomic([string]$Source,[string]$Destination) {
    Assert-LpNoReparse $Source;Assert-LpNoReparse $Destination
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination))
    $temporary=$Destination+'.lp-'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $previous=$temporary+'.previous'
    try {
        [IO.File]::Copy($Source,$temporary,$false)
        if([IO.File]::Exists($Destination)){[IO.File]::Replace($temporary,$Destination,$previous)}else{[IO.File]::Move($temporary,$Destination)}
    } finally {if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)};if([IO.File]::Exists($previous)){[IO.File]::Delete($previous)}}
}
function Restore-LpTransaction([string]$State,[string]$Extension,[scriptblock]$BrowserRunning) {
    $journalPath=Get-LpChild $State 'journal.json';$journal=Read-LpJson $journalPath
    Assert-LpFields $journal @('schema','extensionPath','fromVersion','toVersion','entries')
    if($journal.schema -ne 1 -or $journal.extensionPath -cne $Extension -or $journal.entries -isnot [array] -or $journal.entries.Count -gt 2001){throw 'Invalid recovery journal.'}
    Assert-LpVersion $journal.fromVersion;Assert-LpVersion $journal.toVersion
    $backup=Get-LpChild $State 'backup';Assert-LpTree $backup
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $journal.entries){
        Assert-LpFields $entry @('path','existed','sha256');Assert-LpRelative $entry.path
        if(-not $seen.Add($entry.path) -or $entry.existed -isnot [bool]){throw 'Invalid recovery entry.'}
        $destination=Get-LpChild $Extension $entry.path
        if($entry.existed){
            $source=Get-LpChild $backup $entry.path
            if($entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or -not [IO.File]::Exists($source) -or (Get-LpHash ([IO.File]::ReadAllBytes($source))) -cne $entry.sha256){throw 'Backup integrity check failed.'}
        }
    }
    foreach($entry in @($journal.entries | Sort-Object @{Expression={if($_.path -ieq 'manifest.json'){1}else{0}}},path)){
        $destination=Get-LpChild $Extension $entry.path
        if($entry.existed){
            if([IO.File]::Exists($destination) -and (Get-LpHash ([IO.File]::ReadAllBytes($destination))) -ceq $entry.sha256){continue}
            if(& $BrowserRunning){return $false}
            Copy-LpAtomic (Get-LpChild $backup $entry.path) $destination
        }elseif([IO.File]::Exists($destination)){if(& $BrowserRunning){return $false};[IO.File]::Delete($destination)}
    }
    [IO.File]::Delete($journalPath)
    Remove-LpStateTree $State 'backup'
    return $true
}
function Invoke-LpApply([string]$State,[string]$Extension,$Current,$OldInventory,$Package,[scriptblock]$BrowserRunning) {
    $oldKey=Get-LpProperty $Current 'key';$newKey=Get-LpProperty $Package.manifest 'key'
    if($oldKey -and $newKey -and $oldKey -cne $newKey){throw 'Incoming manifest changes extension identity.'}
    if(-not $oldKey -and $newKey){throw 'Incoming manifest adds an extension identity key.'}
    if($oldKey -and -not $newKey){$Package.manifest | Add-Member -NotePropertyName key -NotePropertyValue $oldKey;Write-LpJson (Join-Path $Package.path 'manifest.json') $Package.manifest}
    if(& $BrowserRunning){return $false}
    Assert-LpTree $Extension
    Remove-LpStateTree $State 'backup';$backup=Get-LpChild $State 'backup';[void][IO.Directory]::CreateDirectory($backup)
    $newPaths=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $all=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($f in $Package.inventory.files){[void]$newPaths.Add($f.path);[void]$all.Add($f.path)}
    foreach($f in $OldInventory.files){[void]$all.Add($f.path)}
    [void]$all.Add('ROOTRELEASE_FILES.json');[void]$newPaths.Add('ROOTRELEASE_FILES.json')
    [void]$all.Remove('sources-config.json')
    $entries=@()
    foreach($path in @($all | Sort-Object @{Expression={if($_ -ieq 'manifest.json'){1}else{0}}}, @{Expression={$_}})){
        $destination=Get-LpChild $Extension $path;$exists=[IO.File]::Exists($destination);$hash=$null
        if(Test-Path -LiteralPath $destination -PathType Container){throw 'Package destination is a directory.'}
        if($exists){$hash=Get-LpHash ([IO.File]::ReadAllBytes($destination));$copy=Get-LpChild $backup $path;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($copy));[IO.File]::Copy($destination,$copy,$false)}
        $entries+=@{path=$path;existed=$exists;sha256=$hash}
    }
    Write-LpJson (Get-LpChild $State 'journal.json') @{schema=1;extensionPath=$Extension;fromVersion=$Current.version;toVersion=$Package.manifest.version;entries=$entries}
    try {
        foreach($entry in $entries){
            if(& $BrowserRunning){throw 'Browser started during update; rolling back.'}
            $destination=Get-LpChild $Extension $entry.path
            if($newPaths.Contains($entry.path)){Copy-LpAtomic (Get-LpChild $Package.path $entry.path) $destination}elseif([IO.File]::Exists($destination)){[IO.File]::Delete($destination)}
        }
        $installed=Read-LpJson (Join-Path $Extension 'manifest.json');Assert-LpCommonManifest $installed
        if($installed.version -cne $Package.manifest.version){throw 'Installed manifest version verification failed.'}
        [IO.File]::Delete((Get-LpChild $State 'journal.json'));Remove-LpStateTree $State 'backup'
    }catch{
        $original=$_.Exception.Message
        try {if(-not (Restore-LpTransaction $State $Extension $BrowserRunning)){return $false}}catch{throw "Update failed: $original Recovery requires another closed-browser run: $($_.Exception.Message)"}
        throw "Update failed and was rolled back: $original"
    }
    return $true
}
function Invoke-LeadPartnerUpdate {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$ConfigPath,[scriptblock]$Request,[scriptblock]$BrowserRunning)
    $ErrorActionPreference='Stop'
    if(-not $BrowserRunning){$BrowserRunning={Test-LpBrowserRunning}}
    $configFull=[IO.Path]::GetFullPath($ConfigPath);Assert-LpNoReparse $configFull
    $state=[IO.Path]::GetDirectoryName($configFull);$config=Read-LpJson $configFull 64KB
    Assert-LpFields $config @('schema','repository','channel','extensionPath')
    if(($config.schema -isnot [int] -and $config.schema -isnot [long]) -or $config.schema -ne 1 -or $config.repository -cne $script:LpRepository -or $config.channel -cne 'common'){throw 'Invalid updater configuration.'}
    if($config.extensionPath -isnot [string] -or -not [IO.Path]::IsPathRooted($config.extensionPath) -or $config.extensionPath.StartsWith('\\')){throw 'Choose an absolute local extension directory.'}
    $extension=[IO.Path]::GetFullPath($config.extensionPath).TrimEnd('\','/')
    if($extension.Length -le 3 -or -not [IO.Directory]::Exists($extension)){throw 'Extension directory does not exist or is a drive root.'}
    if($extension -ieq $state -or $state.StartsWith($extension+'\',[StringComparison]::OrdinalIgnoreCase) -or $extension.StartsWith($state+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Updater state and extension directory must be separate.'}
    Assert-LpNoReparse $extension
    $lock=$null
    try {$lock=[IO.File]::Open((Get-LpChild $state 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch [IO.IOException]{return [pscustomobject]@{status='deferred';reason='another update is running';currentVersion=$null;version=$null}}
    try {
        if(Test-Path -LiteralPath (Get-LpChild $state 'journal.json')){
            if(& $BrowserRunning){return [pscustomobject]@{status='deferred';reason='browser open; recovery pending';currentVersion=$null;version=$null}}
            if(-not (Restore-LpTransaction $state $extension $BrowserRunning)){return [pscustomobject]@{status='deferred';reason='browser reopened; recovery pending';currentVersion=$null;version=$null}}
        }
        $current=Read-LpJson (Join-Path $extension 'manifest.json');Assert-LpCommonManifest $current
        $oldInventory=Get-LpInventory $extension $current.version
        $channel=$null;$zipPath=Get-LpChild $state 'staged.zip';$metadata=Get-LpChild $state 'staged.json'
        if([IO.File]::Exists($zipPath) -and [IO.File]::Exists($metadata)){
            $channel=Read-LpJson $metadata;Assert-LpChannel $channel
            if((Compare-LpVersion $channel.version $current.version) -le 0){$channel=$null;[IO.File]::Delete($zipPath);[IO.File]::Delete($metadata)}
        }
        if(-not $channel){
            $bytes=Get-LpRequestBytes $script:LpEndpoint 2MB $Request
            $channel=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
            Assert-LpChannel $channel
            if((Compare-LpVersion $channel.version $current.version) -le 0){return [pscustomobject]@{status='current';currentVersion=$current.version;version=$current.version}}
            $zipBytes=Get-LpRequestBytes $channel.archive.url $script:LpMaxZip $Request
            if($zipBytes.LongLength -ne $channel.archive.size -or (Get-LpHash $zipBytes) -cne $channel.archive.sha256){throw 'Archive SHA256 or byte size mismatch.'}
            [IO.File]::WriteAllBytes($zipPath,$zipBytes);Write-LpJson $metadata $channel
        }
        if((Get-Item -LiteralPath $zipPath).Length -ne $channel.archive.size -or (Get-LpHash ([IO.File]::ReadAllBytes($zipPath))) -cne $channel.archive.sha256){throw 'Saved archive SHA256 or byte size mismatch.'}
        $package=Expand-LpArchive $zipPath $state $channel
        Assert-LpAccessSubset $current $package.manifest
        $oldKey=Get-LpProperty $current 'key';$newKey=Get-LpProperty $package.manifest 'key'
        if(($oldKey -and $newKey -and $oldKey -cne $newKey) -or (-not $oldKey -and $newKey)){throw 'Incoming manifest changes extension identity.'}
        if(& $BrowserRunning){return [pscustomobject]@{status='staged';currentVersion=$current.version;version=$channel.version;reason='waiting for full browser exit'}}
        if(-not (Invoke-LpApply $state $extension $current $oldInventory $package $BrowserRunning)){return [pscustomobject]@{status='deferred';currentVersion=$current.version;version=$channel.version;reason='browser reopened'}}
        [IO.File]::Delete($zipPath);[IO.File]::Delete($metadata);Remove-LpStateTree $state 'stage'
        return [pscustomobject]@{status='updated';currentVersion=$current.version;version=$channel.version}
    } finally {if($lock){$lock.Dispose()}}
}
