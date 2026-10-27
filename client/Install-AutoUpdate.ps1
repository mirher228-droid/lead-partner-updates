#Requires -Version 5.1
<#
.SYNOPSIS
Один раз включает обновления уже установленной распакованной Общей версии.
.DESCRIPTION
Работает от текущего пользователя, без прав администратора и без паролей.
NoRegisterTask и InstallRoot предназначены только для автономных тестов.
#>
[CmdletBinding()]
param(
    [string]$ExtensionPath,
    [switch]$StartNow,
    [switch]$NoRegisterTask,
    [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$repository = 'mirher228-droid/lead-partner-updates'
$owner = [Security.Principal.WindowsIdentity]::GetCurrent()
$ownerSid = $owner.User.Value
$taskName = 'LeadPartner-Common-AutoUpdate-' + $ownerSid
$utf8 = New-Object Text.UTF8Encoding($true)
$managedFiles = @('Updater.Core.ps1','Update-LeadPartner.ps1','Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt')

function Get-AbsoluteLocalPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^[A-Za-z]:[\\/]') { throw 'Требуется полный путь к папке на локальном диске.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    if ($full.Length -le 3 -or $full.Contains('"') -or $full.Contains("`r") -or $full.Contains("`n")) { throw 'Недопустимый путь к папке.' }
    return $full
}

function Assert-NoReparseAncestors([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Ссылки и точки соединения не поддерживаются: ' + $cursor) }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-ValidatedRoot {
    if ($InstallRoot) {
        if (-not $NoRegisterTask) { throw 'InstallRoot разрешён только вместе с NoRegisterTask для тестов.' }
        $full = Get-AbsoluteLocalPath $InstallRoot
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        $relative = if ($full.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase)) { $full.Substring($temporaryRoot.Length) } else { '' }
        if ($relative -notmatch '^LeadPartnerUpdater-Test-[a-f0-9]{32}\\Common$') { throw 'Тестовая папка должна иметь вид %TEMP%\LeadPartnerUpdater-Test-<GUID>\Common.' }
    } else {
        $local = [Environment]::GetFolderPath('LocalApplicationData')
        if ([string]::IsNullOrWhiteSpace($local)) { throw 'Не найдена личная папка LocalAppData.' }
        $full = Get-AbsoluteLocalPath (Join-Path $local 'LeadPartnerUpdater\Common')
    }
    Assert-NoReparseAncestors $full
    if ((Test-Path -LiteralPath $full) -and -not (Get-Item -LiteralPath $full -Force).PSIsContainer) { throw 'Путь установщика занят файлом.' }
    return $full
}

function Read-PinnedConfig([string]$Path) {
    Assert-NoReparseAncestors $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or $item.Length -gt 65536) { throw 'Недопустимый файл config.json.' }
    $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $fields = @($value.PSObject.Properties.Name)
    if ($fields.Count -ne 4 -or $fields -cnotcontains 'schema' -or $fields -cnotcontains 'repository' -or $fields -cnotcontains 'channel' -or $fields -cnotcontains 'extensionPath' -or ($value.schema -isnot [int] -and $value.schema -isnot [long]) -or $value.schema -ne 1 -or $value.repository -cne $repository -or $value.channel -cne 'common' -or $value.extensionPath -isnot [string]) { throw 'Существующий config.json относится к другой схеме или репозиторию.' }
    $absolute = Get-AbsoluteLocalPath ([string]$value.extensionPath)
    if ($absolute -cne [string]$value.extensionPath) { throw 'В config.json должен быть нормализованный полный путь.' }
    return $value
}

