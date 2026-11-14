Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release.Common.ps1')

function Get-CommonDraftRecoveryPolicy {
    [pscustomobject]@{
        ReleaseId = [int64]445039752
        SourceCommit = '9320ec40a3fdf85d0484392bdbcdfad204625112'
        ObservedTag = 'untagged-f2b4962be5a405f2bea1'
        ObservedTarget = '78541ea463fe385de555fa6a3b68c3a842f57638'
        CreatedAt = '2026-11-14T05:28:47Z'
        Assets = @(
            [pscustomobject]@{name='Lead-Partner-Common-1.2.51.zip';id=[int64]746419755;size=[int64]525177;updated_at='2026-11-14T05:28:48Z';digest='sha256:492da594fe9791a37bfe4a9a235a792da56f6fb3dfb262704f758b408cf14dac'},
            [pscustomobject]@{name='Lead-Partner-Common-AutoUpdate-Setup.zip';id=[int64]746419753;size=[int64]30250;updated_at='2026-11-14T05:28:47Z';digest='sha256:1741748c0fbae13ba773d15fe451f633a0eb18697f0ca69b501621d7a73de475'},
            [pscustomobject]@{name='update.json';id=[int64]746419751;size=[int64]441;updated_at='2026-11-14T05:28:47Z';digest='sha256:9e8f4941f6ea957a292f5c172900f6f9fb01d212b15e7958e47e86b4e27d994d'}
        )
    }
}

function Get-CommonDraftTimeTicks($Value) {
    if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime.Ticks }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { return ([DateTime]::SpecifyKind($Value,[DateTimeKind]::Utc)).Ticks }
        return $Value.ToUniversalTime().Ticks
    }
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { throw 'Invalid draft timestamp.' }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$parsed)) { throw 'Invalid draft timestamp.' }
    return $parsed.UtcDateTime.Ticks
}

function Get-CommonDraftAuthor($Release) {
    if ($Release.author -is [string]) { return $Release.author }
    return [string]$Release.author.login
}

function Get-CommonDraftNotes([string]$Value) { return $Value.Replace("`r`n","`n").Trim() }

function Test-CommonDraftPreparedState {
    param($Release,[string]$CurrentCommit,$RecoveryPolicy,[switch]$CreatedThisRun)
    if ([int64]$Release.id -eq [int64]$RecoveryPolicy.ReleaseId) {
        return [bool](($Release.tag_name -ceq 'common-v1.2.51' -and $Release.target_commitish -ceq $RecoveryPolicy.SourceCommit) -or
            ($Release.tag_name -ceq $RecoveryPolicy.ObservedTag -and $Release.target_commitish -ceq $RecoveryPolicy.ObservedTarget))
    }
    return [bool]($CreatedThisRun -and $Release.tag_name -ceq 'common-v1.2.51' -and $Release.target_commitish -ceq $CurrentCommit)
}

function Get-CommonSetupNames {
    @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt','SilentRunner.cs','Build-SilentRunner.ps1')
}

