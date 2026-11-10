param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
    if ($appRoot -match '^[Cc]:\\') { throw 'Hay dat ung dung tren o D hoac E, khong dung o C.' }
    foreach ($folder in @('data','backups','exports','logs','temp','browser-profile','browser-cache')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $appRoot $folder) | Out-Null
    }
    $env:KHO_HOME = $appRoot
    $env:TEMP = Join-Path $appRoot 'temp'
    $env:TMP = $env:TEMP
    $env:BUN_RUNTIME_TRANSPILER_CACHE_PATH = Join-Path $appRoot 'cache\transpiler'
    $settings = Get-Content -LiteralPath (Join-Path $appRoot 'cau-hinh.json') -Raw | ConvertFrom-Json
    $appPort = [int]$settings.port
    if ($appPort -lt 1024 -or $appPort -gt 65535) { throw 'Cong trong cau-hinh.json khong hop le.' }
    $appUrl = 'http://127.0.0.1:' + $appPort
    $health = $null
    try { $health = Invoke-RestMethod -Uri ($appUrl + '/health') -TimeoutSec 2 } catch {}
    if ($null -ne $health -and ($health.app -ne 'quan-ly-kho-local' -or $health.root -ne $appRoot)) { throw 'Cong dang duoc ung dung khac su dung. Doi port trong cau-hinh.json.' }
    if ($null -eq $health) {
        $serverProcess = Start-Process -FilePath (Join-Path $appRoot 'QuanLyKho.exe') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $appRoot 'logs\server-stdout.log') -RedirectStandardError (Join-Path $appRoot 'logs\server-stderr.log')
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            try { $health = Invoke-RestMethod -Uri ($appUrl + '/health') -TimeoutSec 1; break } catch {}
            if ($serverProcess.HasExited) { break }
        }
        if ($null -eq $health -or $health.app -ne 'quan-ly-kho-local' -or $health.root -ne $appRoot) { throw ('Khong mo duoc ung dung. Xem ' + (Join-Path $appRoot 'logs\server-stderr.log')) }
    }
    if ($NoBrowser) { Write-Output $appUrl; exit 0 }
    $browserProfilePath = Join-Path $appRoot 'browser-profile'
    $preferencePath = Join-Path $browserProfilePath 'Default\Preferences'
    if (-not (Test-Path -LiteralPath $preferencePath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $preferencePath) | Out-Null
        $exportPath = Join-Path $appRoot 'exports'
        $preferences = @{ download = @{ default_directory = $exportPath; prompt_for_download = $false; directory_upgrade = $true }; savefile = @{ default_directory = $exportPath }; browser = @{ check_default_browser = $false } }
        [System.IO.File]::WriteAllText($preferencePath, ($preferences | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
    }
    $browserCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $browserExe = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $browserExe) { throw 'Can Edge hoac Chrome da co tren may de mo ho so rieng luu tren o D.' }
    $browserArguments = @('--user-data-dir="' + $browserProfilePath + '"','--disk-cache-dir="' + (Join-Path $appRoot 'browser-cache') + '"','--crash-dumps-dir="' + (Join-Path $appRoot 'temp') + '"','--no-first-run','--no-default-browser-check','--new-window',$appUrl)
    Start-Process -FilePath $browserExe -ArgumentList $browserArguments -WindowStyle Normal | Out-Null
} catch {
    $errorText = $_.Exception.Message
    if ($NoBrowser) { Write-Error $errorText; exit 1 }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($errorText, 'Quan ly kho') | Out-Null
    exit 1
}