function Assert-OwnedInstallation([string]$Root) {
    $markerPath = Join-Path $Root 'installation.json'
    $configPath = Join-Path $Root 'config.json'
    if (Test-Path -LiteralPath $markerPath) {
        Assert-NoReparseAncestors $markerPath
        $markerItem = Get-Item -LiteralPath $markerPath -Force
        if ($markerItem.PSIsContainer -or $markerItem.Length -gt 65536) { throw 'Недопустимый файл installation.json.' }
        $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($marker.schema -ne 1 -or $marker.repository -cne $repository -or $marker.channel -cne 'common' -or $marker.ownerSid -cne $ownerSid -or $marker.installRoot -cne $Root) { throw 'Папка обновления принадлежит другой установке или пользователю.' }
        $previousPath = Get-AbsoluteLocalPath ([string]$marker.extensionPath)
        if ($previousPath -cne [string]$marker.extensionPath) { throw 'Маркер установки содержит некорректный путь расширения.' }
    } elseif (-not (Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath $Root)) {
        $existing = @(Get-ChildItem -LiteralPath $Root -Force)
        if ($existing.Count -ne 0) { throw 'Папка обновления содержит неизвестные файлы. Установка остановлена.' }
    }
    if (Test-Path -LiteralPath $configPath) { return Read-PinnedConfig $configPath }
    if (Test-Path -LiteralPath $markerPath) {
        # Uninstall retains this identity so a pending journal cannot be
        # redirected to a different extension when config.json is absent.
        return [pscustomobject]@{schema=1;repository=$repository;channel='common';extensionPath=$previousPath}
    }
    return $null
}

function Assert-RetargetAllowed($Previous, [string]$SelectedPath, [string]$Root) {
    if ($Previous -and -not $SelectedPath.Equals([string]$Previous.extensionPath,[StringComparison]::OrdinalIgnoreCase)) {
        foreach ($stateName in @('journal.json','staged.json','staged.zip')) {
            if (Test-Path -LiteralPath (Join-Path $Root $stateName)) { throw 'Сначала завершите ожидающее обновление или восстановление старой папки; затем меняйте путь установки.' }
        }
    }
}