function Assert-CommonDraftMetadata {
    param(
        [Parameter(Mandatory=$true)]$Release,
        [Parameter(Mandatory=$true)][string]$CurrentCommit,
        [Parameter(Mandatory=$true)][string]$NotesPrefix,
        [Parameter(Mandatory=$true)][string]$ExpectedArchiveSha256,
        [Parameter(Mandatory=$true)][int64]$ExpectedArchiveSize,
        $RecoveryPolicy = (Get-CommonDraftRecoveryPolicy),
        [switch]$CreatedThisRun,
        [switch]$RequireCurrentTarget,
        [switch]$Published
    )
    if ($CurrentCommit -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedArchiveSha256 -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedArchiveSize -le 0) { throw 'Invalid draft proof inputs.' }
    if ([string]$Release.id -notmatch '^[1-9][0-9]*$') { throw 'Unexpected draft ID.' }
    if ($Release.draft -isnot [bool] -or $Release.draft -ne (-not $Published.IsPresent) -or $Release.prerelease -isnot [bool] -or $Release.prerelease) { throw 'Release is not in the required draft/stable state.' }
    if ((Get-CommonDraftAuthor $Release) -cne 'github-actions[bot]') { throw 'Foreign draft author.' }
    $notes = Get-CommonDraftNotes ([string]$Release.body)
    $prefix = Get-CommonDraftNotes $NotesPrefix
    if (-not $prefix -or $notes -cne $prefix) { throw 'Draft notes do not match the approved body.' }
    $known = [int64]$Release.id -eq [int64]$RecoveryPolicy.ReleaseId
    if (-not $known -and -not $CreatedThisRun) { throw 'Foreign draft ID; only the pinned unpublished draft may resume.' }
    if ($Published) {
        if ($Release.tag_name -cne 'common-v1.2.51' -or $Release.target_commitish -cne $CurrentCommit) { throw 'Unexpected published tag or target commit.' }
    } else {
        if (-not (Test-CommonDraftPreparedState -Release $Release -CurrentCommit $CurrentCommit -RecoveryPolicy $RecoveryPolicy -CreatedThisRun:$CreatedThisRun)) { throw 'Unexpected draft tag/target pair.' }
        if ($RequireCurrentTarget -and ($Release.tag_name -cne 'common-v1.2.51' -or $Release.target_commitish -cne $CurrentCommit)) { throw 'Draft does not use the approved current tag/target.' }
    }
    $assets = @($Release.assets)
    $expectedNames = @('Lead-Partner-Common-1.2.51.zip','Lead-Partner-Common-AutoUpdate-Setup.zip','update.json') | Sort-Object
    $actualNames = @($assets | ForEach-Object { [string]$_.name } | Sort-Object)
    if ($assets.Count -ne 3 -or @(Compare-Object $actualNames $expectedNames -CaseSensitive).Count -ne 0) { throw 'Unexpected draft assets.' }
    foreach ($asset in $assets) {
        if ([string]$asset.id -notmatch '^[1-9][0-9]*$' -or [int64]$asset.size -le 0) { throw 'Invalid draft asset metadata.' }
        [void](Get-CommonDraftTimeTicks $asset.updated_at)
    }
    $archive = @($assets | Where-Object { $_.name -ceq 'Lead-Partner-Common-1.2.51.zip' })[0]
    if ([int64]$archive.size -ne $ExpectedArchiveSize) { throw 'Draft archive size differs from the fresh Windows artifact.' }
    if ($known) {
        if ((Get-CommonDraftTimeTicks $Release.created_at) -ne (Get-CommonDraftTimeTicks $RecoveryPolicy.CreatedAt)) { throw 'Pinned draft creation time changed.' }
        foreach ($expected in $RecoveryPolicy.Assets) {
            $asset = @($assets | Where-Object { $_.name -ceq $expected.name })[0]
            if ([int64]$asset.id -ne [int64]$expected.id -or [int64]$asset.size -ne [int64]$expected.size -or [string]$asset.digest -cne $expected.digest -or (Get-CommonDraftTimeTicks $asset.updated_at) -ne (Get-CommonDraftTimeTicks $expected.updated_at)) { throw ('Pinned draft asset changed: ' + $expected.name) }
        }
        $pinnedArchive = @($RecoveryPolicy.Assets | Where-Object { $_.name -ceq 'Lead-Partner-Common-1.2.51.zip' })[0]
        if ($pinnedArchive.digest -cne ('sha256:' + $ExpectedArchiveSha256)) { throw 'Fresh Windows archive differs from the pinned recovery artifact.' }
    }
}

function Select-CommonDraftRelease {
    param([AllowEmptyCollection()][object[]]$Releases,[hashtable]$Proof,[switch]$CreatedThisRun)
    $policy = if ($Proof.ContainsKey('RecoveryPolicy')) { $Proof.RecoveryPolicy } else { Get-CommonDraftRecoveryPolicy }
    $known = @($Releases | Where-Object { [int64]$_.id -eq [int64]$policy.ReleaseId })
    if ($known.Count -gt 1) { throw 'More than one release uses the pinned ID.' }
    $tagged = @($Releases | Where-Object { $_.tag_name -ceq 'common-v1.2.51' })
    if ($known.Count -eq 1 -and @($tagged | Where-Object { [int64]$_.id -ne [int64]$policy.ReleaseId }).Count -gt 0) { throw 'A conflicting release already uses the approved tag.' }
    $matching = @($tagged)
    if ($known.Count -eq 1) { $matching = @($known) }
    if ($matching.Count -gt 1) { throw 'More than one release uses the requested tag.' }
    if ($matching.Count -eq 0) { return $null }
    Assert-CommonDraftMetadata -Release $matching[0] @Proof -CreatedThisRun:$CreatedThisRun
    return $matching[0]
}

