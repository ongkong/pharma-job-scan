# Claude double-check runner (uses tokens, narrow scope). ASCII only: the prompt lives in tools/claude_check_prompt.md (UTF-8).
# Runs only on days of month ending in 2 or 7. Use -Force to run any day. Second run the same day is skipped if the first one succeeded.
param([switch]$Force)

$env:Path = "C:\Program Files\nodejs;C:\Users\PC\AppData\Roaming\npm;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:PYTHONIOENCODING = "utf-8"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$day = (Get-Date).Day
if (-not $Force -and (($day % 10) -ne 2) -and (($day % 10) -ne 7)) { exit 0 }

Set-Location -LiteralPath $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "claude_check_log.txt"
$doneFile = Join-Path $logDir ("claude_check_done_" + (Get-Date -Format "yyyyMMdd") + ".txt")
function Write-Log { param([string]$m) Add-Content -LiteralPath $logFile -Value $m -Encoding UTF8 }

if ((Test-Path -LiteralPath $doneFile) -and -not $Force) { Write-Log "skip: already done today"; exit 0 }

$mutex = [System.Threading.Mutex]::new($false, "Local\PharmaJobScanClaudeCheck")
$hasMutex = $false
try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) { Write-Log "skip: already running"; exit 0 }
    Write-Log "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="

    $sync = & git pull --no-rebase --autostash origin master 2>&1
    Write-Log ($sync | Out-String)
    if ($LASTEXITCODE -ne 0) { Write-Log "abort: git pull failed, nothing changed"; exit 1 }

    $backup = Join-Path $logDir "postings_before_claude_check.json"
    Copy-Item -LiteralPath "data\postings.json" -Destination $backup -Force

    $prompt = Get-Content -LiteralPath "tools\claude_check_prompt.md" -Raw -Encoding UTF8
    $out = $prompt | & claude -p --model sonnet --max-turns 60 --dangerously-skip-permissions 2>&1
    $code = $LASTEXITCODE
    Write-Log ($out | Out-String)
    Write-Log "claude exit code: $code"
    if ($code -ne 0) {
        Copy-Item -LiteralPath $backup -Destination "data\postings.json" -Force
        Write-Log "abort: claude run failed (limit/login?), data restored, will retry on next trigger"
        exit 1
    }

    # Integrity: nothing removed or modified (additive only). Restore on violation.
    $check = "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).postings;const b=JSON.parse(fs.readFileSync('data/postings.json','utf8')).postings;const m=new Map(b.map(p=>[p.id,p]));for(const p of a){const q=m.get(p.id);if(!q)throw new Error('removed '+p.id);if(JSON.stringify(q)!==JSON.stringify(p))throw new Error('modified '+p.id)}console.log('integrity ok, added '+(b.length-a.length))"
    $integ = & node -e $check $backup 2>&1
    Write-Log ($integ | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backup -Destination "data\postings.json" -Force
        Write-Log "abort: integrity check failed, data restored"
        exit 1
    }

    $changed = git status --porcelain -- data/postings.json
    if ($changed) {
        $build = & node report/build/build_dashboard.js 2>&1
        Write-Log ($build | Out-String)
        if ($LASTEXITCODE -ne 0) { Write-Log "abort: dashboard build failed"; exit 1 }
        git add -- data/postings.json report/index.html
        Write-Log (& git commit -m ("Claude double-check " + (Get-Date -Format "yyyy-MM-dd") + " (additive only)") 2>&1 | Out-String)
        Write-Log (& git push origin master 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { Write-Log "push failed, local commit kept"; exit 1 }
    } else { Write-Log "no new postings" }
    Set-Content -LiteralPath $doneFile -Value "done" -Encoding UTF8
    Write-Log "done"
} finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
