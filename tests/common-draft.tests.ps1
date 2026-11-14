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
    $policy = [pscustomobject]@{ReleaseId=[int64]41;SourceCommit=('a' * 40);ObservedTag='untagged-f2b4962be5a405f2bea1';ObservedTarget=('c' * 40);CreatedAt='2026-11-14T05:28:47Z';Assets=(Copy-Value $assets)}
    $release = [pscustomobject]@{id=[int64]41;tag_name='common-v1.2.51';target_commitish=$policy.SourceCommit;draft=$true;prerelease=$false;created_at='2026-11-14T05:28:47Z';author=[pscustomobject]@{login='github-actions[bot]'};body="# Approved notes`nExact shared-panel release.";assets=$assets}
    $proof = @{CurrentCommit=('b' * 40);NotesPrefix="# Approved notes`nExact shared-panel release.";ExpectedArchiveSha256=$hash;ExpectedArchiveSize=[int64]$size;RecoveryPolicy=$policy}
    $payload = @{ArchivePath=$archive;SetupPath=$setup;ChannelPath=$channelPath;ExpectedArchiveSha256=$hash;ExpectedArchiveSize=[int64]$size;ExpectedSetupContents=[pscustomobject]$setupHashes}
    return [pscustomobject]@{Root=$root;Release=$release;Proof=$proof;Payload=$payload;Policy=$policy}
}
function Prepare-State($Fixture) {
    $script:state = [pscustomobject]@{Release=(Copy-Value $Fixture.Release);Events=[Collections.Generic.List[string]]::new();Patches=[Collections.Generic.List[object]]::new();SourceSame=$true;ChannelReady=$true;TagExists=$false;ChangeStamp=$false;ObservedTag=$Fixture.Policy.ObservedTag}
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
    # This is the observed GitHub behavior, not a mock that silently preserves
    # every unspecified field. Target-only PATCH changed our real draft tag.
    if ($body.ContainsKey('target_commitish')) { $script:state.Release.target_commitish = $body.target_commitish }
    if ($body.ContainsKey('tag_name')) { $script:state.Release.tag_name = $body.tag_name }
    elseif ($body.ContainsKey('target_commitish')) { $script:state.Release.tag_name = $script:state.ObservedTag }
    if ($body.ContainsKey('draft')) { $script:state.Release.draft = $body.draft }
    if ($body.ContainsKey('make_latest')) { Assert ($body.make_latest -is [string] -and $body.make_latest -ceq 'true') 'make_latest must be the string true.' }
    if ($body.ContainsKey('tag_name') -and $body.ContainsKey('target_commitish') -and $body.ContainsKey('draft')) { $script:state.Events.Add('patch-atomic-publish') }
    elseif ($body.ContainsKey('target_commitish')) { $script:state.Events.Add('patch-target-only') }
    else { $script:state.Events.Add('patch-other') }
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
        Assert ($p.ObservedTag -ceq 'untagged-f2b4962be5a405f2bea1' -and $p.ObservedTarget -ceq '78541ea463fe385de555fa6a3b68c3a842f57638') 'Observed recovery pair changed.'
        Assert (($p.Assets.id -join ',') -ceq '746419755,746419753,746419751') 'Recovery asset IDs changed.'
        Assert ($p.Assets[0].digest -ceq 'sha256:492da594fe9791a37bfe4a9a235a792da56f6fb3dfb262704f758b408cf14dac' -and $p.Assets[0].size -eq 525177) 'Recovery archive proof changed.'
    }
    Check 'unpublished draft is selected from REST list without a Git ref and published by ID' {
        $f=Fixture; Prepare-State $f
        $selected=Select-CommonDraftRelease -Releases @($f.Release) -Proof $f.Proof
        Assert ($selected.id -eq 41 -and -not $script:state.TagExists) 'Draft selection requires an existing Git ref.'
        $result=Publish-Fixture $f
        Assert (-not $result.draft -and $result.target_commitish -ceq $f.Proof.CurrentCommit) 'Verified draft was not activated.'
        Assert (($script:state.Events -join ',') -ceq 'read-id,source-proof,channel-proof,read-id,channel-proof,patch-atomic-publish') 'Unexpected proof/mutation order.'
        Assert ($script:state.Patches.Count -eq 1) 'Resume must use exactly one atomic mutation.'
        $patch=$script:state.Patches[0]
        $fields=@($patch.PSObject.Properties.Name | Sort-Object)
        Assert ($fields.Count -eq 4 -and ($fields -join ',') -ceq 'draft,make_latest,tag_name,target_commitish') 'Atomic publication must have exactly four explicit fields.'
        Assert ($patch.tag_name -ceq 'common-v1.2.51' -and $patch.target_commitish -ceq $f.Proof.CurrentCommit -and $patch.draft -is [bool] -and $patch.draft -eq $false -and $patch.make_latest -is [string] -and $patch.make_latest -ceq 'true') 'Atomic publication fields were not explicitly pinned.'
    }
    Check 'negative control reproduces target-only PATCH changing the backend tag' {
        $f=Fixture; $f.Proof.CurrentCommit=$f.Policy.ObservedTarget; Prepare-State $f; $proof=$f.Proof
        $legacyReply=& $patchRelease $f.Release.id @{target_commitish=$f.Proof.CurrentCommit}
        Assert ($legacyReply.tag_name -ceq $f.Policy.ObservedTag -and $legacyReply.draft) 'The API mock must reproduce the actual unpublished tag fallback.'
        Rejected { Assert-CommonDraftMetadata -Release $legacyReply @proof -RequireCurrentTarget } 'tag|target|pair'
        Assert ($script:state.Patches.Count -eq 1 -and $script:state.Events -notcontains 'patch-atomic-publish') 'The old split protocol unexpectedly published.'
    }
    Check 'the observed alias is selected by pinned ID and restored only by atomic publication' {
        $f=Fixture; $f.Release.tag_name=$f.Policy.ObservedTag; $f.Release.target_commitish=$f.Policy.ObservedTarget; Prepare-State $f
        $selected=Select-CommonDraftRelease -Releases @($f.Release) -Proof $f.Proof
        Assert ($selected.id -eq 41 -and $selected.tag_name -ceq $f.Policy.ObservedTag) 'The pinned alias draft was ignored.'
        $published=Publish-Fixture $f
        Assert (-not $published.draft -and $published.tag_name -ceq 'common-v1.2.51' -and $published.target_commitish -ceq $f.Proof.CurrentCommit -and $script:state.Patches.Count -eq 1) 'Observed recovery did not use one approved transition.'
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
        @{Name='foreign target';Change={param($r)$r.target_commitish=('d'*40)};Pattern='target'},
        @{Name='canonical tag with observed intermediate target';Change={param($r)$r.target_commitish=('c'*40)};Pattern='pair'},
        @{Name='arbitrary alias with observed target';Change={param($r)$r.tag_name='untagged-other';$r.target_commitish=('c'*40)};Pattern='pair'},
        @{Name='observed alias with original target';Change={param($r)$r.tag_name='untagged-f2b4962be5a405f2bea1'};Pattern='pair'},
        @{Name='observed alias with arbitrary intermediate';Change={param($r)$r.tag_name='untagged-f2b4962be5a405f2bea1';$r.target_commitish=('d'*40)};Pattern='pair'},
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
    Check 'a pinned alias plus another approved-tag release is a hard conflict' {
        $f=Fixture; Prepare-State $f
        $f.Release.tag_name=$f.Policy.ObservedTag;$f.Release.target_commitish=$f.Policy.ObservedTarget
        $other=Copy-Value $f.Release;$other.id=77;$other.tag_name='common-v1.2.51';$other.target_commitish=$f.Proof.CurrentCommit
        Rejected { Select-CommonDraftRelease -Releases @($f.Release,$other) -Proof $f.Proof } 'conflicting'
        Assert ($script:state.Patches.Count -eq 0) 'Conflicting release selection caused a mutation.'
    }
    Check 'known ID with an arbitrary alias cannot disappear into fresh draft creation' {
        $f=Fixture;$f.Release.tag_name='untagged-unknown'
        Rejected { Select-CommonDraftRelease -Releases @($f.Release) -Proof $f.Proof } 'pair'
    }
    Check 'snapshots reject tag or target changes even between individually approved draft pairs' {
        $f=Fixture;$changed=Copy-Value $f.Release
        $changed.tag_name=$f.Policy.ObservedTag;$changed.target_commitish=$f.Policy.ObservedTarget
        Rejected { Assert-CommonDraftAssetsUnchanged -Before $f.Release -After $changed } 'tag|target'
    }
    Check 'published metadata can never retain an alias tag' {
        $f=Fixture;$proof=$f.Proof;$f.Release.draft=$false;$f.Release.tag_name=$f.Policy.ObservedTag;$f.Release.target_commitish=$f.Proof.CurrentCommit
        Rejected { Assert-CommonDraftMetadata -Release $f.Release @proof -Published -RequireCurrentTarget } 'published tag'
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
    Check 'an unobserved same-current state on the known ID is not legalized' {
        $f=Fixture; $f.Release.target_commitish=$f.Proof.CurrentCommit; Prepare-State $f
        Rejected { Publish-Fixture $f } 'pair'
        Assert ($script:state.Patches.Count -eq 0) 'An unknown prepared state was silently accepted.'
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