function Assert-CommonInventory([string]$Path, [string]$Version) {
    $inventoryPath = Join-Path $Path 'ROOTRELEASE_FILES.json'
    Assert-NoReparseAncestors $inventoryPath
    if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf) -or (Get-Item -LiteralPath $inventoryPath -Force).Length -gt 2MB) { throw 'В Общей версии отсутствует корректный ROOTRELEASE_FILES.json.' }
    $inventory = Get-Content -LiteralPath $inventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $fields = @($inventory.PSObject.Properties.Name)
    if ($fields.Count -ne 3 -or $fields -cnotcontains 'schemaVersion' -or $fields -cnotcontains 'version' -or $fields -cnotcontains 'files' -or ($inventory.schemaVersion -isnot [int] -and $inventory.schemaVersion -isnot [long]) -or $inventory.schemaVersion -ne 1 -or $inventory.version -cne $Version -or $inventory.files -isnot [array] -or $inventory.files.Count -lt 1 -or $inventory.files.Count -ge 1000) { throw 'Версия или схема ROOTRELEASE_FILES.json не поддерживается обновлятором.' }
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $inventory.files) {
        $fields = @($file.PSObject.Properties.Name)
        if ($fields.Count -ne 2 -or $fields -cnotcontains 'path' -or $fields -cnotcontains 'sha256' -or $file.path -isnot [string] -or $file.sha256 -isnot [string] -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Некорректная запись ROOTRELEASE_FILES.json.' }
        $relative = [string]$file.path
        if (-not $relative -or $relative.Length -gt 220 -or $relative.Contains('\') -or $relative.StartsWith('/') -or $relative.Contains(':') -or $relative -match '[\x00-\x1f\x7f]') { throw 'Недопустимый путь в ROOTRELEASE_FILES.json.' }
        foreach ($part in $relative.Split('/')) {
            if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>"|?*]' -or $part -match '[ .]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') { throw 'Недопустимый путь Windows в ROOTRELEASE_FILES.json.' }
        }
        if ($relative -match '(?i)(^|[/._ -])(admin|zakhar|telegram|tdata|profile|profiles|session|sessions|cookies|credentials|secrets?|private[-_ ]?key)([/._ -]|$)' -or $relative -match '(?i)\.(exe|com|dll|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|wsf|wsh|hta|lnk|reg|pem|pfx|p12|key|sqlite|db)$' -or $relative -match '(?i)(^|/)\.env(?:\.|$)') { throw 'ROOTRELEASE_FILES.json содержит файл другой или приватной версии.' }
        if ($relative -ieq 'ROOTRELEASE_FILES.json' -or -not $seen.Add($relative)) { throw 'Повторяющийся путь в ROOTRELEASE_FILES.json.' }
        Assert-NoReparseAncestors (Join-Path $Path $relative)
    }
    if (-not $seen.Contains('manifest.json') -or -not $seen.Contains('sources-config.json')) { throw 'ROOTRELEASE_FILES.json не содержит обязательные файлы Общей версии.' }
}

function Assert-CommonFolder([string]$Path, [string]$UpdaterRoot) {
    # Never enumerate a browser profile, even if its name was selected by mistake.
    if ($Path -match '(?i)\\(?:User Data|BrowserMetrics)(?:\\|$)|\\Mozilla\\(?:Firefox|SeaMonkey)\\Profiles(?:\\|$)') { throw 'Нельзя выбирать папку профиля браузера. Выберите исходную распакованную Общую версию.' }
    if ($Path.Equals($UpdaterRoot,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($UpdaterRoot + '\',[StringComparison]::OrdinalIgnoreCase) -or $UpdaterRoot.StartsWith($Path + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Папка расширения не должна пересекаться с папкой обновлятора.' }
    Assert-NoReparseAncestors $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'Выбранная папка расширения не существует.' }
    $manifestPath = Join-Path $Path 'manifest.json'
    Assert-NoReparseAncestors $manifestPath
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'В выбранной папке нет manifest.json.' }
    if ((Get-Item -LiteralPath $manifestPath -Force).Length -gt 1048576) { throw 'Слишком большой manifest.json.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -cne 'Lead-Partner · Общая' -or $manifest.short_name -cne 'LP Общая' -or $manifest.manifest_version -ne 3) { throw 'Выберите папку расширения Lead-Partner · Общая. Версии Админ и Захар не поддерживаются.' }
    if ($manifest.version -isnot [string] -or $manifest.version -cnotmatch '^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4}))?$') { throw 'Версия расширения не поддерживается обновлятором.' }
    foreach ($part in $manifest.version.Split('.')) { if ([int]$part -gt 65535) { throw 'Компонент версии расширения превышает допустимое значение Chrome.' } }
    $key = $manifest.PSObject.Properties['key']
    if ($key -and ($key.Value -isnot [string] -or -not $key.Value -or $key.Value.Length -gt 16384)) { throw 'Некорректный ключ идентификатора расширения.' }
    Assert-CommonInventory $Path $manifest.version
    # Inspect only the explicitly selected extension; do not follow reparse points.
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        foreach ($child in @(Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Ссылки в расширении не поддерживаются: ' + $child.FullName) }
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}

function Select-CommonFolder {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Выберите уже установленную распакованную папку Lead-Partner · Общая (с manifest.json). Не выбирайте профиль браузера.'
    $dialog.ShowNewFolderButton = $false
    try {
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Установка отменена: папка не выбрана.' }
        return $dialog.SelectedPath
    } finally { $dialog.Dispose() }
}

function Write-AtomicFile([string]$Path, [byte[]]$Bytes) {
    Assert-NoReparseAncestors $Path
    if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path -Force).PSIsContainer) { throw ('Файл занят папкой: ' + $Path) }
    $temporary = $Path + '.install-' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllBytes($temporary,$Bytes)
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary,$Path,[System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($temporary,$Path) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function New-TaskXml([string]$Root) {
    $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $entryPath = Join-Path $Root 'Update-LeadPartner.ps1'
    $configPath = Join-Path $Root 'config.json'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $entryPath + '" -ConfigPath "' + $configPath + '"'
    $commandXml = [Security.SecurityElement]::Escape($powerShellPath)
    $argumentsXml = [Security.SecurityElement]::Escape($arguments)
    $rootXml = [Security.SecurityElement]::Escape($Root)
    $startBoundary = (Get-Date).AddMinutes(1).ToString('s')
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Обновление Lead-Partner · Общая текущего пользователя.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$ownerSid</UserId></LogonTrigger>
    <TimeTrigger><Repetition><Interval>PT15M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$startBoundary</StartBoundary><Enabled>true</Enabled></TimeTrigger>
  </Triggers>
  <Principals><Principal id="CurrentUser"><UserId>$ownerSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT10M</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Actions Context="CurrentUser"><Exec><Command>$commandXml</Command><Arguments>$argumentsXml</Arguments><WorkingDirectory>$rootXml</WorkingDirectory></Exec></Actions>
</Task>
"@
}

function Assert-ExistingTaskOwner {
    $existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($existingTask) {
        $principalId = [string]$existingTask.Principal.UserId
        if ($principalId -ine $ownerSid -and $principalId -ine $owner.Name) { throw 'Задача обновления принадлежит другому пользователю. Установка остановлена.' }
        $actions = @($existingTask.Actions)
        $expectedEntry = Join-Path $root 'Update-LeadPartner.ps1'
        $expectedConfig = Join-Path $root 'config.json'
        $expectedPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if ($actions.Count -ne 1 -or ([string]$actions[0].Execute) -ine $expectedPowerShell -or -not ([string]$actions[0].Arguments).Contains('-File "' + $expectedEntry + '" -ConfigPath "' + $expectedConfig + '"')) { throw 'Существующая задача с таким именем не относится к этой установке.' }
    }
}

$root = Get-ValidatedRoot
$existingConfig = Assert-OwnedInstallation $root
$explicitSelection = $PSBoundParameters.ContainsKey('ExtensionPath')
if ($explicitSelection -and [string]::IsNullOrWhiteSpace($ExtensionPath)) { throw 'Путь расширения не может быть пустым.' }
if (-not $explicitSelection) {
    if ($existingConfig) { $ExtensionPath = [string]$existingConfig.extensionPath }
    elseif ($NoRegisterTask) { throw 'Для первой тестовой установки укажите ExtensionPath.' }
    else { $ExtensionPath = Select-CommonFolder }
}
$selectedPath = Get-AbsoluteLocalPath $ExtensionPath
Assert-CommonFolder $selectedPath $root
Assert-RetargetAllowed $existingConfig $selectedPath $root
# Read all package files before changing the installed runtime.
$payload = @{}
foreach ($name in $managedFiles) {
    $source = Join-Path $PSScriptRoot $name
    Assert-NoReparseAncestors $source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('В архиве установщика отсутствует файл: ' + $name) }
    $payload[$name] = [IO.File]::ReadAllBytes($source)
    Assert-NoReparseAncestors (Join-Path $root $name)
}
Assert-NoReparseAncestors (Join-Path $root 'update.lock')
if (-not $NoRegisterTask) {
    Import-Module ScheduledTasks -ErrorAction Stop
    Assert-ExistingTaskOwner
}
[IO.Directory]::CreateDirectory($root) | Out-Null
$lockStream = $null
try {
    try { $lockStream = [IO.File]::Open((Join-Path $root 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { throw 'Обновлятор сейчас занят. Повторите установку позже.' }
    if ((Test-Path -LiteralPath (Join-Path $root 'installation.json')) -or (Test-Path -LiteralPath (Join-Path $root 'config.json'))) {
        $latestConfig = Assert-OwnedInstallation $root
        if (-not $explicitSelection -and -not $selectedPath.Equals([string]$latestConfig.extensionPath,[StringComparison]::OrdinalIgnoreCase)) { throw 'Конфигурация изменилась во время установки. Повторите запуск.' }
        Assert-RetargetAllowed $latestConfig $selectedPath $root
    }
    foreach ($name in $managedFiles) { Write-AtomicFile (Join-Path $root $name) $payload[$name] }
    $config = [ordered]@{schema=1;repository=$repository;channel='common';extensionPath=$selectedPath}
    Write-AtomicFile (Join-Path $root 'config.json') ($utf8.GetBytes(($config | ConvertTo-Json)))
    $marker = [ordered]@{schema=1;repository=$repository;channel='common';ownerSid=$ownerSid;installRoot=$root;extensionPath=$selectedPath}
    Write-AtomicFile (Join-Path $root 'installation.json') ($utf8.GetBytes(($marker | ConvertTo-Json)))
    $taskXml = New-TaskXml $root
    if (-not $NoRegisterTask) { Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $taskXml -Force | Out-Null }
} finally {
    if ($lockStream) { $lockStream.Dispose() }
}
if ($StartNow -and -not $NoRegisterTask) { Start-ScheduledTask -TaskName $taskName -TaskPath '\' }
if (-not $NoRegisterTask) { Write-Host ('Готово. Общая версия: ' + $selectedPath + '. Проверка каждые 15 минут и при входе в Windows.'); Write-Host 'Закройте все окна браузера для применения подготовленного обновления.' }
$result = [ordered]@{Status=$(if ($NoRegisterTask) {'installed-test'} else {'installed'});InstallRoot=$root;ConfigPath=(Join-Path $root 'config.json');TaskName=$taskName}
if ($NoRegisterTask) { $result['TaskXml'] = $taskXml }
[pscustomobject]$result
