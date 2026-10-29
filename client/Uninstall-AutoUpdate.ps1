#Requires -Version 5.1
<#
.SYNOPSIS
Удаляет личную задачу и файлы обновлятора; сохраняет само расширение и восстановление.
#>
[CmdletBinding()]
param(
    [switch]$NoUnregisterTask,
    [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$repository = 'mirher228-droid/lead-partner-updates'
$owner = [Security.Principal.WindowsIdentity]::GetCurrent()
$ownerSid = $owner.User.Value
$taskName = 'LeadPartner-Common-AutoUpdate-' + $ownerSid

function Get-AbsoluteLocalPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^[A-Za-z]:[\\/]') { throw 'Требуется полный локальный путь.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    if ($full.Length -le 3 -or $full.Contains('"') -or $full.Contains("`r") -or $full.Contains("`n")) { throw 'Недопустимый путь.' }
    return $full
}
function Assert-NoReparseAncestors([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Отказ от работы с символической ссылкой: ' + $cursor) }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Enter-LpRunnerMaintenance([string]$Root) {
    # Coordinate with the fixed GUI watcher across this user's Windows sessions.
    # Never terminate its PowerShell child: it may be committing a journal.
    $identity = $ownerSid + '|' + [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\','/')).ToUpperInvariant()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $suffix = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    $state = [pscustomobject]@{StopEvent=$null;Mutex=$null;Acquired=$false}
    try {
        $state.StopEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Global\LeadPartner.Common.Stop.' + $suffix))
        $null = $state.StopEvent.Set()
        $state.Mutex = [Threading.Mutex]::new($false,('Global\LeadPartner.Common.Runner.' + $suffix))
        try { $state.Acquired = $state.Mutex.WaitOne([TimeSpan]::FromSeconds(60)) }
        catch [Threading.AbandonedMutexException] { $state.Acquired = $true }
        if (-not $state.Acquired) { throw 'Обновлятор завершает текущую операцию. Повторите установку позже.' }
        # A previous one-shot runner has no event. Also allow the last few ms
        # between resident mutex release and Windows unmapping its image.
        $image = Join-Path $Root 'LeadPartner.Runner.exe'
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $busy = $false
            foreach ($process in @(Get-Process -Name 'LeadPartner.Runner' -ErrorAction SilentlyContinue)) {
                try { if ($process.Path -and $process.Path.Equals($image,[StringComparison]::OrdinalIgnoreCase)) { $busy = $true } }
                catch { }
                finally { $process.Dispose() }
            }
            if (-not $busy) { break }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Обновлятор ещё завершает работу. Повторите установку позже.' }
            Start-Sleep -Milliseconds 50
        } while ($true)
        return $state
    } catch {
        Exit-LpRunnerMaintenance $state
        throw
    }
}

function Exit-LpRunnerMaintenance($State) {
    if (-not $State) { return }
    try { if ($State.StopEvent) { $null = $State.StopEvent.Reset() } }
    finally {
        try { if ($State.Acquired -and $State.Mutex) { $State.Mutex.ReleaseMutex() } }
        finally {
            if ($State.Mutex) { $State.Mutex.Dispose() }
            if ($State.StopEvent) { $State.StopEvent.Dispose() }
        }
    }
}

function Get-ValidatedExistingTask {
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task) {
        $principalId = [string]$task.Principal.UserId
        $principalOwned = $principalId -ieq $ownerSid -or $principalId -ieq $owner.Name
        if (-not $principalOwned) {
            # Windows may expose the same principal as a short account name.
            # Resolve its SID; matching display text alone is not ownership.
            try { $principalOwned = ([Security.Principal.NTAccount]::new($principalId)).Translate([Security.Principal.SecurityIdentifier]).Value -ceq $ownerSid }
            catch { $principalOwned = $false }
        }
        if (-not $principalOwned) { throw 'Задача с таким именем принадлежит другому пользователю.' }
        $actions = @($task.Actions)
        if ($actions.Count -ne 1) { throw 'Задача с таким именем не относится к этой установке.' }
        $expectedPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $legacyArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $root 'Update-LeadPartner.ps1') + '" -ConfigPath "' + (Join-Path $root 'config.json') + '"'
        $legacy = ([string]$actions[0].Execute) -ieq $expectedPowerShell -and ([string]$actions[0].Arguments) -ceq $legacyArguments
        $silent = ([string]$actions[0].Execute) -ieq (Join-Path $root 'LeadPartner.Runner.exe') -and ([string]$actions[0].Arguments) -ceq '' -and ([string]$actions[0].WorkingDirectory) -ieq $root
        if (-not $legacy -and -not $silent) { throw 'Задача с таким именем не относится к этой установке.' }
    }
    return $task
}

if ($InstallRoot) {
    if (-not $NoUnregisterTask) { throw 'InstallRoot разрешён только вместе с NoUnregisterTask для тестов.' }
    $root = Get-AbsoluteLocalPath $InstallRoot
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $relative = if ($root.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase)) { $root.Substring($temporaryRoot.Length) } else { '' }
    if ($relative -notmatch '^LeadPartnerUpdater-Test-[a-f0-9]{32}\\Common$') { throw 'Недопустимая тестовая папка удаления.' }
} else {
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($local)) { throw 'Не найдена личная папка LocalAppData.' }
    $root = Get-AbsoluteLocalPath (Join-Path $local 'LeadPartnerUpdater\Common')
}
Assert-NoReparseAncestors $root
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Личная установка обновлятора не найдена.' }
$markerPath = Join-Path $root 'installation.json'
Assert-NoReparseAncestors $markerPath
if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf) -or (Get-Item -LiteralPath $markerPath -Force).Length -gt 65536) { throw 'Не найден корректный маркер установленного обновлятора. Файлы не удалены.' }
$marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($marker.schema -ne 1 -or $marker.repository -cne $repository -or $marker.channel -cne 'common' -or $marker.ownerSid -cne $ownerSid -or $marker.installRoot -cne $root) { throw 'Маркер не относится к этой личной установке. Файлы не удалены.' }
$ownedFiles = @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt','SilentRunner.cs','Build-SilentRunner.ps1','LeadPartner.Runner.exe','config.json')
foreach ($name in $ownedFiles + @('update.lock')) {
    $path = Join-Path $root $name
    Assert-NoReparseAncestors $path
    if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path -Force).PSIsContainer) { throw ('Вместо файла найдена папка; удаление остановлено: ' + $path) }
}
if (-not $NoUnregisterTask) {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ValidatedExistingTask
}
$lockStream = $null
$runnerMaintenance = $null
try {
    $runnerMaintenance = Enter-LpRunnerMaintenance $root
    try { $lockStream = [IO.File]::Open((Join-Path $root 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { throw 'Обновлятор сейчас занят. Повторите удаление позже.' }
    if (-not $NoUnregisterTask -and $task) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false }
    # Exact allowlist only; no recursive deletion and no access to extensionPath.
    foreach ($name in $ownedFiles) {
        $path = Join-Path $root $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
} finally {
    if ($lockStream) { $lockStream.Dispose() }
    Exit-LpRunnerMaintenance $runnerMaintenance
}
# Keep installation.json and update.lock for safe reinstallation, plus every
# backup, stage, journal, status, log and unrecognised file for recovery.
if (-not $NoUnregisterTask) { Write-Host 'Автообновление отключено. Расширение, его данные и материалы восстановления сохранены.' }
[pscustomobject]@{Status=$(if ($NoUnregisterTask) {'uninstalled-test'} else {'uninstalled'});InstallRoot=$root;TaskName=$taskName;RecoveryRetained=$true}
