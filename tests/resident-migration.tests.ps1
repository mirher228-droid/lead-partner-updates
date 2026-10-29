# Windows PowerShell 5.1; isolated runner coordination, no tasks or real extension.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$client = Join-Path (Split-Path -Parent $PSScriptRoot) 'client'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('LeadPartnerUpdater-Test-' + [guid]::NewGuid().ToString('N'))
$root = Join-Path $fixture 'Common'
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$checks = 0
function Assert([bool]$Condition,[string]$Message) { if(-not $Condition){throw ('FAIL: '+$Message)}; $script:checks++ }
$process = $null
$maintenance = $null
try {
    foreach($name in @('Enter-LpRunnerMaintenance','Exit-LpRunnerMaintenance')) {
        $definitions = @()
        foreach($file in @('Install-AutoUpdate.ps1','Uninstall-AutoUpdate.ps1')) {
            $tokens=$null; $errors=$null
            $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $client $file),[ref]$tokens,[ref]$errors)
            $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
            Assert ($null -ne $function) ($file+' contains '+$name)
            $definitions += $function.Extent.Text
        }
        Assert ($definitions[0] -ceq $definitions[1]) ('install and uninstall use identical '+$name)
        . ([scriptblock]::Create($definitions[0]))
    }
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $source=@'
using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
internal static class MigrationFixture {
 static int Main() {
  string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
  string key=WindowsIdentity.GetCurrent().User.Value+"|"+Path.GetFullPath(root).TrimEnd('\\','/').ToUpperInvariant();
  string suffix; using(var hash=SHA256.Create()){suffix=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(key))).Replace("-","").ToLowerInvariant();}
  using(var mutex=new Mutex(false,"Global\\LeadPartner.Common.Runner."+suffix)) {
   if(!mutex.WaitOne(0))return 2;
   try { using(var stop=new EventWaitHandle(false,EventResetMode.ManualReset,"Global\\LeadPartner.Common.Stop."+suffix)) {
    File.WriteAllText(Path.Combine(root,"started"),"yes");
    if(!stop.WaitOne(15000))return 3;
    // Simulate finishing a transaction. Maintenance must wait, never kill it.
    Thread.Sleep(450);
    File.WriteAllText(Path.Combine(root,"finished"),"yes");
   }} finally {mutex.ReleaseMutex();}
  }
  return 0;
 }
}
'@
    # Single-quoted PowerShell here-string contains normal C# backslash escaping.
    $source=$source.Replace("'\\\\'","'\\'").Replace('Global\\\\','Global\\')
    $sourcePath=Join-Path $fixture 'holder.cs'
    [IO.File]::WriteAllText($sourcePath,$source,[Text.UTF8Encoding]::new($false))
    . (Join-Path $client 'Build-SilentRunner.ps1')
    $exe=Join-Path $root 'LeadPartner.Runner.exe'
    Build-LpSilentRunner -SourcePath $sourcePath -OutputPath $exe | Out-Null
    $start=[Diagnostics.ProcessStartInfo]::new($exe)
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $process=[Diagnostics.Process]::Start($start)
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while(-not [IO.File]::Exists((Join-Path $root 'started')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 25}
    Assert ([IO.File]::Exists((Join-Path $root 'started'))) 'owned fixture acquired the watcher mutex'
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $maintenance=Enter-LpRunnerMaintenance $root
    Assert ([IO.File]::Exists((Join-Path $root 'finished'))) 'maintenance waited for active transaction to finish'
    Assert ($clock.ElapsedMilliseconds -ge 350) 'transaction was not terminated to replace the watcher'
    Assert ($process.WaitForExit(3000) -and $process.ExitCode -eq 0) 'watcher exited gracefully'
    $replacement=Join-Path $root 'replacement.exe'
    [IO.File]::Copy($exe,$replacement)
    [IO.File]::Replace($replacement,$exe,[Management.Automation.Language.NullString]::Value)
    Assert ([IO.File]::Exists($exe)) 'resident image is released before replacement'
    Assert ($maintenance.StopEvent.WaitOne(0)) 'stop remains set throughout maintenance'
    Exit-LpRunnerMaintenance $maintenance; $maintenance=$null
    $next=Enter-LpRunnerMaintenance $root
    Assert ($null -ne $next) 'coordination can be acquired again after maintenance'
    Exit-LpRunnerMaintenance $next
    Write-Output ('PASS resident migration: '+$checks+' checks')
} finally {
    if($maintenance){Exit-LpRunnerMaintenance $maintenance}
    if($process){ if(-not $process.HasExited){$null=$process.WaitForExit(16000)}; $process.Dispose() }
    $full=[IO.Path]::GetFullPath($fixture)
    if((Test-Path -LiteralPath $full) -and $full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $full) -match '^LeadPartnerUpdater-Test-[a-f0-9]{32}$') { Remove-Item -LiteralPath $full -Recurse -Force }
}
