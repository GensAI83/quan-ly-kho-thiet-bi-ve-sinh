$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($appRoot -match '^[Cc]:\\') { throw 'Hay giu ung dung tren o D hoac E.' }
$env:TEMP = Join-Path $appRoot 'temp'
$env:TMP = $env:TEMP
$env:BUN_RUNTIME_TRANSPILER_CACHE_PATH = Join-Path $appRoot 'cache\transpiler'
Write-Output 'Chuyen kho tu may tinh len may chu. Kho online phai moi va chua dang nhap PIN lan nao.'
$onlineAddress = Read-Host 'Nhap dia chi HTTPS cua kho online'
$remotePassword = Read-Host 'Mat khau truy cap tu xa (khong phai PIN nhan vien)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($remotePassword)
try {
    $plainRemotePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    Write-Output 'Dang tat ban offline de du lieu khong thay doi trong khi chuyen...'
    & (Join-Path $PSScriptRoot 'Stop-Kho.ps1')
    $inputPayload = @{ origin = $onlineAddress; password = $plainRemotePassword; sourceDatabase = (Join-Path $appRoot 'data\warehouse.sqlite') } | ConvertTo-Json -Compress
    $inputPayload | & (Join-Path $appRoot 'tools\bun.exe') run (Join-Path $appRoot 'source\scripts\transfer-cloud-data.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Chua chuyen xong. Du lieu tren D duoc giu nguyen; co the mo lai MoKho.cmd de dung offline.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $plainRemotePassword = $null
    $inputPayload = $null
}
Read-Host 'Nhan Enter de dong'
