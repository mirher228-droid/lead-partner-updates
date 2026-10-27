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
$ownedFiles = @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt','config.json')
foreach ($name in $ownedFiles + @('update.lock')) {
    $path = Join-Path $root $name
    Assert-NoReparseAncestors $path
    if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path -Force).PSIsContainer) { throw ('Вместо файла найдена папка; удаление остановлено: ' + $path) }
}
if (-not $NoUnregisterTask) {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task) {
        $principalId = [string]$task.Principal.UserId
        if ($principalId -ine $ownerSid -and $principalId -ine $owner.Name) { throw 'Задача с таким именем принадлежит другому пользователю.' }
        $expected = '-File "' + (Join-Path $root 'Update-LeadPartner.ps1') + '" -ConfigPath "' + (Join-Path $root 'config.json') + '"'
        $actions = @($task.Actions)
        $expectedPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if ($actions.Count -ne 1 -or ([string]$actions[0].Execute) -ine $expectedPowerShell -or -not ([string]$actions[0].Arguments).Contains($expected)) { throw 'Задача с таким именем не относится к этой установке.' }
    }
}
$lockStream = $null
try {
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
}
# Keep installation.json and update.lock for safe reinstallation, plus every
# backup, stage, journal, status, log and unrecognised file for recovery.
if (-not $NoUnregisterTask) { Write-Host 'Автообновление отключено. Расширение, его данные и материалы восстановления сохранены.' }
[pscustomobject]@{Status=$(if ($NoUnregisterTask) {'uninstalled-test'} else {'uninstalled'});InstallRoot=$root;TaskName=$taskName;RecoveryRetained=$true}
