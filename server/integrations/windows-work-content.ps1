param([ValidateSet('list','read')][string]$Mode='list',[int]$ProcessId=0,[long]$WindowHandle=0,[switch]$AllowOcr,[switch]$SyntheticFixture)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
try {
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  $windows=@();if(-not $SyntheticFixture){$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)}
  if($Mode -eq 'list') {
    $items=@();foreach($window in $windows){try{$pidValue=$window.Current.ProcessId;$process=Get-Process -Id $pidValue -ErrorAction Stop;if($window.Current.NativeWindowHandle -and -not $window.Current.IsOffscreen){$items+=@{processId=$pidValue;windowHandle=$window.Current.NativeWindowHandle;app=$process.ProcessName}}}catch{}}
    @{windows=@($items | Select-Object -First 40)} | ConvertTo-Json -Depth 4 -Compress;exit
  }
  $fixture=$null
  if($SyntheticFixture){Add-Type -AssemblyName System.Windows.Forms;$fixture=New-Object System.Windows.Forms.Form;$textbox=New-Object System.Windows.Forms.TextBox;$textbox.Multiline=$true;$textbox.Text='Please revise the three synthetic charts.';$fixture.Controls.Add($textbox);$fixtureHandle=$fixture.Handle;$textboxHandle=$textbox.Handle;$ProcessId=$PID;$WindowHandle=$fixtureHandle.ToInt64()}
  if($ProcessId -le 0 -or $WindowHandle -le 0){throw 'Select a window first'}
  $selected=$null;foreach($window in $windows){if($window.Current.ProcessId -eq $ProcessId -and $window.Current.NativeWindowHandle -eq $WindowHandle){$selected=$window;break}}
  if($SyntheticFixture){$selected=[System.Windows.Automation.AutomationElement]::FromHandle($textboxHandle)}
  if($null -eq $selected -or (-not $SyntheticFixture -and $selected.Current.IsOffscreen)){throw 'Selected window is unavailable or hidden'}
  $process=Get-Process -Id $ProcessId -ErrorAction Stop
  if($process.ProcessName -match '^(CredentialUIBroker|LogonUI|consent|KeePass|1Password|Bitwarden)$'){throw 'This app is excluded from capture'}
  $parts=New-Object System.Collections.Generic.List[string]
  $nodes=New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]';$nodes.Add($selected)
  foreach($descendant in $selected.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){$nodes.Add($descendant)}
  for($i=0;$i -lt [Math]::Min($nodes.Count,500);$i++){
    $node=$nodes.Item($i)
    try{
      if($node.Current.IsPassword -or (-not $SyntheticFixture -and $node.Current.IsOffscreen)){continue}
      $pattern=$null
      if($node.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){$value=$pattern.DocumentRange.GetText(40000)}
      elseif($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$value=$pattern.Current.Value}
      else{$value=$node.Current.Name}
      if($value -and -not $parts.Contains($value)){$parts.Add($value)}
    }catch{}
  }
  $text=[string]::Join("`n",$parts);$method='uia'
  if($text.Trim().Length -lt 20 -and $AllowOcr){
    $temporary=$null
    try{
      Add-Type -AssemblyName System.Runtime.WindowsRuntime,System.Drawing
      Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class CaptureForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags); }'
      if([CaptureForeground]::GetForegroundWindow().ToInt64() -ne $WindowHandle){throw 'Bring the selected window to the foreground for OCR'}
      [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
      [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
      [Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
      [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
      [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
      [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
      function Await-Operation($operation,$type){$methodInfo=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1;$task=$methodInfo.MakeGenericMethod($type).Invoke($null,@($operation));if(-not $task.Wait(5000)){throw 'OCR timed out'};return $task.Result}
      $bounds=$selected.Current.BoundingRectangle
      if($bounds.Width -gt 4000 -or $bounds.Height -gt 4000 -or $bounds.Width -lt 1 -or $bounds.Height -lt 1){throw 'Unsupported window dimensions'}
      $image=New-Object System.Drawing.Bitmap([int]$bounds.Width,[int]$bounds.Height);$graphics=[System.Drawing.Graphics]::FromImage($image)
      $memory=New-Object System.IO.MemoryStream
      try{$dc=$graphics.GetHdc();try{if(-not [CaptureForeground]::PrintWindow([IntPtr]$WindowHandle,$dc,2)){throw 'This app cannot provide a window-only OCR image'}}finally{$graphics.ReleaseHdc($dc)};$image.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png);$bytes=$memory.ToArray()}finally{$graphics.Dispose();$image.Dispose();$memory.Dispose()}
      $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;$writer=New-Object Windows.Storage.Streams.DataWriter($stream)
      try{$writer.WriteBytes($bytes);$stored=Await-Operation ($writer.StoreAsync()) ([uint32]);$detached=$writer.DetachStream()}finally{$writer.Dispose()};$stream.Seek(0)
      try{$decoder=Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]);$bitmap=Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]);try{$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages();if($null -eq $engine){throw 'Install a Windows OCR language'};$recognized=Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]);$text=$recognized.Text;$method='ocr'}finally{$bitmap.Dispose()}}finally{$stream.Dispose()}
    }finally{if($temporary -and [System.IO.File]::Exists($temporary)){[System.IO.File]::Delete($temporary)}}
  }
  if(-not $text.Trim()){throw 'No accessible text; this app may be unsupported'}
  if($text.Length -gt 40000){$text=$text.Substring(0,40000)}
  @{processId=$ProcessId;windowHandle=$WindowHandle;app=$process.ProcessName;method=$method;text=$text;observedAt=[DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")} | ConvertTo-Json -Compress
}catch{if($SyntheticFixture){[Console]::Error.WriteLine($_.Exception.Message)};@{error='Selected-window text could not be captured. The window may be hidden, inaccessible, excluded, or local OCR unavailable.'} | ConvertTo-Json -Compress;exit 1}