function Assert-CommonDraftAssetsUnchanged {
    param($Before,$After,[switch]$AllowPublishedTransition,[string]$CurrentCommit,$RecoveryPolicy=(Get-CommonDraftRecoveryPolicy),[switch]$CreatedThisRun)
    if ([int64]$Before.id -ne [int64]$After.id -or (Get-CommonDraftAuthor $Before) -cne (Get-CommonDraftAuthor $After) -or (Get-CommonDraftNotes $Before.body) -cne (Get-CommonDraftNotes $After.body)) { throw 'Draft identity or notes changed during verification.' }
    if ($AllowPublishedTransition) {
        if ($CurrentCommit -cnotmatch '^[a-f0-9]{40}$' -or $Before.draft -ne $true -or $After.draft -ne $false -or $After.prerelease -ne $false -or $After.tag_name -cne 'common-v1.2.51' -or $After.target_commitish -cne $CurrentCommit -or -not (Test-CommonDraftPreparedState -Release $Before -CurrentCommit $CurrentCommit -RecoveryPolicy $RecoveryPolicy -CreatedThisRun:$CreatedThisRun)) { throw 'Unexpected published transition.' }
    } elseif ($Before.tag_name -cne $After.tag_name -or $Before.target_commitish -cne $After.target_commitish) { throw 'Draft tag or target changed during verification.' }
    foreach ($old in $Before.assets) {
        $found = @($After.assets | Where-Object { $_.name -ceq $old.name })
        if ($found.Count -ne 1 -or [int64]$found[0].id -ne [int64]$old.id -or [int64]$found[0].size -ne [int64]$old.size -or (Get-CommonDraftTimeTicks $found[0].updated_at) -ne (Get-CommonDraftTimeTicks $old.updated_at)) { throw ('Draft asset changed during verification: ' + $old.name) }
    }
    if (@($Before.assets).Count -ne @($After.assets).Count) { throw 'Draft asset count changed during verification.' }
}

function Assert-CommonDraftPayload {
    param(
        [Parameter(Mandatory=$true)][string]$ArchivePath,
        [Parameter(Mandatory=$true)][string]$SetupPath,
        [Parameter(Mandatory=$true)][string]$ChannelPath,
        [Parameter(Mandatory=$true)][string]$ExpectedArchiveSha256,
        [Parameter(Mandatory=$true)][int64]$ExpectedArchiveSize,
        [Parameter(Mandatory=$true)]$ExpectedSetupContents,
        $PinnedAssets = @()
    )
    $files = @{'Lead-Partner-Common-1.2.51.zip'=$ArchivePath;'Lead-Partner-Common-AutoUpdate-Setup.zip'=$SetupPath;'update.json'=$ChannelPath}
    foreach ($expected in $PinnedAssets) {
        $path = $files[$expected.name]
        if ((Get-Item -LiteralPath $path).Length -ne [int64]$expected.size -or ('sha256:' + (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()) -cne $expected.digest) { throw ('Pinned downloaded payload changed: ' + $expected.name) }
    }
    $validated = Test-CommonArchive -ArchivePath $ArchivePath -Version '1.2.51' -ReleaseTag 'common-v1.2.51' -ExpectedSha256 $ExpectedArchiveSha256
    if ($validated.Size -ne $ExpectedArchiveSize) { throw 'Downloaded archive size differs from the fresh Windows artifact.' }
    $names = @(Get-CommonSetupNames | Sort-Object)
    if (@($ExpectedSetupContents.PSObject.Properties).Count -ne 9) { throw 'Incomplete Windows setup content proof.' }
    $setup = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($SetupPath))
    try {
        $actual = @($setup.Entries | ForEach-Object { $_.FullName } | Sort-Object)
        if ($actual.Count -ne 9 -or @(Compare-Object $actual $names -CaseSensitive).Count -ne 0) { throw 'Unexpected setup payload files.' }
        foreach ($name in $names) {
            $entry = $setup.GetEntry($name)
            if ($entry.Length -le 0 -or $entry.Length -gt 2MB) { throw 'Invalid setup payload size.' }
            $stream = $entry.Open(); $algorithm = [Security.Cryptography.SHA256]::Create()
            try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $algorithm.Dispose(); $stream.Dispose() }
            $property = $ExpectedSetupContents.PSObject.Properties[$name]
            if ($null -eq $property -or $hash -cne [string]$property.Value) { throw ('Setup payload differs from current Windows source: ' + $name) }
        }
    } finally { $setup.Dispose() }
    $channel = Get-Content -LiteralPath $ChannelPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-ReleaseJsonFields -Value $channel -Fields @('schema','channel','version','repository','archive','publishedAt')
    Assert-ReleaseJsonFields -Value $channel.archive -Fields @('url','sha256','size')
    $url = 'https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.51/Lead-Partner-Common-1.2.51.zip'
    if ($channel.schema -ne 1 -or $channel.channel -cne 'common' -or $channel.version -cne '1.2.51' -or $channel.repository -cne 'mirher228-droid/lead-partner-updates' -or $channel.archive.url -cne $url -or $channel.archive.sha256 -cne $ExpectedArchiveSha256 -or $channel.archive.size -ne $ExpectedArchiveSize) { throw 'Downloaded channel does not pin the current Windows artifact.' }
    [void](Get-CommonDraftTimeTicks $channel.publishedAt)
}

