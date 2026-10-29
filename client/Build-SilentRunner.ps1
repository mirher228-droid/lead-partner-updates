# Functions only. Importing this builder never compiles, loads or starts a program.
function Build-LpSilentRunner {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$SourcePath,
        [Parameter(Mandatory=$true)][string]$OutputPath
    )
    $ErrorActionPreference = 'Stop'
    if (-not [IO.Path]::IsPathRooted($SourcePath) -or -not [IO.Path]::IsPathRooted($OutputPath)) { throw 'Absolute silent runner paths are required.' }
    $source = [IO.Path]::GetFullPath($SourcePath)
    $output = [IO.Path]::GetFullPath($OutputPath)
    if (-not [IO.File]::Exists($source)) { throw 'Silent runner source is missing.' }
    if ([IO.File]::Exists($output) -or [IO.Directory]::Exists($output)) { throw 'Silent runner output already exists.' }
    $directory = [IO.Path]::GetDirectoryName($output)
    if (-not [IO.Directory]::Exists($directory)) { throw 'Silent runner output directory is missing.' }
    $temporary = Join-Path $directory ('.LeadPartner.Runner-build-' + [guid]::NewGuid().ToString('N') + '.exe')
    $provider = $null
    $parameters = $null
    try {
        $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
        $parameters = New-Object CodeDom.Compiler.CompilerParameters
        $parameters.GenerateExecutable = $true
        $parameters.GenerateInMemory = $false
        $parameters.IncludeDebugInformation = $false
        $parameters.OutputAssembly = $temporary
        $parameters.CompilerOptions = '/target:winexe /optimize+ /platform:anycpu'
        $parameters.ReferencedAssemblies.Add('System.dll') | Out-Null
        $parameters.TempFiles = New-Object CodeDom.Compiler.TempFileCollection($directory,$false)
        $compiled = $provider.CompileAssemblyFromSource($parameters,[IO.File]::ReadAllText($source))
        if ($compiled.Errors.HasErrors -or $compiled.NativeCompilerReturnValue -ne 0 -or -not [IO.File]::Exists($temporary)) {
            throw 'Silent runner compilation failed. No executable was installed.'
        }
        # File.Move refuses an existing target, including a file created after
        # preflight. Never load CompiledAssembly into the installer process.
        [IO.File]::Move($temporary,$output)
        return $output
    } finally {
        if ($parameters) { $parameters.TempFiles.Delete() }
        if ($provider) { $provider.Dispose() }
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}
