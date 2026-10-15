$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CalendarActivity {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  public static uint ForegroundProcess() { uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id); return id; }
  public static uint IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return UInt32.MaxValue;
    return unchecked((uint)Environment.TickCount - info.dwTime) / 1000;
  }
}
'@
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::WriteLine('{"ready":true}')
while ($true) {
  $activityApp = $null
  try { $activityApp = (Get-Process -Id ([CalendarActivity]::ForegroundProcess()) -ErrorAction Stop).ProcessName } catch {}
  [Console]::WriteLine((@{ app = $activityApp; idleSeconds = [CalendarActivity]::IdleSeconds() } | ConvertTo-Json -Compress))
  Start-Sleep -Seconds 5
}