function Invoke-CommonDraftPublication {
    param(
        [Parameter(Mandatory=$true)]$InitialRelease,
        [Parameter(Mandatory=$true)][hashtable]$Proof,
        [Parameter(Mandatory=$true)][hashtable]$Payload,
        [Parameter(Mandatory=$true)][scriptblock]$ReadRelease,
        [Parameter(Mandatory=$true)][scriptblock]$PatchRelease,
        [Parameter(Mandatory=$true)][scriptblock]$AssertSourceUnchanged,
        [Parameter(Mandatory=$true)][scriptblock]$AssertChannelReady,
        [switch]$CreatedThisRun
    )
    Assert-CommonDraftMetadata -Release $InitialRelease @Proof -CreatedThisRun:$CreatedThisRun
    $policy = if ($Proof.ContainsKey('RecoveryPolicy')) { $Proof.RecoveryPolicy } else { Get-CommonDraftRecoveryPolicy }
    $known = [int64]$InitialRelease.id -eq [int64]$policy.ReleaseId
    $pins = if ($known) { @($policy.Assets) } else { @() }
    Assert-CommonDraftPayload @Payload -PinnedAssets $pins
    $current = & $ReadRelease ([int64]$InitialRelease.id)
    Assert-CommonDraftMetadata -Release $current @Proof -CreatedThisRun:$CreatedThisRun
    Assert-CommonDraftAssetsUnchanged -Before $InitialRelease -After $current
    if ($known) {
        $sourceProof = @(& $AssertSourceUnchanged $policy.SourceCommit $Proof.CurrentCommit)
        if ($sourceProof.Count -ne 1 -or $sourceProof[0] -isnot [bool] -or -not $sourceProof[0]) { throw 'Current extension/client sources differ from the pinned failed attempt.' }
    }
    $channelProof = @(& $AssertChannelReady)
    if ($channelProof.Count -ne 1 -or $channelProof[0] -isnot [bool] -or -not $channelProof[0]) { throw 'The previous stable channel or free Git tag changed.' }
    $ready = & $ReadRelease ([int64]$current.id)
    Assert-CommonDraftMetadata -Release $ready @Proof -CreatedThisRun:$CreatedThisRun
    Assert-CommonDraftAssetsUnchanged -Before $current -After $ready
    $channelProof = @(& $AssertChannelReady)
    if ($channelProof.Count -ne 1 -or $channelProof[0] -isnot [bool] -or -not $channelProof[0]) { throw 'Stable channel changed before activation.' }
    # GitHub changed an unpublished tag to an untagged alias on target-only
    # PATCH. Supply the approved tag, target and activation in one operation.
    $published = & $PatchRelease ([int64]$ready.id) @{tag_name='common-v1.2.51';target_commitish=$Proof.CurrentCommit;draft=$false;make_latest='true'}
    Assert-CommonDraftMetadata -Release $published @Proof -CreatedThisRun:$CreatedThisRun -RequireCurrentTarget -Published
    Assert-CommonDraftAssetsUnchanged -Before $ready -After $published -AllowPublishedTransition -CurrentCommit $Proof.CurrentCommit -RecoveryPolicy $policy -CreatedThisRun:$CreatedThisRun
    return $published
}
