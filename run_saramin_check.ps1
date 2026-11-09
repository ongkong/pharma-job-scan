# Saramin cross-check runner (no LLM, zero tokens). ASCII only on purpose: no BOM issues on PowerShell 5.1.
# Runs only on days of month ending in 2 or 7 (ChatGPT/Codex runner covers 0 and 5). Use -Force to run any day.
param([switch]$Force)

$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$day = (Get-Date).Day
if (-not $Force -and (($day % 10) -ne 2) -and (($day % 10) -ne 7)) { exit 0 }

Set-Location -LiteralPath $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "saramin_check_log.txt"
function Write-Log { param([string]$m) Add-Content -LiteralPath $logFile -Value $m -Encoding UTF8 }

$mutex = [System.Threading.Mutex]::new($false, "Local\PharmaJobScanSaramin")
$hasMutex = $false
try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) { Write-Log "skip: already running"; exit 0 }
    Write-Log "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="

    $sync = & git pull --no-rebase --autostash origin master 2>&1
    Write-Log ($sync | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "abort: git pull failed, nothing changed"; exit 1 }

    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules\cheerio"))) {
        Write-Log (& npm install --no-audit --no-fund 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { Write-Log "abort: npm install failed"; exit 1 }
    }

    $self = & node tools/saramin_diff.js --selftest 2>&1
    Write-Log ($self | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "abort: selftest failed (blocked or markup changed), data untouched"; exit 1 }

    $out = & node tools/saramin_diff.js --apply 2>&1
    Write-Log ($out | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "abort: diff failed, data untouched"; exit 1 }

    $changed = git status --porcelain -- data/postings.json
    if (-not $changed) { Write-Log "no new postings, nothing to publish"; exit 0 }

    $build = & node report/build/build_dashboard.js 2>&1
    Write-Log ($build | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "abort: dashboard build failed"; exit 1 }

    git add -- data/postings.json report/index.html
    $msg = "Saramin cross-check $(Get-Date -Format 'yyyy-MM-dd') (additive only)"
    Write-Log (& git commit -m $msg 2>&1 | Out-String)
    Write-Log (& git push origin master 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "push failed, local commit kept"; exit 1 }
    Write-Log "done"
} finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
