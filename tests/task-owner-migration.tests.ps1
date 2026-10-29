# Actual ownership guards only; no task registration, process launch, or runtime mutation.
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2
$repo=Split-Path -Parent $PSScriptRoot
$owner=[Security.Principal.WindowsIdentity]::GetCurrent();$ownerSid=$owner.User.Value
$root=Join-Path ([IO.Path]::GetTempPath()) 'LeadPartner task fixture Кириллица\Common'
$taskName='LeadPartner-Common-AutoUpdate-'+$ownerSid
$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runner=Join-Path $root 'LeadPartner.Runner.exe'
$legacyArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $root 'Update-LeadPartner.ps1')+'" -ConfigPath "'+(Join-Path $root 'config.json')+'"'
$shortOwnerName=($owner.Name -split '\\',2)[-1]
$resolvedShortSid=([Security.Principal.NTAccount]::new($shortOwnerName)).Translate([Security.Principal.SecurityIdentifier]).Value
if($resolvedShortSid -cne $ownerSid){throw 'Current short-account test prerequisite did not resolve to the actual owner SID'}
$foreignAccountName=([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')).Translate([Security.Principal.NTAccount]).Value
if(([Security.Principal.NTAccount]::new($foreignAccountName)).Translate([Security.Principal.SecurityIdentifier]).Value -ceq $ownerSid){throw 'Foreign-account test prerequisite unexpectedly equals owner SID'}
$script:fixtureTask=$null;$script:reads=0;$checks=0
function global:Get-ScheduledTask {param($TaskName,$TaskPath,$ErrorAction);$script:reads++;return $script:fixtureTask}
function New-Task($Execute,$Arguments,$WorkingDirectory=$root,$Principal=$ownerSid){
 return [pscustomobject]@{Principal=[pscustomobject]@{UserId=$Principal};Actions=@([pscustomobject]@{Execute=$Execute;Arguments=$Arguments;WorkingDirectory=$WorkingDirectory})}
}
function Get-Guard([string]$File){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'Guard source does not parse'}
 $definition=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Get-ValidatedExistingTask','Assert-ExistingTaskOwner')},$true)
 if($definition){$text=$definition.Body.Extent.Text}
 else {
  # Baseline uninstaller kept the same actual validation inline.
  $branch=$ast.Find({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq '-not $NoUnregisterTask' -and $node.Clauses[0].Item2.Extent.Text.Contains('Get-ScheduledTask')},$true)
  if(-not $branch){throw 'Actual task ownership guard not found'}
  $text=$branch.Clauses[0].Item2.Extent.Text
  # Avoid importing a local-scope module command over our read-only stub.
  $text=$text -replace '(?m)^\s*Import-Module ScheduledTasks -ErrorAction Stop\r?$',''
 }
 return [scriptblock]::Create($text.Substring(1,$text.Length-2))
}
$cases=@(
 @{name='no previous task';task=$null;pass=$true},
 @{name='owned legacy PowerShell action';task=(New-Task $powerShell $legacyArgs);pass=$true},
 @{name='owned legacy account-name principal';task=(New-Task $powerShell $legacyArgs $root $owner.Name);pass=$true},
 @{name='owned silent action';task=(New-Task $runner '');pass=$true},
 @{name='silent account-name principal';task=(New-Task $runner '' $root $owner.Name);pass=$true},
 @{name='legacy resolved short current principal';task=(New-Task $powerShell $legacyArgs $root $shortOwnerName);pass=$true},
 @{name='silent resolved short current principal';task=(New-Task $runner '' $root $shortOwnerName);pass=$true},
 @{name='unresolvable principal';task=(New-Task $runner '' $root 'LeadPartnerUnresolvable-80a26aa96efa4e5a97a3032f689cb6b7');pass=$false},
 @{name='resolved foreign principal';task=(New-Task $runner '' $root $foreignAccountName);pass=$false},
 @{name='foreign SID';task=(New-Task $runner '' $root 'S-1-5-21-111-222-333-999');pass=$false},
 @{name='foreign runner';task=(New-Task 'C:\Foreign\LeadPartner.Runner.exe' '');pass=$false},
 @{name='silent unexpected args';task=(New-Task $runner '-File C:\foreign.ps1');pass=$false},
 @{name='silent whitespace args';task=(New-Task $runner ' ');pass=$false},
 @{name='silent foreign working directory';task=(New-Task $runner '' 'C:\Foreign');pass=$false},
 @{name='legacy prefixed injection';task=(New-Task $powerShell ('-EncodedCommand AAA '+$legacyArgs));pass=$false},
 @{name='legacy suffixed injection';task=(New-Task $powerShell ($legacyArgs+' -Command unexpected'));pass=$false},
 @{name='legacy foreign config';task=(New-Task $powerShell ($legacyArgs.Replace((Join-Path $root 'config.json'),'C:\Foreign\config.json')));pass=$false}
)
$multi=New-Task $runner ''; $multi.Actions=@($multi.Actions[0],$multi.Actions[0]);$cases+=@{name='multiple actions';task=$multi;pass=$false}
$empty=New-Task $runner ''; $empty.Actions=@();$cases+=@{name='zero actions';task=$empty;pass=$false}
$failures=@()
foreach($file in @('Install-AutoUpdate.ps1','Uninstall-AutoUpdate.ps1')){
 $guard=Get-Guard (Join-Path $repo ('client/'+$file))
 foreach($case in $cases){
  $script:fixtureTask=$case.task;$script:reads=0;$passed=$true
  try {& $guard | Out-Null}catch{$passed=$false}
  if($passed -ne $case.pass -or $script:reads -ne 1){$failures+=($file+': '+$case.name)}
  else{$checks++}
 }
}
if($failures.Count){throw ('FAIL actual migration guards: '+($failures -join '; '))}
Write-Output ('PASS actual legacy/silent ownership migration guards: '+$checks+' checks; no tasks or runtime changed')
