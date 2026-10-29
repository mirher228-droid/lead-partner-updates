using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

// Compiled as Windows/GUI, so the scheduled action allocates no console.
// The only child is the fixed updater beside this executable. No arguments,
// executable names, script paths or commands are accepted from the caller.
internal static class LeadPartnerSilentRunner
{
    private static int Main(string[] arguments)
    {
        if (arguments.Length != 0) return 64;
        try
        {
            string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string script = Path.Combine(directory, "Update-LeadPartner.ps1");
            string config = Path.Combine(directory, "config.json");
            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(script) || !File.Exists(config) || !File.Exists(powershell)) return 66;

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = powershell;
            start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
                + script + "\" -ConfigPath \"" + config + "\"";
            start.WorkingDirectory = directory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;

            using (Process child = new Process())
            {
                child.StartInfo = start;
                // Drain both streams independently. The updater already writes
                // its bounded status/log files; retaining output here adds no value.
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs data) { };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs data) { };
                if (!child.Start()) return 70;
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch
        {
            // A failed background launch must remain silent, but visible as a
            // nonzero Task Scheduler result. Never show a dialog or a console.
            return 70;
        }
    }
}
