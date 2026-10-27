# Windows PowerShell 5.1; no Pester, network, installed extensions or real tasks.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$clientRoot = Join-Path $repositoryRoot 'client'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('LeadPartnerUpdater-Test-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'Common'
$sourceRoot = Join-Path $testRoot 'setup'
$extensionRoot = Join-Path $testRoot 'Common extension with spaces'
$utf8 = New-Object Text.UTF8Encoding($true)
$script:checks = 0

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw ('FAIL: ' + $Message) }
    $script:checks++
}
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert $failed $Message
}
function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8)
}
function New-Common([string]$Path, [string]$Name = 'Lead-Partner · Общая') {
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    Write-Json (Join-Path $Path 'manifest.json') ([ordered]@{manifest_version=3;name=$Name;short_name='LP Общая';version='1.2.30'})
    [IO.File]::WriteAllText((Join-Path $Path 'worker.js'), 'extension sentinel', $utf8)
    [IO.File]::WriteAllText((Join-Path $Path 'sources-config.json'), '{"fixture":true}', $utf8)
    $files = @('manifest.json','worker.js','sources-config.json') | ForEach-Object { @{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $Path $_) -Algorithm SHA256).Hash.ToLowerInvariant()} }
    Write-Json (Join-Path $Path 'ROOTRELEASE_FILES.json') @{schemaVersion=1;version='1.2.30';files=@($files)}
}
# A mistaken scheduling call must fail in this isolated test process.
function global:Register-ScheduledTask { throw 'A test attempted to register a real task.' }
function global:Get-ScheduledTask { throw 'A test attempted to read a real task.' }
function global:Unregister-ScheduledTask { throw 'A test attempted to unregister a real task.' }
function global:Start-ScheduledTask { throw 'A test attempted to start a real task.' }

