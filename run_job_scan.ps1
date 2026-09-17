$env:Path = "C:\Program Files\nodejs;C:\Users\PC\AppData\Roaming\npm;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:PYTHONIOENCODING = "utf-8"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$logFile = Join-Path $projectRoot "logs\job_scan_log.txt"
if (-not (Test-Path -LiteralPath (Split-Path -Parent $logFile))) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) | Out-Null
}

function Write-ScanLog {
    param([string]$Message)
    Add-Content -LiteralPath $logFile -Value $Message -Encoding UTF8
}

# 작업 스케줄러가 중복 실행되거나 사용자가 수동 실행한 경우에도 한 프로세스만 동작한다.
$mutex = [System.Threading.Mutex]::new($false, "Local\PharmaJobScanDaily-Codex")
$hasMutex = $false
try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) {
        Write-ScanLog "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="
        Write-ScanLog "이미 실행 중인 채용 스캔이 있어 이번 실행을 건너뜁니다."
        Write-ScanLog ""
        exit 0
    }

    Write-ScanLog "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="
    Write-ScanLog "runner: Codex / model: gpt-5.6-terra / reasoning: low"

    $prompt = @"
job-scan 스킬을 사용해서 오늘자 제약/바이오 신입 채용공고와 기업정보를 스캔하고 report/index.html 대시보드를 최신화해줘.
기존 data/postings.json, data/companies.json, Git 히스토리와 GitHub Pages URL을 유지해라.
.claude 폴더와 Claude/Anthropic CLI 또는 API는 사용하지 마라. 현재 프로젝트의 .agents 스킬과 .codex 에이전트 정의, 로컬 빌드 스크립트만 사용해라.
"@

    $codexExitCode = 1
    try {
        $output = & codex --search -m gpt-5.6-terra -c 'model_reasoning_effort="low"' -a never -s danger-full-access -C $projectRoot exec --ephemeral $prompt 2>&1
        $codexExitCode = $LASTEXITCODE
        Write-ScanLog ($output | Out-String)
        Write-ScanLog "Codex exit code: $codexExitCode"
    } catch {
        Write-ScanLog "Codex 실행 오류: $($_.Exception.Message)"
    }

    # AI 실행이 중간에 끝나도 JSON이 바뀌었다면 로컬 빌더가 HTML을 데이터와 맞춘다.
    $jsonChanged = git status --porcelain -- data/postings.json data/companies.json
    if ($jsonChanged) {
        try {
            $buildOutput = & node report/build/build_dashboard.js 2>&1
            $buildExitCode = $LASTEXITCODE
            Write-ScanLog ($buildOutput | Out-String)
            Write-ScanLog "dashboard build exit code: $buildExitCode"
            if ($buildExitCode -ne 0) {
                throw "대시보드 빌드가 종료 코드 $buildExitCode 로 실패했습니다."
            }
        } catch {
            Write-ScanLog "대시보드 강제 재빌드 오류: $($_.Exception.Message)"
        }
    }

    # 자동화가 소유한 파일만 스테이징한다. 로그·설정·사용자 파일은 자동 커밋하지 않는다.
    $publishChanged = git status --porcelain -- data/postings.json data/companies.json report/index.html
    if ($publishChanged) {
        try {
            git add -- data/postings.json data/companies.json report/index.html
            $commitOutput = & git commit -m "자동 스캔 결과 반영 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1
            $commitExitCode = $LASTEXITCODE
            Write-ScanLog ($commitOutput | Out-String)
            if ($commitExitCode -ne 0) {
                throw "git commit이 종료 코드 $commitExitCode 로 실패했습니다."
            }

            $pushOutput = & git push origin master 2>&1
            $pushExitCode = $LASTEXITCODE
            Write-ScanLog ($pushOutput | Out-String)
            Write-ScanLog "git push exit code: $pushExitCode"
            if ($pushExitCode -ne 0) {
                throw "git push가 종료 코드 $pushExitCode 로 실패했습니다. 로컬 커밋은 보존됩니다."
            }
        } catch {
            Write-ScanLog "GitHub Pages 게시 오류: $($_.Exception.Message)"
        }
    } else {
        Write-ScanLog "실제 데이터 변경 없음 - git commit/push 생략"
    }

    if ($codexExitCode -ne 0) {
        Write-ScanLog "주의: Codex 스캔은 실패했지만 로컬 빌드/게시 안전망 점검은 완료했습니다."
    }
    Write-ScanLog ""
} finally {
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
