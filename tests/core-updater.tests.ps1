param([string]$CommonZip, [string]$Only)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$core = Join-Path $PSScriptRoot '../client/Updater.Core.ps1'
if (Test-Path -LiteralPath $core) { . $core }
$script:passed = 0; $script:failed = 0
$script:testRoot = Join-Path ([IO.Path]::GetTempPath()) ('lp-core-tests-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:testRoot)
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
function Write-Json($path, $value) { [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false)) }
function Sha([byte[]]$bytes) { $h = [Security.Cryptography.SHA256]::Create(); try { ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() } }
function Create-PackageZip($root,$path) {
    $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Create)
    try {foreach($file in Get-ChildItem -LiteralPath $root -File -Recurse){$name=$file.FullName.Substring($root.Length+1).Replace('\','/');$entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal);$input=[IO.File]::OpenRead($file.FullName);$output=$entry.Open();try{$input.CopyTo($output)}finally{$input.Dispose();$output.Dispose()}}}finally{$zip.Dispose()}
}
if(-not $CommonZip) {
    # CI uses a public deterministic package; explicit -CommonZip uses the real 90-file release.
    $fixtureRoot=Join-Path $script:testRoot 'synthetic'; $fixture=Join-Path $fixtureRoot 'Lead-Partner-Common'; [void][IO.Directory]::CreateDirectory($fixture)
    Write-Json (Join-Path $fixture 'manifest.json') @{manifest_version=3;name='Lead-Partner · Общая';short_name='LP Общая';version='1.2.30';permissions=@('storage')}
    [IO.File]::WriteAllText((Join-Path $fixture 'sources-config.json'),'{"enabled":true}')
    [IO.File]::WriteAllText((Join-Path $fixture 'background.js'),'new-background')
    [IO.File]::WriteAllText((Join-Path $fixture 'popup.js'),'new-popup')
    for($n=1;$n -le 85;$n++){[IO.File]::WriteAllText((Join-Path $fixture ('file-{0:d3}.js' -f $n)),('public-code-'+$n))}
    $files=@(Get-ChildItem -LiteralPath $fixture -File | ForEach-Object {@{path=$_.Name;sha256=(Sha ([IO.File]::ReadAllBytes($_.FullName)))}})
    Write-Json (Join-Path $fixture 'ROOTRELEASE_FILES.json') @{schemaVersion=1;version='1.2.30';files=$files}
    $CommonZip=Join-Path $script:testRoot 'synthetic.zip';Create-PackageZip $fixtureRoot $CommonZip
}
$script:original = [IO.File]::ReadAllBytes($CommonZip)
$readZip=[IO.Compression.ZipFile]::OpenRead($CommonZip)
try {$entry=$readZip.GetEntry('Lead-Partner-Common/background.js');$input=$entry.Open();$output=[IO.MemoryStream]::new();try{$input.CopyTo($output);$script:expectedBackground=Sha $output.ToArray()}finally{$input.Dispose();$output.Dispose()}}finally{$readZip.Dispose()}
function New-Fixture {
    $base = Join-Path $script:testRoot ([Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($base)
    [IO.Compression.ZipFile]::ExtractToDirectory($CommonZip, $base)
    $ext = Join-Path $base 'Lead-Partner-Common'
    $m = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $m.version = '1.2.29'; Write-Json (Join-Path $ext 'manifest.json') $m
    [IO.File]::WriteAllText((Join-Path $ext 'background.js'),'old-background')
    $inventory = Get-Content -LiteralPath (Join-Path $ext 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $inventory.version = '1.2.29'; Write-Json (Join-Path $ext 'ROOTRELEASE_FILES.json') $inventory
    $state = Join-Path $base 'updater'; [void][IO.Directory]::CreateDirectory($state)
    $config = Join-Path $state 'config.json'
    Write-Json $config @{ schema = 1; repository = 'mirher228-droid/lead-partner-updates'; channel = 'common'; extensionPath = $ext }
    $script:payload = $script:original
    $script:channel = @{schema=1;channel='common';version='1.2.30';repository='mirher228-droid/lead-partner-updates';archive=@{url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.30/Lead-Partner-Common-1.2.30.zip';sha256=(Sha $script:payload);size=$script:payload.Length};publishedAt='2026-10-27T00:00:00Z'}
    $script:request = { param($url)
        if ($url -eq 'https://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json') { return ,([Text.Encoding]::UTF8.GetBytes(($script:channel | ConvertTo-Json -Depth 10))) }
        if ($url -eq $script:channel.archive.url) { return ,$script:payload }
        throw "Unexpected request: $url"
    }
    return @{base=$base;ext=$ext;state=$state;config=$config}
}
function Invoke-TestUpdate($f, [scriptblock]$browser = {$false}) { Invoke-LeadPartnerUpdate -ConfigPath $f.config -Request $script:request -BrowserRunning $browser }
function Manifest($f) { Get-Content -LiteralPath (Join-Path $f.ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
function Must-Reject($f) { Assert ($null -ne (Get-Command Invoke-LeadPartnerUpdate -ErrorAction SilentlyContinue)) 'Updater implementation is missing'; $rejected=$false; try { Invoke-TestUpdate $f | Out-Null } catch { $rejected=$true }; Assert $rejected 'Unsafe update was accepted'; Assert ((Manifest $f).version -eq '1.2.29') 'Rejected update changed manifest' }
function Set-Payload($f, [scriptblock]$mutate) {
    $dir=Join-Path $f.base 'payload'; [void][IO.Directory]::CreateDirectory($dir)
    [IO.Compression.ZipFile]::ExtractToDirectory($CommonZip, $dir)
    $package=Join-Path $dir 'Lead-Partner-Common'; & $mutate $package
    $zip=Join-Path $f.base 'payload.zip'; Create-PackageZip $dir $zip
    $script:payload=[IO.File]::ReadAllBytes($zip); $script:channel.archive.sha256=Sha $script:payload; $script:channel.archive.size=$script:payload.Length
}
function Reinventory($package) {
    $i=Get-Content -LiteralPath (Join-Path $package 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach($file in $i.files) { $file.sha256=Sha ([IO.File]::ReadAllBytes((Join-Path $package $file.path))) }
    Write-Json (Join-Path $package 'ROOTRELEASE_FILES.json') $i
}
function Set-NextRelease($f, [scriptblock]$nextMutate = {}) {
    $script:channel.version='1.2.31'
    $script:channel.archive.url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.31/Lead-Partner-Common-1.2.31.zip'
    Set-Payload $f {
        param($p)
        $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $m.version='1.2.31';Write-Json (Join-Path $p 'manifest.json') $m
        $i=Get-Content (Join-Path $p 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $i.version='1.2.31';Write-Json (Join-Path $p 'ROOTRELEASE_FILES.json') $i
        [IO.File]::WriteAllText((Join-Path $p 'background.js'),'latest-background')
        Reinventory $p
        & $nextMutate $p
    }
}
function Assert-SavedStage($f, [string]$zipHash, [string]$metadata, [string]$version = '1.2.30') {
    Assert ((Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')))) -ceq $zipHash) 'Prior staged archive was replaced'
    Assert ([IO.File]::ReadAllText((Join-Path $f.state 'staged.json')) -ceq $metadata) 'Prior staged metadata was replaced'
    $stagedManifest=Get-Content (Join-Path $f.state 'stage/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($stagedManifest.version -ceq $version) 'Prior expanded stage was replaced'
}
function Test([string]$name,[scriptblock]$body) { if($Only -and $name -notlike $Only){return}; try { & $body; $script:passed++; Write-Output "PASS $name" } catch { $script:failed++; Write-Output "FAIL $name : $($_.Exception.Message)" } }
function New-EntryHarness($f,[switch]$LogicalError) {
    # Copy real runtime; wrap its byte-request boundary in the fixture only, keeping the shipped entry hook-free.
    $entry=Join-Path $f.state 'Update-LeadPartner.ps1'
    [IO.File]::Copy((Join-Path $PSScriptRoot '../client/Update-LeadPartner.ps1'),$entry)
    $runtime=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../client/Updater.Core.ps1'))
    if($LogicalError){$suffix=@'
function Invoke-LeadPartnerUpdate { param([string]$ConfigPath) return [pscustomobject]@{status='error';currentVersion=$null;version=$null;message='fixture logical failure'} }
'@}else{$suffix=@'
$script:EntryOriginalCore=(Get-Command Invoke-LeadPartnerUpdate).ScriptBlock
function Invoke-LeadPartnerUpdate {
    param([string]$ConfigPath)
    & $script:EntryOriginalCore -ConfigPath $ConfigPath -BrowserRunning {$false} -Request {
        param($url)
        if($url -cne 'https://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json'){throw 'Unexpected fixture request'}
        return ,([Text.Encoding]::UTF8.GetBytes('{"schema":1,"channel":"common","version":"1.2.29","repository":"mirher228-droid/lead-partner-updates","archive":{"url":"https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.29/Lead-Partner-Common-1.2.29.zip","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size":1},"publishedAt":"2026-10-27T00:00:00Z"}'))
    }
}
'@}
    [IO.File]::WriteAllText((Join-Path $f.state 'Updater.Core.ps1'),($runtime+[Environment]::NewLine+$suffix),[Text.UTF8Encoding]::new($true))
    return $entry
}
try {
    Test 'actual 90-file Common ZIP updates old manifest in same folder' {
        $f=New-Fixture; $result=Invoke-TestUpdate $f
        Assert ($result.status -eq 'updated') 'Expected updated'; Assert ((Manifest $f).version -eq '1.2.30') 'Version did not advance'
        Assert ((Get-ChildItem -LiteralPath $f.ext -Recurse -File).Count -eq 90) 'Actual ZIP file count changed'
        Assert ((Get-FileHash -LiteralPath (Join-Path $f.ext 'background.js')).Hash.ToLowerInvariant() -eq $script:expectedBackground) 'New code missing'
    }
    Test 'stages with browser open and applies staged bytes offline after close' {
        $f=New-Fixture; $r=Invoke-TestUpdate $f {$true}; Assert ($r.status -eq 'staged') 'Expected staged'; Assert ((Manifest $f).version -eq '1.2.29') 'Open browser was modified'
        $script:channelChecks=0;$script:request={param($url) $script:channelChecks++;throw 'offline'}; $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated') 'Saved stage not applied offline'; Assert ((Manifest $f).version -eq '1.2.30') 'Saved version not applied'
        Assert ($script:channelChecks -eq 1) 'Saved stage bypassed the fresh channel check'
    }
    Test 'refreshes Friday stage to Monday latest before closed-browser apply' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        Set-NextRelease $f
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and $r.version -eq '1.2.31') 'Applied old stage instead of latest release'
        Assert ((Manifest $f).version -eq '1.2.31') 'Latest manifest was not installed'
        Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'background.js')) -ceq 'latest-background') 'Latest package content was not installed'
    }
    Test 'replaces pending stage with validated latest while browser stays open' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        Set-NextRelease $f
        $r=Invoke-TestUpdate $f {$true}
        Assert ($r.status -eq 'staged' -and $r.version -eq '1.2.31') 'Latest release did not replace pending stage'
        Assert ((Manifest $f).version -eq '1.2.29') 'Open browser extension changed'
        $saved=Get-Content (Join-Path $f.state 'staged.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert ($saved.version -eq '1.2.31') 'Latest stage metadata was not saved'
        Assert ((Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')))) -ceq $script:channel.archive.sha256) 'Latest stage archive was not saved'
        $script:request={param($url) throw 'offline'};$r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.31') 'Latest saved stage did not survive offline application'
    }
    Test 'unchanged channel reuses saved archive without another package download' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $script:channelChecks=0;$script:request={param($url)
            if($url -cne $script:LpEndpoint){throw 'Unexpected package redownload'}
            $script:channelChecks++;return ,([Text.Encoding]::UTF8.GetBytes(($script:channel | ConvertTo-Json -Depth 10)))
        }
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Unchanged release did not use saved bytes'
        Assert ($script:channelChecks -eq 1) 'Unchanged staged release skipped channel check'
    }
    Test 'offline open-browser retry preserves complete verified stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        $script:channelChecks=0;$script:request={param($url) $script:channelChecks++;throw 'offline'}
        $r=Invoke-TestUpdate $f {$true}
        Assert ($r.status -eq 'staged') 'Offline retry discarded valid pending stage'
        Assert ($script:channelChecks -eq 1) 'Offline retry skipped channel check'
        Assert-SavedStage $f $hash $metadata
        Assert ((Manifest $f).version -eq '1.2.29') 'Offline retry modified open browser extension'
    }
    Test 'recovers interrupted staged archive promotion before offline apply' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $candidate=Join-Path $f.state 'candidate';[void][IO.Directory]::CreateDirectory($candidate)
        [IO.File]::Copy((Join-Path $f.state 'staged.zip'),(Join-Path $candidate 'previous.zip'))
        Set-NextRelease $f
        [IO.File]::WriteAllBytes((Join-Path $f.state 'staged.zip'),$script:payload)
        $script:request={param($url) throw 'offline'}
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Interrupted stage promotion lost offline fallback'
    }
    Test 'failed staged metadata save restores prior archive and expanded stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f
        $blocked=[IO.File]::Open((Join-Path $f.state 'staged.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {Must-Reject $f;Assert-SavedStage $f $hash $metadata}finally{$blocked.Dispose()}
        $script:request={param($url) throw 'offline'};$r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Failed metadata save left no usable fallback'
    }
    Test 'invalid fresh metadata falls back to verified saved stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $script:channelChecks=0;$script:request={param($url) $script:channelChecks++;return ,([Text.Encoding]::UTF8.GetBytes('{"schema":99}'))}
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Invalid metadata destroyed valid fallback'
        Assert ($script:channelChecks -eq 1) 'Invalid metadata was never checked'
    }
    Test 'newer archive hash failure preserves prior stage and installed files' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f;$script:channel.archive.sha256='0'*64
        Must-Reject $f;Assert-SavedStage $f $hash $metadata
        Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'background.js')) -ceq 'old-background') 'Corrupt latest release changed installed content'
        $script:request={param($url) throw 'offline'};$r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Prior stage was not usable after rejected latest archive'
    }
    Test 'newer archive inventory failure preserves prior expanded stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f {param($p) [IO.File]::AppendAllText((Join-Path $p 'background.js'),'tampered')}
        Must-Reject $f;Assert-SavedStage $f $hash $metadata
    }
    Test 'newer archive permission expansion preserves prior stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$m.permissions=@($m.permissions)+@('nativeMessaging');Write-Json (Join-Path $p 'manifest.json') $m;Reinventory $p}
        Must-Reject $f;Assert-SavedStage $f $hash $metadata
    }
    Test 'newer archive identity change preserves prior stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$m | Add-Member -Force -NotePropertyName key -NotePropertyValue 'new-identity';Write-Json (Join-Path $p 'manifest.json') $m;Reinventory $p}
        Must-Reject $f;Assert-SavedStage $f $hash $metadata
    }
    Test 'newer archive download failure preserves prior stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $hash=Sha ([IO.File]::ReadAllBytes((Join-Path $f.state 'staged.zip')));$metadata=[IO.File]::ReadAllText((Join-Path $f.state 'staged.json'))
        Set-NextRelease $f;$script:request={param($url) if($url -ceq $script:LpEndpoint){return ,([Text.Encoding]::UTF8.GetBytes(($script:channel | ConvertTo-Json -Depth 10)))};throw 'archive unavailable'}
        Must-Reject $f;Assert-SavedStage $f $hash $metadata
    }
    Test 'lower channel cannot replace a newer verified stage' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $script:channel.version='1.2.28';$script:channel.archive.url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.28/Lead-Partner-Common-1.2.28.zip'
        $script:channelChecks=0;$script:request={param($url) if($url -cne $script:LpEndpoint){throw 'Downgrade download attempted'};$script:channelChecks++;return ,([Text.Encoding]::UTF8.GetBytes(($script:channel | ConvertTo-Json -Depth 10)))}
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'updated' -and (Manifest $f).version -eq '1.2.30') 'Lower channel replaced newer pending release'
        Assert ($script:channelChecks -eq 1) 'Lower channel was never checked'
    }
    Test 'saved stage cannot downgrade a manually upgraded installation' {
        $f=New-Fixture;Invoke-TestUpdate $f {$true} | Out-Null
        $m=Manifest $f;$m.version='1.2.31';Write-Json (Join-Path $f.ext 'manifest.json') $m
        $i=Get-Content (Join-Path $f.ext 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$i.version='1.2.31';Write-Json (Join-Path $f.ext 'ROOTRELEASE_FILES.json') $i
        $r=Invoke-TestUpdate $f
        Assert ($r.status -eq 'current' -and (Manifest $f).version -eq '1.2.31') 'Pending release downgraded manual upgrade'
        Assert (-not (Test-Path (Join-Path $f.state 'staged.zip'))) 'Obsolete pending archive was retained'
    }
    Test 'checks browser again immediately before first extension write' {
        $f=New-Fixture; $script:browserCalls=0; $r=Invoke-TestUpdate $f { $script:browserCalls++; return ($script:browserCalls -gt 1) }
        Assert ($r.status -eq 'deferred') 'Browser reopening was ignored'; Assert ((Manifest $f).version -eq '1.2.29') 'Reopened browser was modified'
    }
    Test 'preserves local sources config and existing extension key' {
        $f=New-Fixture; $local='{ "local": "employee override" }'; [IO.File]::WriteAllText((Join-Path $f.ext 'sources-config.json'),$local)
        $m=Manifest $f; $m | Add-Member key 'LOCAL-EXISTING-KEY'; Write-Json (Join-Path $f.ext 'manifest.json') $m
        [IO.File]::WriteAllText((Join-Path $f.ext 'employee-note.txt'),'keep')
        Invoke-TestUpdate $f | Out-Null
        Assert ((Manifest $f).key -eq 'LOCAL-EXISTING-KEY') 'Existing key lost'; Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'sources-config.json')) -ceq $local) 'Local source override changed'
        Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'employee-note.txt')) -eq 'keep') 'Unmanaged local file deleted'
    }
    Test 'rejects hash corruption without writes' { $f=New-Fixture; $script:channel.archive.sha256=('0'*64); Must-Reject $f }
    Test 'rejects size mismatch' { $f=New-Fixture; $script:channel.archive.size++; Must-Reject $f }
    Test 'rejects arbitrary repository in config' { $f=New-Fixture; $c=Get-Content $f.config -Raw | ConvertFrom-Json; $c.repository='attacker/repo'; Write-Json $f.config $c; Must-Reject $f }
    Test 'rejects arbitrary repository in channel' { $f=New-Fixture; $script:channel.repository='attacker/repo'; Must-Reject $f }
    Test 'rejects arbitrary HTTPS host' { $f=New-Fixture; $script:channel.archive.url='https://evil.example/update.zip'; Must-Reject $f }
    Test 'rejects wrong release asset path' { $f=New-Fixture; $script:channel.archive.url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.30/other.zip'; Must-Reject $f }
    Test 'rejects HTTP transport' { $f=New-Fixture; $script:channel.archive.url=$script:channel.archive.url.Replace('https:','http:'); Must-Reject $f }
    Test 'rejects unknown channel schema' { $f=New-Fixture; $script:channel.schema=2; Must-Reject $f }
    Test 'rejects schema represented as a string' { $f=New-Fixture; $script:channel.schema='1'; Must-Reject $f }
    Test 'rejects null archive size' { $f=New-Fixture; $script:channel.archive.size=$null; Must-Reject $f }
    Test 'rejects malformed version' { $f=New-Fixture; $script:channel.version='1.2.30-beta'; Must-Reject $f }
    Test 'does not downgrade' { $f=New-Fixture; $script:channel.version='1.2.28'; $script:channel.archive.url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.28/Lead-Partner-Common-1.2.28.zip'; $r=Invoke-TestUpdate $f; Assert ($r.status -eq 'current') 'Downgrade attempted'; Assert ((Manifest $f).version -eq '1.2.29') 'Local version downgraded' }
    Test 'rejects path traversal ZIP' {
        $f=New-Fixture; $zip=Join-Path $f.base 'slip.zip'; [IO.File]::WriteAllBytes($zip,$script:original); $z=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
        try { $e=$z.CreateEntry('../escaped.txt'); $w=[IO.StreamWriter]::new($e.Open()); $w.Write('escaped'); $w.Dispose() } finally {$z.Dispose()}
        $script:payload=[IO.File]::ReadAllBytes($zip); $script:channel.archive.sha256=Sha $script:payload; $script:channel.archive.size=$script:payload.Length
        Must-Reject $f; Assert (-not (Test-Path -LiteralPath (Join-Path $f.base 'escaped.txt'))) 'ZIP escaped stage'
    }
    Test 'rejects case duplicate ZIP' {
        $f=New-Fixture; $zip=Join-Path $f.base 'duplicate.zip'; [IO.File]::WriteAllBytes($zip,$script:original); $z=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
        try { $e=$z.CreateEntry('Lead-Partner-Common/MANIFEST.JSON'); $w=[IO.StreamWriter]::new($e.Open()); $w.Write('{}'); $w.Dispose() } finally {$z.Dispose()}
        $script:payload=[IO.File]::ReadAllBytes($zip); $script:channel.archive.sha256=Sha $script:payload; $script:channel.archive.size=$script:payload.Length; Must-Reject $f
    }
    Test 'rejects ZIP symlink attributes' {
        $f=New-Fixture; $zip=Join-Path $f.base 'symlink.zip'; [IO.File]::WriteAllBytes($zip,$script:original); $z=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
        try {$e=$z.CreateEntry('Lead-Partner-Common/link.js'); $e.ExternalAttributes=-1577058304} finally {$z.Dispose()}
        $script:payload=[IO.File]::ReadAllBytes($zip); $script:channel.archive.sha256=Sha $script:payload; $script:channel.archive.size=$script:payload.Length; Must-Reject $f
    }
    Test 'rejects unlisted artifact' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::WriteAllText((Join-Path $p 'extra.js'),'x')}; Must-Reject $f }
    Test 'rejects executable artifact even if inventoried' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::WriteAllText((Join-Path $p 'run.exe'),'x')}; Must-Reject $f }
    Test 'rejects Admin artifact' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::WriteAllText((Join-Path $p 'admin-panel.js'),'x')}; Must-Reject $f }
    Test 'rejects private key artifact' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::WriteAllText((Join-Path $p 'private-key.pem'),'x')}; Must-Reject $f }
    Test 'rejects unsupported extension even when inventoried' {
        $f=New-Fixture;Set-Payload $f {param($p) [IO.File]::Move((Join-Path $p 'background.js'),(Join-Path $p 'background.sh'));$i=Get-Content (Join-Path $p 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json;foreach($file in $i.files){if($file.path -eq 'background.js'){$file.path='background.sh'}};Write-Json (Join-Path $p 'ROOTRELEASE_FILES.json') $i;Reinventory $p};Must-Reject $f
    }
    Test 'rejects private SSH filename even when inventoried' {
        $f=New-Fixture;Set-Payload $f {param($p) [IO.File]::Move((Join-Path $p 'background.js'),(Join-Path $p 'id_rsa.txt'));$i=Get-Content (Join-Path $p 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json;foreach($file in $i.files){if($file.path -eq 'background.js'){$file.path='id_rsa.txt'}};Write-Json (Join-Path $p 'ROOTRELEASE_FILES.json') $i;Reinventory $p};Must-Reject $f
    }
    Test 'rejects secret content in inventoried JavaScript' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::WriteAllText((Join-Path $p 'background.js'),'-----BEGIN PRIVATE KEY-----'); Reinventory $p}; Must-Reject $f }
    Test 'rejects expanded file size limit' {$f=New-Fixture; Set-Payload $f {param($p) $stream=[IO.File]::Create((Join-Path $p 'background.js'));try{$stream.SetLength(21MB)}finally{$stream.Dispose()};Reinventory $p};Must-Reject $f}
    Test 'rejects excessive compression ratio' {$f=New-Fixture; Set-Payload $f {param($p) $stream=[IO.File]::Create((Join-Path $p 'background.js'));try{$stream.SetLength(5MB)}finally{$stream.Dispose()};Reinventory $p};Must-Reject $f}
    Test 'rejects invalid inventory hash' { $f=New-Fixture; Set-Payload $f {param($p) [IO.File]::AppendAllText((Join-Path $p 'background.js'),'tamper')}; Must-Reject $f }
    Test 'rejects inventory version mismatch' { $f=New-Fixture; Set-Payload $f {param($p) $i=Get-Content (Join-Path $p 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json; $i.version='1.2.31'; Write-Json (Join-Path $p 'ROOTRELEASE_FILES.json') $i}; Must-Reject $f }
    Test 'rejects incoming Admin manifest' { $f=New-Fixture; Set-Payload $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json; $m.name='Lead-Partner Admin'; Write-Json (Join-Path $p 'manifest.json') $m; Reinventory $p}; Must-Reject $f }
    Test 'rejects required permission expansion' { $f=New-Fixture;Set-Payload $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$m.permissions=@($m.permissions)+@('nativeMessaging');Write-Json (Join-Path $p 'manifest.json') $m;Reinventory $p};Must-Reject $f }
    Test 'rejects host permission expansion' { $f=New-Fixture;Set-Payload $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$m | Add-Member -Force -NotePropertyName host_permissions -NotePropertyValue @('https://attacker.example/*');Write-Json (Join-Path $p 'manifest.json') $m;Reinventory $p};Must-Reject $f }
    Test 'rejects content script match expansion' { $f=New-Fixture;Set-Payload $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$m | Add-Member -Force -NotePropertyName content_scripts -NotePropertyValue @(@{matches=@('https://attacker.example/*');js=@('background.js')});Write-Json (Join-Path $p 'manifest.json') $m;Reinventory $p};Must-Reject $f }
    Test 'rejects incoming conflicting extension key' { $f=New-Fixture; $m=Manifest $f; $m | Add-Member key 'old-key'; Write-Json (Join-Path $f.ext 'manifest.json') $m; Set-Payload $f {param($p) $m=Get-Content (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json; $m | Add-Member key 'different-key'; Write-Json (Join-Path $p 'manifest.json') $m; Reinventory $p}; Must-Reject $f }
    Test 'rejects existing Admin install' { $f=New-Fixture; $m=Manifest $f; $m.name='Lead-Partner Admin'; Write-Json (Join-Path $f.ext 'manifest.json') $m; Must-Reject $f }
    Test 'exclusive lock defers concurrent update' { $f=New-Fixture; $lock=[IO.File]::Open((Join-Path $f.state 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); try {$r=Invoke-TestUpdate $f; Assert ($r.status -eq 'deferred') 'Concurrent lock ignored'; Assert ((Manifest $f).version -eq '1.2.29') 'Locked update wrote extension'} finally {$lock.Dispose()} }
    Test 'write rejection rolls back earlier writes and old manifest' {
        $f=New-Fixture; $before=[IO.File]::ReadAllBytes((Join-Path $f.ext 'background.js')); [IO.File]::WriteAllText((Join-Path $f.ext 'background.js'),'OLD-BACKGROUND')
        $blocked=[IO.File]::Open((Join-Path $f.ext 'popup.js'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {Must-Reject $f; Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'background.js')) -eq 'OLD-BACKGROUND') 'Earlier changed file not rolled back'; Assert (-not (Test-Path (Join-Path $f.state 'journal.json'))) 'Completed rollback left journal'} finally {$blocked.Dispose()}
    }
    Test 'recovers interrupted transaction before continuing' {
        $f=New-Fixture;$manifestPath=Join-Path $f.ext 'manifest.json';$oldBytes=[IO.File]::ReadAllBytes($manifestPath)
        $backup=Join-Path $f.state 'backup';[void][IO.Directory]::CreateDirectory($backup);[IO.File]::WriteAllBytes((Join-Path $backup 'manifest.json'),$oldBytes)
        Write-Json (Join-Path $f.state 'journal.json') @{schema=1;extensionPath=$f.ext;fromVersion='1.2.29';toVersion='1.2.30';entries=@(@{path='manifest.json';existed=$true;sha256=(Sha $oldBytes)})}
        [IO.File]::WriteAllText($manifestPath,'broken partial manifest');$script:request={param($url) throw 'offline-after-recovery'}
        $failed=$false;try{Invoke-TestUpdate $f | Out-Null}catch{$failed=$true};Assert $failed 'Expected offline after recovery';Assert ((Manifest $f).version -eq '1.2.29') 'Interrupted update not recovered';Assert (-not (Test-Path (Join-Path $f.state 'journal.json'))) 'Recovery journal still present'
    }
    Test 'defers interrupted recovery while browser runs' {
        $f=New-Fixture;[IO.File]::WriteAllText((Join-Path $f.state 'journal.json'),'{}');$r=Invoke-TestUpdate $f {$true};Assert ($r.status -eq 'deferred') 'Recovery ignored open browser';Assert ((Manifest $f).version -eq '1.2.29') 'Open browser recovery wrote files'
    }
    Test 'midapply browser reopens and journal waits until closed' {
        $f=New-Fixture;$script:watchedBackground=Join-Path $f.ext 'background.js'
        $r=Invoke-TestUpdate $f {return ([IO.File]::ReadAllText($script:watchedBackground) -cne 'old-background')}
        Assert ($r.status -eq 'deferred') 'Midapply browser reopening was not deferred';Assert (Test-Path (Join-Path $f.state 'journal.json')) 'Pending transaction journal was lost'
        Assert ([IO.File]::ReadAllText($script:watchedBackground) -cne 'old-background') 'Rollback wrote while browser was active';Assert ((Manifest $f).version -eq '1.2.29') 'Manifest committed during partial apply'
        $script:request={param($url) throw 'offline'};$r=Invoke-TestUpdate $f;Assert ($r.status -eq 'updated') 'Closed-browser recovery did not complete'
    }
    Test 'recovery browser reopens before first restore mutation' {
        $f=New-Fixture;$manifestPath=Join-Path $f.ext 'manifest.json';$oldBytes=[IO.File]::ReadAllBytes($manifestPath)
        $backup=Join-Path $f.state 'backup';[void][IO.Directory]::CreateDirectory($backup);[IO.File]::WriteAllBytes((Join-Path $backup 'manifest.json'),$oldBytes)
        Write-Json (Join-Path $f.state 'journal.json') @{schema=1;extensionPath=$f.ext;fromVersion='1.2.29';toVersion='1.2.30';entries=@(@{path='manifest.json';existed=$true;sha256=(Sha $oldBytes)})}
        [IO.File]::WriteAllText($manifestPath,'partial');$script:recoveryCalls=0
        $r=Invoke-TestUpdate $f {$script:recoveryCalls++;return ($script:recoveryCalls -gt 1)}
        Assert ($r.status -eq 'deferred') 'Recovery reopening was ignored';Assert ([IO.File]::ReadAllText($manifestPath) -eq 'partial') 'Recovery mutated open-browser files';Assert (Test-Path (Join-Path $f.state 'journal.json')) 'Deferred recovery lost journal'
        $r=Invoke-TestUpdate $f;Assert ($r.status -eq 'updated') 'Closed browser did not finish recovery/update'
    }
    Test 'midrollback browser reopens and remaining restore waits' {
        $f=New-Fixture;$script:watchedBackground=Join-Path $f.ext 'background.js';$script:sawNewBackground=$false
        $secondChanged=Join-Path $f.ext 'file-001.js';if(-not (Test-Path -LiteralPath $secondChanged)){$secondChanged=Join-Path $f.ext 'crm-auto-house.js'};[IO.File]::WriteAllText($secondChanged,'old-second-file')
        $blocked=[IO.File]::Open((Join-Path $f.ext 'popup.js'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
            $r=Invoke-TestUpdate $f {if([IO.File]::ReadAllText($script:watchedBackground) -cne 'old-background'){$script:sawNewBackground=$true;return $false};return $script:sawNewBackground}
            Assert ($r.status -eq 'deferred') 'Rollback reopening was not deferred';Assert (Test-Path (Join-Path $f.state 'journal.json')) 'Partial rollback lost journal';Assert ((Manifest $f).version -eq '1.2.29') 'Partial rollback changed manifest'
        }finally{$blocked.Dispose()}
        $script:request={param($url) throw 'offline'};$r=Invoke-TestUpdate $f;Assert ($r.status -eq 'updated') 'Closed-browser partial rollback recovery failed'
    }
    Test 'rejects extension tree junction before apply' {
        $f=New-Fixture;$outside=Join-Path $f.base 'outside';[void][IO.Directory]::CreateDirectory($outside);$link=Join-Path $f.ext 'linked'
        New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
        try {Must-Reject $f} finally {[IO.Directory]::Delete($link)}
    }
    Test 'entry reports error exit and bounds local logs' {
        $f=New-Fixture;$c=Get-Content $f.config -Raw | ConvertFrom-Json;$c.schema=99;Write-Json $f.config $c
        [IO.File]::WriteAllText((Join-Path $f.state 'updater.log'),('x'*270000))
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '../client/Update-LeadPartner.ps1') -ConfigPath $f.config | Out-Null
        Assert ($LASTEXITCODE -eq 1) 'Entry failed to return nonzero error exit';$status=Get-Content (Join-Path $f.state 'status.json') -Raw | ConvertFrom-Json;Assert ($status.result.status -eq 'error') 'Entry did not save error status'
        Assert ((Get-Item (Join-Path $f.state 'updater.log')).Length -lt 8192) 'Current log not rotated';Assert ((Get-Item (Join-Path $f.state 'updater.previous.log')).Length -eq 270000) 'Previous bounded log missing'
    }
    Test 'entry default config works through actual PowerShell File invocation' {
        $f=New-Fixture;$entry=New-EntryHarness $f;$before=[IO.File]::ReadAllText((Join-Path $f.ext 'manifest.json'))
        $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $entry
        Assert ($LASTEXITCODE -eq 0) 'Default-config entry returned error';$result=$output | ConvertFrom-Json;Assert ($result.status -eq 'current') 'Default-config entry did not run against own current fixture'
        $status=Get-Content (Join-Path $f.state 'status.json') -Raw | ConvertFrom-Json;Assert ($status.result.status -eq 'current') 'Default-config entry did not save current status'
        Assert ([IO.File]::ReadAllText((Join-Path $f.ext 'manifest.json')) -ceq $before) 'Current entry mutated extension'
    }
    Test 'entry logical error result exits nonzero without exception' {
        $f=New-Fixture;$entry=New-EntryHarness $f -LogicalError
        $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $entry -ConfigPath $f.config
        Assert ($LASTEXITCODE -eq 1) 'Logical core error returned successful exit';$result=$output | ConvertFrom-Json;Assert ($result.status -eq 'error') 'Logical error result was lost'
        $status=Get-Content (Join-Path $f.state 'status.json') -Raw | ConvertFrom-Json;Assert ($status.result.status -eq 'error') 'Logical error was not saved'
    }
} finally {
    Write-Output "RESULT $script:passed passed, $script:failed failed"
    if($env:LP_KEEP_TEST_FIXTURES -ne '1') {[IO.Directory]::Delete($script:testRoot,$true)} else {Write-Output "Fixtures: $script:testRoot"}
}
if($script:failed -gt 0) {exit 1}