try {
    Assert (Test-Path -LiteralPath (Join-Path $clientRoot 'Install-AutoUpdate.ps1')) 'installer must exist'
    [IO.Directory]::CreateDirectory($sourceRoot) | Out-Null
    foreach ($name in @('Install-AutoUpdate.ps1','Install-AutoUpdate.bat','Uninstall-AutoUpdate.ps1','Uninstall-AutoUpdate.bat','README-RU.txt')) {
        Copy-Item -LiteralPath (Join-Path $clientRoot $name) -Destination (Join-Path $sourceRoot $name)
    }
    # These sentinels cannot update anything even if launched accidentally.
    [IO.File]::WriteAllText((Join-Path $sourceRoot 'Updater.Core.ps1'), 'throw "Test core must never execute during installation."', $utf8)
    [IO.File]::WriteAllText((Join-Path $sourceRoot 'Update-LeadPartner.ps1'), 'throw "Test entry must never execute during installation."', $utf8)
    $installer = Join-Path $sourceRoot 'Install-AutoUpdate.ps1'
    $uninstaller = Join-Path $sourceRoot 'Uninstall-AutoUpdate.ps1'
    New-Common $extensionRoot

    $result = & $installer -ExtensionPath $extensionRoot -NoRegisterTask -InstallRoot $installRoot
    Assert ($result.Status -eq 'installed-test') 'fixture installation completes without scheduling'
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $expectedTaskName = 'LeadPartner-Common-AutoUpdate-' + $currentSid
    Assert ($result.TaskName -ceq $expectedTaskName) 'task name is scoped to the current Windows account SID'
    Assert ($result.TaskName -cne 'LeadPartner-Common-AutoUpdate-S-1-5-21-1111111111-2222222222-3333333333-1001') 'current account task cannot replace a different account task name'
    $configPath = Join-Path $installRoot 'config.json'
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($config.schema -eq 1 -and $config.repository -ceq 'mirher228-droid/lead-partner-updates' -and $config.channel -ceq 'common') 'local config pins Common repository'
    Assert ($config.extensionPath -ceq $extensionRoot) 'chosen existing folder remains exact'
    Assert (@($config.PSObject.Properties).Count -eq 4) 'config contains no credentials or client-specific fields'
    Assert ((Get-Content -LiteralPath (Join-Path $extensionRoot 'worker.js') -Raw -Encoding UTF8).Trim() -ceq 'extension sentinel') 'installer does not touch extension code'
    $xml = [xml]$result.TaskXml
    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    Assert ($xml.SelectSingleNode('//t:Principal/t:LogonType',$ns).InnerText -ceq 'InteractiveToken') 'task uses logged-in user without credentials'
    Assert ($xml.SelectSingleNode('//t:Principal/t:RunLevel',$ns).InnerText -ceq 'LeastPrivilege') 'task has limited privileges'
    Assert ($xml.SelectSingleNode('//t:TimeTrigger/t:Repetition/t:Interval',$ns).InnerText -ceq 'PT15M') 'task repeats every 15 minutes'
    Assert ($null -ne $xml.SelectSingleNode('//t:LogonTrigger/t:UserId',$ns)) 'task also starts on user logon'
    Assert ($xml.SelectSingleNode('//t:Exec/t:Command',$ns).InnerText -like '*\WindowsPowerShell\v1.0\powershell.exe') 'task uses Windows PowerShell'
    $arguments = $xml.SelectSingleNode('//t:Exec/t:Arguments',$ns).InnerText
    Assert ($arguments.Contains('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "')) 'task launches hidden without profiles'
    Assert ($arguments.Contains('-ConfigPath "' + $configPath + '"')) 'task passes exact local config path'
    Assert ($xml.SelectSingleNode('//t:Settings/t:MultipleInstancesPolicy',$ns).InnerText -ceq 'IgnoreNew') 'task does not overlap its own launches'
    # Parse using the real Windows scheduler schema without registering a task.
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $definition = $scheduler.NewTask(0)
    $definition.XmlText = $result.TaskXml
    Assert ($definition.Triggers.Count -eq 2 -and $definition.Actions.Count -eq 1) 'Windows scheduler accepts complete task definition without registering it'
    Assert ($definition.Principal.RunLevel -eq 0 -and $definition.Principal.LogonType -eq 3) 'Windows scheduler resolves limited interactive principal'

    [IO.File]::WriteAllText((Join-Path $installRoot 'staged.zip'), 'staged sentinel', $utf8)
    [IO.File]::WriteAllText((Join-Path $installRoot 'journal.json'), 'journal sentinel', $utf8)
    [IO.Directory]::CreateDirectory((Join-Path $installRoot 'backup')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $installRoot 'backup\original.txt'), 'backup sentinel', $utf8)
    & $installer -NoRegisterTask -InstallRoot $installRoot | Out-Null
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($config.extensionPath -ceq $extensionRoot) 'reinstall with no selection preserves existing folder'
    Assert ((Get-Content -LiteralPath (Join-Path $installRoot 'staged.zip') -Raw -Encoding UTF8).Trim() -ceq 'staged sentinel') 'reinstall preserves staged bytes'
    Assert ((Get-Content -LiteralPath (Join-Path $installRoot 'journal.json') -Raw -Encoding UTF8).Trim() -ceq 'journal sentinel') 'reinstall preserves recovery journal'

    $otherCommon = Join-Path $testRoot 'Another Common'
    New-Common $otherCommon
    Assert-Throws { & $installer -ExtensionPath $otherCommon -NoRegisterTask -InstallRoot $installRoot } 'pending recovery prevents retargeting to another folder'
    Remove-Item -LiteralPath (Join-Path $installRoot 'staged.zip'), (Join-Path $installRoot 'journal.json')
    & $installer -ExtensionPath $otherCommon -NoRegisterTask -InstallRoot $installRoot | Out-Null
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($config.extensionPath -ceq $otherCommon) 'explicit selection authorizes changing folder when no recovery is pending'

    $lock = [IO.File]::Open((Join-Path $installRoot 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        Assert-Throws { & $installer -ExtensionPath $extensionRoot -NoRegisterTask -InstallRoot $installRoot } 'active updater lock prevents reinstall race'
        Assert-Throws { & $uninstaller -NoUnregisterTask -InstallRoot $installRoot } 'active updater lock prevents uninstall race'
    } finally { $lock.Dispose() }

    foreach ($badName in @('Lead-Partner VSD','Lead-Partner · Админ','Lead-Partner · Захар','Lead-Partner · Общая extra')) {
        $badPath = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
        New-Common $badPath $badName
        Assert-Throws { & $installer -ExtensionPath $badPath -NoRegisterTask -InstallRoot $installRoot } ('wrong edition rejected: ' + $badName)
    }
    foreach ($badVersion in @('1.2','01.2.30','1.2.65536','1.2.30-beta')) {
        $badPath = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
        New-Common $badPath
        $badManifest = Get-Content -LiteralPath (Join-Path $badPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $badManifest.version = $badVersion
        Write-Json (Join-Path $badPath 'manifest.json') $badManifest
        Assert-Throws { & $installer -ExtensionPath $badPath -NoRegisterTask -InstallRoot $installRoot } ('unsupported version rejected before install: ' + $badVersion)
    }
    $badPath = Join-Path $testRoot 'wrong short name'
    New-Common $badPath
    $badManifest = Get-Content -LiteralPath (Join-Path $badPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $badManifest.short_name = 'LP Админ'
    Write-Json (Join-Path $badPath 'manifest.json') $badManifest
    Assert-Throws { & $installer -ExtensionPath $badPath -NoRegisterTask -InstallRoot $installRoot } 'wrong short name rejected before install'
    $badPath = Join-Path $testRoot 'missing inventory'
    New-Common $badPath
    Remove-Item -LiteralPath (Join-Path $badPath 'ROOTRELEASE_FILES.json')
    Assert-Throws { & $installer -ExtensionPath $badPath -NoRegisterTask -InstallRoot $installRoot } 'missing inventory rejected before install'
    $badPath = Join-Path $testRoot 'wrong inventory version'
    New-Common $badPath
    $inventory = Get-Content -LiteralPath (Join-Path $badPath 'ROOTRELEASE_FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $inventory.version = '1.2.29'
    Write-Json (Join-Path $badPath 'ROOTRELEASE_FILES.json') $inventory
    Assert-Throws { & $installer -ExtensionPath $badPath -NoRegisterTask -InstallRoot $installRoot } 'mismatched inventory version rejected before install'
    Assert-Throws { & $installer -ExtensionPath (Join-Path $testRoot 'missing') -NoRegisterTask -InstallRoot $installRoot } 'missing Common folder rejected'
    Assert-Throws { & $installer -ExtensionPath '.' -NoRegisterTask -InstallRoot $installRoot } 'relative extension path rejected'
    Assert-Throws { & $installer -ExtensionPath $otherCommon -InstallRoot $installRoot } 'custom install root cannot register a real task'
    Assert-Throws { & $installer -ExtensionPath $otherCommon -NoRegisterTask -InstallRoot $testRoot } 'test override is constrained to exact fixture Common subfolder'
    Assert-Throws { & $uninstaller -NoUnregisterTask -InstallRoot $testRoot } 'uninstaller rejects broad test root'
    Assert-Throws { & $uninstaller -InstallRoot $installRoot } 'custom root cannot unregister a real task'

    $browserPath = Join-Path $testRoot 'Google\Chrome\User Data\Default\Extensions\Common'
    New-Common $browserPath
    Assert-Throws { & $installer -ExtensionPath $browserPath -NoRegisterTask -InstallRoot $installRoot } 'browser profile targets rejected before inspection'
    $junctionPath = Join-Path $testRoot 'linked-common'
    New-Item -ItemType Junction -Path $junctionPath -Target $otherCommon | Out-Null
    try { Assert-Throws { & $installer -ExtensionPath $junctionPath -NoRegisterTask -InstallRoot $installRoot } 'junction extension root rejected' }
    finally { [IO.Directory]::Delete($junctionPath) }
    $nestedLink = Join-Path $otherCommon 'linked-content'
    New-Item -ItemType Junction -Path $nestedLink -Target $extensionRoot | Out-Null
    try { Assert-Throws { & $installer -ExtensionPath $otherCommon -NoRegisterTask -InstallRoot $installRoot } 'junction in extension content rejected' }
    finally { [IO.Directory]::Delete($nestedLink) }

    $configText = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
    foreach ($change in @('string-schema','unknown-field')) {
        $invalidConfig = $configText | ConvertFrom-Json
        if ($change -ceq 'string-schema') { $invalidConfig.schema = '1' }
        else { $invalidConfig | Add-Member -NotePropertyName secretToken -NotePropertyValue 'must-not-be-silently-kept' }
        Write-Json $configPath $invalidConfig
        Assert-Throws { & $installer -NoRegisterTask -InstallRoot $installRoot } ('core-incompatible existing config rejected: ' + $change)
        [IO.File]::WriteAllText($configPath,$configText,$utf8)
    }
    [IO.File]::WriteAllText($configPath, '{"schema":2,"repository":"elsewhere/repo","channel":"common","extensionPath":"C:\\bad"}', $utf8)
    Assert-Throws { & $installer -NoRegisterTask -InstallRoot $installRoot } 'invalid existing config cannot be silently replaced'
    Assert ([IO.File]::ReadAllText($configPath,[Text.Encoding]::UTF8).Contains('elsewhere/repo')) 'invalid config preserved for inspection'
    [IO.File]::WriteAllText($configPath,$configText,$utf8)

    [IO.File]::WriteAllText((Join-Path $installRoot 'keep-unknown.txt'), 'unknown sentinel', $utf8)
    [IO.File]::WriteAllText((Join-Path $installRoot 'journal.json'), 'journal sentinel', $utf8)
    $result = & $uninstaller -NoUnregisterTask -InstallRoot $installRoot
    Assert ($result.Status -ceq 'uninstalled-test') 'uninstall succeeds only in fixture mode'
    Assert ($result.TaskName -ceq $expectedTaskName) 'uninstaller targets the same current account task name'
    Assert (-not (Test-Path -LiteralPath $configPath)) 'uninstall removes owned local config'
    Assert (-not (Test-Path -LiteralPath (Join-Path $installRoot 'Updater.Core.ps1'))) 'uninstall removes owned runtime'
    Assert (Test-Path -LiteralPath (Join-Path $installRoot 'backup\original.txt')) 'uninstall retains backup'
    Assert (Test-Path -LiteralPath (Join-Path $installRoot 'journal.json')) 'uninstall retains journal'
    Assert (Test-Path -LiteralPath (Join-Path $installRoot 'keep-unknown.txt')) 'uninstall retains unrelated files'
    Assert (Test-Path -LiteralPath (Join-Path $otherCommon 'manifest.json')) 'uninstall retains installed Common extension'
    Assert ((Get-Content -LiteralPath (Join-Path $otherCommon 'worker.js') -Raw -Encoding UTF8).Trim() -ceq 'extension sentinel') 'uninstall retains extension code'
    Assert-Throws { & $installer -ExtensionPath $extensionRoot -NoRegisterTask -InstallRoot $installRoot } 'reinstall after uninstall must not redirect a retained recovery journal'
    Write-Output ('PASS: ' + $script:checks + ' installer/uninstaller checks; Windows PowerShell ' + $PSVersionTable.PSVersion.ToString())
} finally {
    # One native PowerShell operation, exact checked disposable root only.
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot).TrimEnd('\')
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTestRoot.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTestRoot) -match '^LeadPartnerUpdater-Test-[a-f0-9]{32}$' -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
