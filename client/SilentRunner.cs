using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

// Windows/GUI entry point. Only resident mode and the fixed --once worker
// are accepted. Script, configuration, HTTPS endpoint and timings are pinned.
internal static class LeadPartnerSilentRunner
{
    private const string Endpoint = "https://github.com/mirher228-droid/lead-partner-updates/releases/latest/download/update.json";
    private const int PollMilliseconds = 30000;
    private const int BrowserMilliseconds = 2000;
    private const int MetadataLimit = 65536;

    private static int Main(string[] arguments)
    {
        bool once = arguments.Length == 1 && arguments[0] == "--once";
        if (arguments.Length != 0 && !once) return 64;
        try
        {
            string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (!File.Exists(Path.Combine(directory, "Update-LeadPartner.ps1")) ||
                !File.Exists(Path.Combine(directory, "config.json")) || !File.Exists(PowerShellPath())) return 66;
            return RunOwned(directory, once, FetchFingerprint,
                delegate { return RunWorker(directory); }, BrowsersRunning);
        }
        catch { return 70; }
    }

    internal static string ObjectSuffix(string directory, string sid)
    {
        string canonical = Path.GetFullPath(directory).TrimEnd('\\', '/').ToUpperInvariant();
        using (SHA256 hash = SHA256.Create())
            return Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(sid + "|" + canonical)));
    }

    internal static int RunResident(string directory, Func<string> fetch, Func<int> worker, Func<bool> browser)
    {
        return RunOwned(directory, false, fetch, worker, browser);
    }

    private static int RunOwned(string directory, bool once, Func<string> fetch, Func<int> worker, Func<bool> browser)
    {
        string suffix;
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            suffix = ObjectSuffix(directory, identity.User.Value);
        using (Mutex mutex = new Mutex(false, @"Global\LeadPartner.Common.Runner." + suffix))
        {
            bool owned = false;
            try
            {
                try { owned = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { owned = true; }
                if (!owned) return 0;
                using (EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset,
                    @"Global\LeadPartner.Common.Stop." + suffix))
                {
                    // Preserve maintenance stops signalled before this entry.
                    if (stop.WaitOne(0)) return 0;
                    if (once) return worker();
                    Stopwatch clock = Stopwatch.StartNew();
                    return RunLoop(directory, stop, fetch, worker, browser,
                        delegate { return clock.ElapsedMilliseconds; },
                        delegate(int delay) { return stop.WaitOne(delay); });
                }
            }
            finally { if (owned) mutex.ReleaseMutex(); }
        }
    }

    internal static int RetryMilliseconds(int failures)
    {
        if (failures >= 5) return 300000;
        return PollMilliseconds * (1 << Math.Max(0, failures - 1));
    }

    // Explicit I/O and clock boundaries keep the actual scheduling logic
    // testable without real network requests or browser manipulation.
    internal static int RunLoop(string directory, WaitHandle stop, Func<string> fetch,
        Func<int> worker, Func<bool> browser, Func<long> now, Func<int, bool> wait)
    {
        string fingerprint = null;
        bool requested = true;
        bool browserWasOpen = false;
        int fetchFailures = 0, workerFailures = 0;
        long nextFetch = 0, nextWorker = 0, nextBrowser = 0;
        while (!stop.WaitOne(0))
        {
            long time = now();
            if (time >= nextFetch)
            {
                try
                {
                    string observed = fetch();
                    if (!String.Equals(observed, fingerprint, StringComparison.Ordinal)) requested = true;
                    fingerprint = observed;
                    fetchFailures = 0;
                }
                catch { fetchFailures = Math.Min(fetchFailures + 1, 5); }
                nextFetch = now() + RetryMilliseconds(fetchFailures);
            }
            if (stop.WaitOne(0)) break;
            bool pending = HasPending(directory);
            bool ready = false;
            time = now();
            if (pending && time >= nextBrowser)
            {
                // Fail closed. The worker rechecks before every actual write.
                try { ready = !browser(); }
                catch { ready = false; }
                // Closing a previously observed browser releases a prepared
                // update immediately, without bypassing an error backoff.
                if (ready && browserWasOpen && workerFailures == 0) nextWorker = time;
                browserWasOpen = !ready;
                nextBrowser = now() + BrowserMilliseconds;
            }
            if (!pending) browserWasOpen = false;
            if ((requested || ready) && time >= nextWorker)
            {
                if (stop.WaitOne(0)) break;
                int result;
                try { result = worker(); }
                catch { result = 70; }
                requested = result != 0;
                workerFailures = result == 0 ? 0 : Math.Min(workerFailures + 1, 5);
                // A successful worker can still defer if a browser reopens.
                // Keep a cooldown when pending work does not clear.
                nextWorker = now() + RetryMilliseconds(workerFailures);
                nextBrowser = 0;
                continue;
            }
            long wake = nextFetch;
            if (requested) wake = Math.Min(wake, nextWorker);
            if (pending) wake = Math.Min(wake, nextBrowser);
            int delay = (int)Math.Max(1, Math.Min(Int32.MaxValue, wake - now()));
            if (wait(delay)) break;
        }
        return 0;
    }

    private static bool HasPending(string directory)
    {
        return File.Exists(Path.Combine(directory, "journal.json")) ||
            (File.Exists(Path.Combine(directory, "staged.json")) && File.Exists(Path.Combine(directory, "staged.zip")));
    }

    private static bool BrowsersRunning()
    {
        foreach (string name in new string[] { "chrome", "msedge", "browser", "chromium", "brave", "vivaldi", "opera", "firefox" })
        {
            Process[] processes = Process.GetProcessesByName(name);
            bool found = processes.Length != 0;
            foreach (Process process in processes) process.Dispose();
            if (found) return true;
        }
        return false;
    }

    internal static bool IsAllowedMetadataUri(Uri uri)
    {
        if (uri == null || !uri.IsAbsoluteUri || uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0) return false;
        if (uri.Host.Equals("release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
            uri.Host.Equals("objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase)) return true;
        if (!uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)) return false;
        return uri.AbsolutePath == "/mirher228-droid/lead-partner-updates/releases/latest/download/update.json" ||
            (uri.AbsolutePath.StartsWith("/mirher228-droid/lead-partner-updates/releases/download/", StringComparison.Ordinal) &&
             uri.AbsolutePath.EndsWith("/update.json", StringComparison.Ordinal));
    }

    private static string FetchFingerprint()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Uri uri = new Uri(Endpoint);
        Stopwatch deadline = Stopwatch.StartNew();
        for (int redirects = 0; redirects <= 5; redirects++)
        {
            if (!IsAllowedMetadataUri(uri)) throw new InvalidDataException("Untrusted metadata redirect.");
            int remaining = 10000 - (int)deadline.ElapsedMilliseconds;
            if (remaining <= 0) throw new TimeoutException("Metadata timeout.");
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
            request.AllowAutoRedirect = false;
            request.Timeout = remaining;
            request.ReadWriteTimeout = remaining;
            request.MaximumResponseHeadersLength = 16;
            request.UseDefaultCredentials = false;
            request.UserAgent = "LeadPartner-Common-Watcher/1";
            request.Headers[HttpRequestHeader.CacheControl] = "no-cache";
            // A single deadline covers all redirects and stalled response bodies.
            using (Timer timeout = new Timer(delegate(object state) { request.Abort(); }, null, remaining, Timeout.Infinite))
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                int status = (int)response.StatusCode;
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308)
                {
                    string location = response.Headers[HttpResponseHeader.Location];
                    if (String.IsNullOrEmpty(location)) throw new InvalidDataException("Missing metadata redirect.");
                    uri = new Uri(uri, location);
                    continue;
                }
                if (response.StatusCode != HttpStatusCode.OK || response.ContentLength > MetadataLimit)
                    throw new InvalidDataException("Metadata response is invalid or too large.");
                using (Stream body = response.GetResponseStream()) return Fingerprint(body);
            }
        }
        throw new InvalidDataException("Too many metadata redirects.");
    }

    internal static string Fingerprint(Stream stream)
    {
        using (MemoryStream bytes = new MemoryStream())
        {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (bytes.Length + count > MetadataLimit) throw new InvalidDataException("Metadata is too large.");
                bytes.Write(buffer, 0, count);
            }
            if (bytes.Length == 0) throw new InvalidDataException("Metadata is empty.");
            using (SHA256 hash = SHA256.Create()) return Hex(hash.ComputeHash(bytes.ToArray()));
        }
    }

    private static string Hex(byte[] bytes)
    {
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    private static string PowerShellPath()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
    }

    internal static int RunWorker(string directory)
    {
        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = PowerShellPath();
        start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
            + Path.Combine(directory, "Update-LeadPartner.ps1") + "\" -ConfigPath \"" + Path.Combine(directory, "config.json") + "\"";
        start.WorkingDirectory = directory;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        using (Process child = new Process())
        {
            child.StartInfo = start;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs data) { };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs data) { };
            if (!child.Start()) return 70;
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            // A maintenance stop never terminates a transaction in progress.
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
