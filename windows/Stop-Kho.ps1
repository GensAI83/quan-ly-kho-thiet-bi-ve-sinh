$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$statePath = Join-Path $appRoot 'data\runtime.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'Ung dung da tat.'; exit 0 }
$appState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($appState.app -ne 'quan-ly-kho-local' -or $appState.root -ne $appRoot) { throw 'Thong tin ung dung khong khop. Khong tat tien trinh khac.' }
$stopUrl = 'http://127.0.0.1:' + [int]$appState.port + '/local/shutdown'
Invoke-RestMethod -Method Post -Uri $stopUrl -Headers @{ 'X-Local-Key' = $appState.token } -TimeoutSec 10 | Out-Null
Write-Output 'Da yeu cau luu du lieu va tat ung dung.'
