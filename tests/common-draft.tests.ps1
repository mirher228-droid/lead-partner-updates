# Offline contract: no release mutation may precede proof of the three payloads.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/Common.Draft.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('common-draft-tests-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$script:count = 0
function Assert([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message } }
function Rejected([scriptblock]$Action,[string]$Pattern) {
    $message = $null
    try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
    Assert ($null -ne $message) 'Unsafe draft operation was accepted.'
    Assert ($message -match $Pattern) ('Unexpected rejection: ' + $message)
}
function Check([string]$Name,[scriptblock]$Action) { & $Action; $script:count++; Write-Host ('PASS ' + $Name) }
function Copy-Value($Value) { return ($Value | ConvertTo-Json -Depth 30 | ConvertFrom-Json) }
function File-Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Write-Zip([string]$Path,$Files) {
    $zip = [IO.Compression.ZipFile]::Open($Path,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Files.Keys) {
            $entry = $zip.CreateEntry($name)
            $stream = $entry.Open()
            try { $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Files[$name]); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
}
function Fixture {
    $root = Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $archive = Join-Path $root 'Lead-Partner-Common-1.2.51.zip'
    $files = [ordered]@{
        'manifest.json'='{"manifest_version":3,"name":"Lead-Partner · Общая","short_name":"LP Общая","version":"1.2.51","background":{"service_worker":"background.js"}}'
        'background.js'='console.log("offline Common fixture");'
        'sources-config.json'='{"url":"https://example.test/offline"}'
    }
    $inventory = @()
    $zipped = [ordered]@{}
    foreach ($name in $files.Keys) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($files[$name])
        $inventory += [ordered]@{path=$name;sha256=(Get-ReleaseByteHash $bytes)}
        $zipped['Lead-Partner-Common/' + $name] = $files[$name]
    }
    $zipped['Lead-Partner-Common/ROOTRELEASE_FILES.json'] = ([ordered]@{schemaVersion=1;version='1.2.51';files=$inventory} | ConvertTo-Json -Depth 10)
    Write-Zip $archive $zipped
    $setup = Join-Path $root 'Lead-Partner-Common-AutoUpdate-Setup.zip'
    $setupFiles = [ordered]@{}; $setupHashes = [ordered]@{}
    foreach ($name in (Get-CommonSetupNames)) {
        $setupFiles[$name] = 'approved Windows source: ' + $name
        $setupHashes[$name] = Get-ReleaseByteHash ([Text.Encoding]::UTF8.GetBytes($setupFiles[$name]))
    }
    Write-Zip $setup $setupFiles
    $channelPath = Join-Path $root 'update.json'
    $hash = File-Hash $archive; $size = (Get-Item -LiteralPath $archive).Length
    $channel = [ordered]@{schema=1;channel='common';version='1.2.51';repository='mirher228-droid/lead-partner-updates';archive=[ordered]@{url='https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.51/Lead-Partner-Common-1.2.51.zip';sha256=$hash;size=$size};publishedAt='2026-11-14T05:28:47Z'}
    [IO.File]::WriteAllText($channelPath,($channel | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $assets = @(); $index = 101
    foreach ($path in @($archive,$setup,$channelPath)) {
        $assets += [pscustomobject]@{name=[IO.Path]::GetFileName($path);id=[int64]$index;size=[int64](Get-Item -LiteralPath $path).Length;updated_at='2026-11-14T05:28:48Z';digest=('sha256:' + (File-Hash $path))}
        $index++
    }
    $policy = [pscustomobject]@{ReleaseId=[int64]41;SourceCommit=('a' * 40);CreatedAt='2026-11-14T05:28:47Z';Assets=(Copy-Value $assets)}
    $release = [pscustomobject]@{id=[int64]41;tag_name='common-v1.2.51';target_commitish=$policy.SourceCommit;draft=$true;prerelease=$false;created_at='2026-11-14T05:28:47Z';author=[pscustomobject]@{login='github-actions[bot]'};body="# Approved notes`nExact shared-panel release.";assets=$assets}
    $proof = @{CurrentCommit=('b' * 40);NotesPrefix="# Approved notes`nExact shared-panel release.";ExpectedArchiveSha256=$hash;ExpectedArchiveSize=[int64]$size;RecoveryPolicy=$policy}
    $payload = @{ArchivePath=$archive;SetupPath=$setup;ChannelPath=$channelPath;ExpectedArchiveSha256=$hash;ExpectedArchiveSize=[int64]$size;ExpectedSetupContents=[pscustomobject]$setupHashes}
    return [pscustomobject]@{Root=$root;Release=$release;Proof=$proof;Payload=$payload;Policy=$policy}
}
function Prepare-State($Fixture) {
    $script:state = [pscustomobject]@{Release=(Copy-Value $Fixture.Release);Events=[Collections.Generic.List[string]]::new();Patches=[Collections.Generic.List[object]]::new();SourceSame=$true;ChannelReady=$true;TagExists=$false;ChangeStamp=$false}
}
$readRelease = {
    param($id)
    Assert ([int64]$id -eq [int64]$script:state.Release.id) 'Only REST release ID reads are allowed; no Git tag lookup.'
    $script:state.Events.Add('read-id')
    $value = Copy-Value $script:state.Release
    if ($script:state.ChangeStamp) { $value.assets[0].updated_at = '2026-11-14T05:28:49Z' }
    return $value
}
$patchRelease = {
    param($id,$body)
    Assert ([int64]$id -eq [int64]$script:state.Release.id) 'Mutation used a foreign release ID.'
    $script:state.Patches.Add((Copy-Value ([pscustomobject]$body)))
    if ($body.ContainsKey('target_commitish')) { $script:state.Events.Add('patch-target'); $script:state.Release.target_commitish = $body.target_commitish }
    else {
        Assert ($body.draft -eq $false -and $body.make_latest -is [string] -and $body.make_latest -ceq 'true') 'Publication must use draft=false and string make_latest=true.'
        $script:state.Events.Add('patch-publish'); $script:state.Release.draft=$false
    }
    return (Copy-Value $script:state.Release)
}
$sourceProof = { param($before,$after); $script:state.Events.Add('source-proof'); return [bool]$script:state.SourceSame }
$channelProof = { $script:state.Events.Add('channel-proof'); return [bool]($script:state.ChannelReady -and -not $script:state.TagExists) }
function Publish-Fixture($Fixture,[switch]$CreatedThisRun) {
    Invoke-CommonDraftPublication -InitialRelease $Fixture.Release -Proof $Fixture.Proof -Payload $Fixture.Payload -ReadRelease $readRelease -PatchRelease $patchRelease -AssertSourceUnchanged $sourceProof -AssertChannelReady $channelProof -CreatedThisRun:$CreatedThisRun
}

try {
    Check 'production recovery pins the exact known draft and assets' {
        $p=Get-CommonDraftRecoveryPolicy
        Assert ($p.ReleaseId -eq 445039752 -and $p.SourceCommit -ceq '9320ec40a3fdf85d0484392bdbcdfad204625112') 'Recovery release identity changed.'
        Assert (($p.Assets.id -join ',') -ceq '746419755,746419753,746419751') 'Recovery asset IDs changed.'
        Assert ($p.Assets[0].digest -ceq 'sha256:492da594fe9791a37bfe4a9a235a792da56f6fb3dfb262704f758b408cf14dac' -and $p.Assets[0].size -eq 525177) 'Recovery archive proof changed.'
    }
    Check 'unpublished draft is selected from REST list without a Git ref and published by ID' {
        $f=Fixture; Prepare-State $f
        $selected=Select-CommonDraftRelease -Releases @($f.Release) -Proof $f.Proof
        Assert ($selected.id -eq 41 -and -not $script:state.TagExists) 'Draft selection requires an existing Git ref.'
        $result=Publish-Fixture $f
        Assert (-not $result.draft -and $result.target_commitish -ceq $f.Proof.CurrentCommit) 'Verified draft was not activated.'
        Assert (($script:state.Events -join ',') -ceq 'read-id,source-proof,channel-proof,patch-target,read-id,channel-proof,patch-publish') 'Unexpected proof/mutation order.'
        Assert ($script:state.Patches.Count -eq 2) 'Resume must only retarget and publish; assets must never be uploaded or replaced.'
    }
    Check 'JSON API roundtrip and DateTime timestamps retain the same pinned UTC instant' {
        $f=Fixture
        $f.Release=Copy-Value $f.Release
        $proof=$f.Proof
        Assert-CommonDraftMetadata -Release $f.Release @proof
        $f.Release.created_at=[DateTime]::Parse('2026-11-14T05:28:47Z').ToUniversalTime()
        foreach($asset in $f.Release.assets){$asset.updated_at=[DateTimeOffset]::Parse('2026-11-14T05:28:48Z')}
        Assert-CommonDraftMetadata -Release $f.Release @proof
    }
    $badMetadata=@(
        @{Name='published release';Change={param($r)$r.draft=$false};Pattern='state'},
        @{Name='prerelease';Change={param($r)$r.prerelease=$true};Pattern='state'},
        @{Name='foreign author';Change={param($r)$r.author.login='someone-else'};Pattern='author'},
        @{Name='foreign release ID';Change={param($r)$r.id=42};Pattern='ID'},
        @{Name='foreign target';Change={param($r)$r.target_commitish=('c'*40)};Pattern='target'},
        @{Name='wrong notes';Change={param($r)$r.body='# Different release'};Pattern='notes'},
        @{Name='appended unapproved notes';Change={param($r)$r.body += "`nUnapproved suffix"};Pattern='notes'},
        @{Name='wrong asset name';Change={param($r)$r.assets[0].name='unexpected.zip'};Pattern='assets'},
        @{Name='changed asset ID';Change={param($r)$r.assets[0].id=999};Pattern='asset'},
        @{Name='changed asset digest';Change={param($r)$r.assets[0].digest=('sha256:'+('f'*64))};Pattern='asset'},
        @{Name='changed asset time';Change={param($r)$r.assets[0].updated_at='2026-11-14T05:28:49Z'};Pattern='asset'}
    )
    foreach($case in $badMetadata){
        Check ('rejects '+$case.Name+' without mutation') {
            $f=Fixture; Prepare-State $f; $change=$case.Change; & $change $f.Release
            Rejected { Publish-Fixture $f } $case.Pattern
            Assert ($script:state.Patches.Count -eq 0) 'Rejected metadata caused a mutation.'
        }
    }
    Check 'duplicate matching drafts are never chosen by guess' {
        $f=Fixture
        Rejected { Select-CommonDraftRelease -Releases @($f.Release,(Copy-Value $f.Release)) -Proof $f.Proof } 'More than one'
    }
    Check 'changed asset stamp between download and reread blocks all mutations' {
        $f=Fixture; Prepare-State $f; $script:state.ChangeStamp=$true
        Rejected { Publish-Fixture $f } 'asset'
        Assert ($script:state.Patches.Count -eq 0) 'Changed asset stamp caused a mutation.'
    }
    Check 'archive proof is checked before any REST read or mutation' {
        $f=Fixture; Prepare-State $f
        [IO.File]::WriteAllText($f.Payload.ArchivePath,'broken archive')
        Rejected { Publish-Fixture $f } 'payload|SHA|size'
        Assert ($script:state.Patches.Count -eq 0 -and $script:state.Events.Count -eq 0) 'Remote action happened before payload proof.'
    }
    Check 'source changes block retargeting and publication' {
        $f=Fixture; Prepare-State $f; $script:state.SourceSame=$false
        Rejected { Publish-Fixture $f } 'sources differ'
        Assert ($script:state.Patches.Count -eq 0) 'Changed product source caused a mutation.'
    }
    Check 'changed latest or newly occupied Git tag blocks mutations' {
        foreach($field in @('ChannelReady','TagExists')){
            $f=Fixture; Prepare-State $f
            if($field -ceq 'TagExists'){$script:state.TagExists=$true}else{$script:state.ChannelReady=$false}
            Rejected { Publish-Fixture $f } 'channel|tag'
            Assert ($script:state.Patches.Count -eq 0) 'Changed stable channel caused a mutation.'
        }
    }
    Check 'resume whose target is already current does not retarget again' {
        $f=Fixture; $f.Release.target_commitish=$f.Proof.CurrentCommit; Prepare-State $f
        Publish-Fixture $f | Out-Null
        Assert ($script:state.Patches.Count -eq 1 -and $script:state.Events -notcontains 'patch-target') 'Current target was unnecessarily rewritten.'
    }
    Check 'new draft requires explicit same-run ownership and still proves all payloads' {
        $f=Fixture; $f.Release.id=77; $f.Release.target_commitish=$f.Proof.CurrentCommit; Prepare-State $f
        Rejected { Publish-Fixture $f } 'Foreign draft ID'
        Publish-Fixture $f -CreatedThisRun | Out-Null
        Assert ($script:state.Patches.Count -eq 1) 'Fresh draft required an unexpected mutation.'
    }
    Check 'different publishedAt values are acceptable only with the same pinned channel semantics' {
        $f=Fixture
        $payload=$f.Payload
        Assert-CommonDraftPayload @payload
        $channel=Get-Content -LiteralPath $f.Payload.ChannelPath -Raw | ConvertFrom-Json
        $channel.publishedAt='2026-11-15T05:28:47Z'
        [IO.File]::WriteAllText($f.Payload.ChannelPath,($channel|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        Assert-CommonDraftPayload @payload
        $channel.version='1.2.50'
        [IO.File]::WriteAllText($f.Payload.ChannelPath,($channel|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        Rejected { Assert-CommonDraftPayload @payload } 'channel'
    }
    Write-Host ('Passed '+$script:count+' Common draft contracts.')
} finally { if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force} }
