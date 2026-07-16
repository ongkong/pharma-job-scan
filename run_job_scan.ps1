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

# GitHub Pages 대시보드 갱신 - 스캔 결과를 저장소에 커밋/푸시
try {
    git add -A
    $changes = git status --porcelain
    if ($changes) {
        git commit -m "자동 스캔 결과 반영 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-String | Add-Content -Path $logFile -Encoding UTF8
        git push origin master 2>&1 | Out-String | Add-Content -Path $logFile -Encoding UTF8
        Add-Content -Path $logFile -Value "git push exit code: $LASTEXITCODE" -Encoding UTF8
    } else {
        Add-Content -Path $logFile -Value "변경사항 없음, git push 생략" -Encoding UTF8
    }
} catch {
    Add-Content -Path $logFile -Value "git push 오류: $($_.Exception.Message)" -Encoding UTF8
}

Add-Content -Path $logFile -Value "" -Encoding UTF8