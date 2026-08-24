$env:Path = "C:\Program Files\nodejs;C:\Users\PC\AppData\Roaming\npm;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Set-Location "C:\Users\PC\Desktop\01. @@ AI @@\01. 채용"

$logFile = "logs\job_scan_log.txt"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

Add-Content -Path $logFile -Value "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====" -Encoding UTF8

$prompt = "job-scan 스킬을 사용해서 오늘자 제약/바이오 신입 채용공고와 기업정보를 스캔하고 report/index.html 대시보드를 최신화해줘"

try {
    $output = & claude -p $prompt --dangerously-skip-permissions 2>&1
    $output | Out-String | Add-Content -Path $logFile -Encoding UTF8
    Add-Content -Path $logFile -Value "exit code: $LASTEXITCODE" -Encoding UTF8
} catch {
    Add-Content -Path $logFile -Value "PowerShell error: $($_.Exception.Message)" -Encoding UTF8
}

# 대시보드 HTML 강제 재빌드 - claude 세션이 report/index.html 재생성 단계(Phase 3)까지
# 못 갔더라도(중간에 죽었더라도) data/*.json이 바뀌었으면 여기서 무조건 최신 상태로 맞춘다.
# 2026-08-24에 data/postings.json은 갱신됐는데 report/index.html은 며칠째 안 바뀐 채로
# 방치된 사고가 있었음 - 그 재빌드 단계가 AI 세션 내부(Bash 도구 호출)에만 있었기 때문에,
# 세션이 어떤 이유로든 중간에 끝나면 이 단계 자체가 통째로 스킵됐다. 이제는 AI 세션의
# 성공 여부와 무관하게 이 스크립트가 직접, 결정적으로 재빌드를 보장한다.
try {
    $jsonChanged = git status --porcelain -- data/postings.json data/companies.json
    if ($jsonChanged) {
        node report/build/build_dashboard.js 2>&1 | Out-String | Add-Content -Path $logFile -Encoding UTF8
    }
} catch {
    Add-Content -Path $logFile -Value "대시보드 강제 재빌드 오류: $($_.Exception.Message)" -Encoding UTF8
}

# GitHub Pages 대시보드 갱신 - 실제 채용공고 데이터가 바뀐 경우에만 커밋/푸시
# (로그 파일만 바뀐 경우 커밋하지 않음 - 스캔 실패를 성공처럼 보이게 하는 "빈 커밋"을 막기 위함)
try {
    $dataChanged = git status --porcelain -- data/postings.json data/companies.json report/index.html
    if ($dataChanged) {
        git add -A
        git commit -m "자동 스캔 결과 반영 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-String | Add-Content -Path $logFile -Encoding UTF8
        git push origin master 2>&1 | Out-String | Add-Content -Path $logFile -Encoding UTF8
        Add-Content -Path $logFile -Value "git push exit code: $LASTEXITCODE" -Encoding UTF8
    } else {
        Add-Content -Path $logFile -Value "실제 데이터 변경 없음 (스캔 실패했거나 신규 공고 없음) - git commit/push 생략" -Encoding UTF8
    }
} catch {
    Add-Content -Path $logFile -Value "git push 오류: $($_.Exception.Message)" -Encoding UTF8
}

Add-Content -Path $logFile -Value "" -Encoding UTF8