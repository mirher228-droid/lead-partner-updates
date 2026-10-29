# Windows PowerShell 5.1. Compile the real runner with a separate fixture entry
# point: only its network/process boundaries are substituted. No installed
# updater, browser, scheduled task, remote endpoint or production options change.
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$client=Join-Path (Split-Path -Parent $PSScriptRoot) 'client'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('LeadPartner-ResidentRunner-'+[guid]::NewGuid().ToString('N'))
$script:checks=0
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw ('FAIL: '+$Message)};$script:checks++}
function Build-Fixture([string]$Output,[string]$Harness){
    $provider=New-Object Microsoft.CSharp.CSharpCodeProvider
    $options=New-Object CodeDom.Compiler.CompilerParameters
    try{
        $options.GenerateExecutable=$true;$options.OutputAssembly=$Output
        $options.CompilerOptions='/target:winexe /optimize+ /main:RunnerFixture'
        [void]$options.ReferencedAssemblies.Add('System.dll')
        $result=$provider.CompileAssemblyFromSource($options,[string[]]@([IO.File]::ReadAllText((Join-Path $client 'SilentRunner.cs')),$Harness))
        if($result.Errors.HasErrors){throw (($result.Errors|ForEach-Object{$_.ToString()}) -join [Environment]::NewLine)}
    }finally{$provider.Dispose()}
}
function Start-Fixture([string]$Executable){
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
    return [Diagnostics.Process]::Start($info)
}
function Wait-File([string]$Path,[int]$Timeout=15000){
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while(-not [IO.File]::Exists($Path)){
        if($watch.ElapsedMilliseconds -gt $Timeout){throw ('Timed out waiting for '+$Path)}
        Start-Sleep -Milliseconds 50
    }
}
$policy=@'
using System;
using System.IO;
using System.Reflection;
using System.Threading;
internal static class RunnerFixture {
    static int checks;
    static void Check(bool yes,string name){if(!yes)throw new Exception(name);checks++;}
    static string Root;
    static void Stage(bool yes){foreach(string name in new string[]{"staged.json","staged.zip"}){string p=Path.Combine(Root,name);if(yes)File.WriteAllText(p,"fixture");else if(File.Exists(p))File.Delete(p);}}
    static int Main(){try{
        Root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        Check(LeadPartnerSilentRunner.RetryMilliseconds(1)==30000,"first failure waits 30 seconds");
        Check(LeadPartnerSilentRunner.RetryMilliseconds(2)==60000,"second failure waits 60 seconds");
        Check(LeadPartnerSilentRunner.RetryMilliseconds(3)==120000,"third failure waits 120 seconds");
        Check(LeadPartnerSilentRunner.RetryMilliseconds(4)==240000,"fourth failure waits 240 seconds");
        Check(LeadPartnerSilentRunner.RetryMilliseconds(100)==300000,"repeated failures capped at five minutes");
        string[] rejected={"http://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json","https://github.com.evil.test/update.json","https://github.com/other/repo/releases/download/v1/update.json","https://github.com/mirher228-droid/lead-partner-updates/releases/download/v1/other.zip","https://user@github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json","https://release-assets.githubusercontent.com:8443/a","file:///C:/update.json","https://evil.test/a"};
        foreach(string value in rejected)Check(!LeadPartnerSilentRunner.IsAllowedMetadataUri(new Uri(value)),"unsafe metadata redirect rejected: "+value);
        foreach(string value in new string[]{"https://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json","https://github.com/mirher228-droid/lead-partner-updates/releases/download/common-v1.2.39/update.json","https://release-assets.githubusercontent.com/github-production-release-asset/a?sig=b","https://objects.githubusercontent.com/github-production-release-asset/a"})Check(LeadPartnerSilentRunner.IsAllowedMetadataUri(new Uri(value)),"pinned release metadata redirect accepted");
        using(MemoryStream bytes=new MemoryStream(new byte[]{97,98,99}))Check(LeadPartnerSilentRunner.Fingerprint(bytes)=="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","bounded metadata hashed exactly");
        bool failed=false;try{using(MemoryStream bytes=new MemoryStream(new byte[65537]))LeadPartnerSilentRunner.Fingerprint(bytes);}catch(InvalidDataException){failed=true;}Check(failed,"metadata exceeding 64 KiB rejected");
        failed=false;try{using(MemoryStream bytes=new MemoryStream())LeadPartnerSilentRunner.Fingerprint(bytes);}catch(InvalidDataException){failed=true;}Check(failed,"empty metadata rejected");
        Check(LeadPartnerSilentRunner.ObjectSuffix(Root,"S-1-5-21-fixture")==LeadPartnerSilentRunner.ObjectSuffix(Root.ToUpperInvariant()+Path.DirectorySeparatorChar,"S-1-5-21-fixture"),"object identity canonicalizes root case/trailing separator");
        Check(LeadPartnerSilentRunner.ObjectSuffix(Root,"S-1-5-21-other")!=LeadPartnerSilentRunner.ObjectSuffix(Root,"S-1-5-21-fixture"),"object identity separates owners");
        Check(LeadPartnerSilentRunner.ObjectSuffix(Root+"-other","S-1-5-21-fixture")!=LeadPartnerSilentRunner.ObjectSuffix(Root,"S-1-5-21-fixture"),"object identity separates installations");
        using(ManualResetEvent stop=new ManualResetEvent(false)){
            long now=0;int fetches=0,workers=0,browserChecks=0;
            LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{fetches++;return "same";},delegate{workers++;return 0;},delegate{browserChecks++;return false;},delegate{return now;},delegate(int delay){Check(delay>0,"idle loop always waits");now+=delay;if(now>=95000)stop.Set();return stop.WaitOne(0);});
            Check(workers==1,"unchanged descriptor never relaunches full worker");Check(fetches==4,"descriptor checked initially then at 30,60,90 seconds");Check(browserChecks==0,"idle state does not enumerate browser processes");
        }
        using(ManualResetEvent stop=new ManualResetEvent(false)){
            long now=0;int workers=0;
            LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{return now<30000?"a":"b";},delegate{workers++;return 0;},delegate{return false;},delegate{return now;},delegate(int delay){now+=delay;if(now>=65000)stop.Set();return stop.WaitOne(0);});
            Check(workers==2,"changed descriptor triggers exactly one further worker");
        }
        using(ManualResetEvent stop=new ManualResetEvent(false)){
            long now=0;int workers=0,browserChecks=0;long applied=-1;
            LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{return "same";},delegate{workers++;if(workers==1)Stage(true);else{applied=now;Stage(false);}return 0;},delegate{browserChecks++;return now<7000;},delegate{return now;},delegate(int delay){now+=delay;if(now>=35000)stop.Set();return stop.WaitOne(0);});
            Check(workers==2 && applied==8000,"prepared update runs within two seconds of browser closure");Check(browserChecks<=6,"process polling stops when pending state clears");
        }
        using(ManualResetEvent stop=new ManualResetEvent(false)){
            long now=0;int workers=0;string attempts="";
            LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{return "same";},delegate{workers++;attempts+=now+",";return 7;},delegate{return false;},delegate{return now;},delegate(int delay){now+=delay;if(now>=220000)stop.Set();return stop.WaitOne(0);});
            Check(workers==4 && attempts=="0,30000,90000,210000,","worker errors back off without process spam");
        }
        using(ManualResetEvent stop=new ManualResetEvent(false)){
            long now=0;int workers=0,fetches=0;string attempts="";
            LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{fetches++;attempts+=now+",";throw new IOException("offline");},delegate{workers++;return 0;},delegate{return false;},delegate{return now;},delegate(int delay){now+=delay;if(now>=220000)stop.Set();return stop.WaitOne(0);});
            Check(workers==1,"offline descriptor checks never spawn repeated workers");Check(fetches==4 && attempts=="0,30000,90000,210000,","metadata failures back off independently");
        }
        using(ManualResetEvent stop=new ManualResetEvent(true)){
            int calls=0;LeadPartnerSilentRunner.RunLoop(Root,stop,delegate{calls++;return "same";},delegate{calls++;return 0;},delegate{calls++;return false;},delegate{return 0L;},delegate(int delay){return true;});Check(calls==0,"stop requested before launch prevents work");
        }
        File.WriteAllText(Path.Combine(Root,"policy-result.txt"),"PASS: "+checks+" resident policy checks");return 0;
    }catch(Exception e){File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),"policy-result.txt"),e.ToString());return 1;}}
}
'@
$resident=@'
using System;
using System.IO;
using System.Reflection;
internal static class RunnerFixture {
    static int Main(){string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);return LeadPartnerSilentRunner.RunResident(root,delegate{return "unchanged";},delegate{return LeadPartnerSilentRunner.RunWorker(root);},delegate{return File.Exists(Path.Combine(root,"browser-open"));});}
}
'@
$processes=New-Object Collections.Generic.List[Diagnostics.Process]
$events=New-Object Collections.Generic.List[Threading.EventWaitHandle]
try{
    [void][IO.Directory]::CreateDirectory($testRoot)
    Build-Fixture (Join-Path $testRoot 'Policy.exe') $policy
    $p=Start-Fixture (Join-Path $testRoot 'Policy.exe');$processes.Add($p)
    Assert ($p.WaitForExit(15000)) 'deterministic resident policy fixture exits'
    $result=[IO.File]::ReadAllText((Join-Path $testRoot 'policy-result.txt'))
    Assert ($p.ExitCode -eq 0) $result
    Write-Output $result
    $roots=@((Join-Path $testRoot 'Owner Root'),(Join-Path $testRoot 'Other Root'))
    foreach($root in $roots){
        [void][IO.Directory]::CreateDirectory($root)
        Build-Fixture (Join-Path $root 'Resident.exe') $resident
        [IO.File]::WriteAllText((Join-Path $root 'config.json'),'{}')
        [IO.File]::WriteAllText((Join-Path $root 'Update-LeadPartner.ps1'),@'
param([string]$ConfigPath)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'starts.txt'),"worker`r`n")
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'child-started'),'yes')
while(-not [IO.File]::Exists((Join-Path $PSScriptRoot 'release-child'))){Start-Sleep -Milliseconds 50}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'child-completed'),'yes')
exit 0
'@)
    }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach($root in $roots){
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$suffix=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid+'|'+[IO.Path]::GetFullPath($root).TrimEnd('\','/').ToUpperInvariant())))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
        # Installer must use this precise interoperable owner/root event name.
        $events.Add([Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Global\LeadPartner.Common.Stop.'+$suffix)))
    }
    $first=Start-Fixture (Join-Path $roots[0] 'Resident.exe');$processes.Add($first)
    Wait-File (Join-Path $roots[0] 'child-started')
    $second=Start-Fixture (Join-Path $roots[0] 'Resident.exe');$processes.Add($second)
    Assert ($second.WaitForExit(5000) -and $second.ExitCode -eq 0) 'duplicate resident exits without a second worker'
    Assert (@(Get-Content -LiteralPath (Join-Path $roots[0] 'starts.txt')).Count -eq 1) 'single instance protects one root and owner'
    $other=Start-Fixture (Join-Path $roots[1] 'Resident.exe');$processes.Add($other)
    Wait-File (Join-Path $roots[1] 'child-started')
    [void]$events[0].Set()
    Assert (-not $first.WaitForExit(500)) 'graceful stop waits for current child transaction'
    Assert (-not $other.HasExited) 'stop is scoped to its installation root'
    [IO.File]::WriteAllText((Join-Path $roots[0] 'release-child'),'yes')
    Assert ($first.WaitForExit(10000) -and $first.ExitCode -eq 0) 'resident exits after child finishes'
    Assert ([IO.File]::Exists((Join-Path $roots[0] 'child-completed'))) 'child is allowed to finish after stop'
    [void]$events[1].Set();[IO.File]::WriteAllText((Join-Path $roots[1] 'release-child'),'yes')
    Assert ($other.WaitForExit(10000)) 'second installation stops independently'
    # A stop arriving before entry must not be reset by a racing runner.
    $late=Start-Fixture (Join-Path $roots[0] 'Resident.exe');$processes.Add($late)
    Assert ($late.WaitForExit(5000)) 'pre-signalled stop prevents late scheduled launch'
    Assert (@(Get-Content -LiteralPath (Join-Path $roots[0] 'starts.txt')).Count -eq 1) 'pre-signalled stop starts no child'
    Write-Output ('PASS: '+$script:checks+' resident lifecycle checks')
}finally{
    foreach($root in @((Join-Path $testRoot 'Owner Root'),(Join-Path $testRoot 'Other Root'))){if([IO.Directory]::Exists($root)){[IO.File]::WriteAllText((Join-Path $root 'release-child'),'yes')}}
    foreach($event in $events){[void]$event.Set()}
    foreach($process in $processes){try{if(-not $process.HasExited){[void]$process.WaitForExit(15000)}}finally{$process.Dispose()}}
    foreach($event in $events){$event.Dispose()}
    $full=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full).StartsWith('LeadPartner-ResidentRunner-')){Remove-Item -LiteralPath $full -Recurse -Force}
}
