# Windows PowerShell 5.1. Real processes only in an isolated temporary fixture.
# No network, scheduled tasks, browser profiles or installed updater are touched.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$client = Join-Path (Split-Path -Parent $PSScriptRoot) 'client'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('LeadPartner-SilentRunner-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($true)
$script:checks = 0
function Assert([bool]$Condition,[string]$Message) {if(-not $Condition){throw ('FAIL: '+$Message)};$script:checks++}
function Assert-Throws([scriptblock]$Action,[string]$Message) {$failed=$false;try {& $Action|Out-Null}catch{$failed=$true};Assert $failed $Message}
function Assert-NoChildConsole([string]$Path) {
    $result=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
    Assert ([long]$result.console -eq 0) 'the actual child PowerShell starts without an attached console'
    Assert ($result.config -ceq (Join-Path (Split-Path -Parent $Path) 'config.json')) 'runner supplies exact fixed config path'
    Assert ($result.location -ceq (Split-Path -Parent $Path)) 'runner uses own directory as child working directory'
}
function Write-Entry([string]$Root,[int]$ExitCode=0,[switch]$LargeOutput) {
    $body=@'
param([string]$ConfigPath)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RunnerConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
$proof=@{console=[RunnerConsoleProbe]::GetConsoleWindow().ToInt64();config=$ConfigPath;location=(Get-Location).Path}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'child-proof.json'),($proof|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
'@
    if($LargeOutput){$body+="`r`nfor(`$i=0;`$i -lt 2000;`$i++){[Console]::Out.WriteLine(('o'*2048));[Console]::Error.WriteLine(('e'*2048))}`r`n"}
    $body+="`r`nexit $ExitCode`r`n"
    [IO.File]::WriteAllText((Join-Path $Root 'Update-LeadPartner.ps1'),$body,$utf8)
}
function Run-Fixture([string]$Runner,[string]$WorkingDirectory,[string]$Arguments='--once') {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$Runner;$info.WorkingDirectory=$WorkingDirectory;$info.Arguments=$Arguments
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $process=[Diagnostics.Process]::Start($info)
    try {
        if(-not $process.WaitForExit(30000)){$process.Kill();throw 'Fixture process failed to drain or exit within 30 seconds.'}
        return $process.ExitCode
    } finally {$process.Dispose()}
}
try {
    Assert (Test-Path -LiteralPath (Join-Path $client 'Build-SilentRunner.ps1')) 'silent runner builder must exist'
    Assert (Test-Path -LiteralPath (Join-Path $client 'SilentRunner.cs')) 'silent runner source must exist'
    [void][IO.Directory]::CreateDirectory($testRoot)
    $own=Join-Path $testRoot (([string][char]0x042F)+' updater with spaces');$foreign=Join-Path $testRoot 'Foreign working directory'
    [void][IO.Directory]::CreateDirectory($own);[void][IO.Directory]::CreateDirectory($foreign)
    $before=@([AppDomain]::CurrentDomain.GetAssemblies()|ForEach-Object{$_.FullName})
    . (Join-Path $client 'Build-SilentRunner.ps1')
    Assert (@(Get-ChildItem -LiteralPath $own -File).Count -eq 0) 'importing builder defines functions without compiling or writing files'
    $runner=Join-Path $own 'LeadPartner.Runner.exe'
    Build-LpSilentRunner -SourcePath (Join-Path $client 'SilentRunner.cs') -OutputPath $runner
    Assert (Test-Path -LiteralPath $runner -PathType Leaf) 'builder creates a runner executable'
    Assert (@([AppDomain]::CurrentDomain.GetAssemblies()|Where-Object{$_.Location -eq $runner}).Count -eq 0) 'builder never loads the generated executable into the installer'
    $bytes=[IO.File]::ReadAllBytes($runner);$pe=[BitConverter]::ToInt32($bytes,0x3c)
    Assert ([BitConverter]::ToUInt32($bytes,$pe) -eq 0x4550) 'runner has a valid Portable Executable header'
    Assert ([BitConverter]::ToUInt16($bytes,$pe+92) -eq 2) 'runner is a GUI-subsystem executable and cannot allocate a console on entry'
    $originalHash=(Get-FileHash -LiteralPath $runner).Hash
    Assert-Throws {Build-LpSilentRunner -SourcePath (Join-Path $client 'SilentRunner.cs') -OutputPath $runner} 'builder refuses to overwrite an existing executable'
    Assert ((Get-FileHash -LiteralPath $runner).Hash -ceq $originalHash) 'refused overwrite preserves original bytes'
    [IO.File]::WriteAllText((Join-Path $own 'config.json'),'{}',$utf8)
    [IO.File]::WriteAllText((Join-Path $foreign 'Update-LeadPartner.ps1'),'throw "Wrong working-directory entry must never run."',$utf8)
    [IO.File]::WriteAllText((Join-Path $foreign 'config.json'),'foreign config sentinel',$utf8)
    Write-Entry $own
    Assert ((Run-Fixture $runner $foreign) -eq 0) 'runner executes own fixed script, independent of caller working directory'
    Assert-NoChildConsole (Join-Path $own 'child-proof.json')
    Write-Entry $own -ExitCode 7
    Assert ((Run-Fixture $runner $foreign) -eq 7) 'nonzero child exit code is propagated to Task Scheduler'
    Assert-NoChildConsole (Join-Path $own 'child-proof.json')
    Write-Entry $own -LargeOutput
    Assert ((Run-Fixture $runner $foreign) -eq 0) 'simultaneous large stdout/stderr are drained asynchronously without deadlock'
    Assert-NoChildConsole (Join-Path $own 'child-proof.json')
    Remove-Item -LiteralPath (Join-Path $own 'child-proof.json') -Force
    Assert ((Run-Fixture $runner $foreign '-Command "anything"') -ne 0) 'runner rejects external command arguments'
    Assert (-not(Test-Path -LiteralPath (Join-Path $own 'child-proof.json'))) 'rejected arguments do not start the child'
    Assert ((Run-Fixture $runner $foreign '--once -Command "anything"') -eq 64) 'once mode accepts no extra command arguments'
    Assert (-not(Test-Path -LiteralPath (Join-Path $own 'child-proof.json'))) 'invalid once arguments start no child'
    Remove-Item -LiteralPath (Join-Path $own 'Update-LeadPartner.ps1') -Force
    Assert ((Run-Fixture $runner $foreign) -ne 0) 'missing fixed entry fails with nonzero status and no visible prompt'
    Write-Entry $own
    Remove-Item -LiteralPath (Join-Path $own 'config.json') -Force
    Assert ((Run-Fixture $runner $foreign) -ne 0) 'missing fixed config fails with nonzero status'
    [IO.File]::WriteAllText((Join-Path $own 'broken.cs'),'invalid C# fixture',$utf8)
    $brokenExe=Join-Path $own 'broken.exe'
    Assert-Throws {Build-LpSilentRunner -SourcePath (Join-Path $own 'broken.cs') -OutputPath $brokenExe} 'compiler failure is reported'
    Assert (-not(Test-Path -LiteralPath $brokenExe)) 'compiler failure never publishes a partial executable'
    Write-Output ('PASS: '+$script:checks+' silent runner checks')
} finally {
    if(Test-Path -LiteralPath $testRoot){
        $full=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
        if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full).StartsWith('LeadPartner-SilentRunner-')){Remove-Item -LiteralPath $full -Recurse -Force}
    }
}
