$env:Path = "C:\Program Files\nodejs;C:\Users\PC\AppData\Roaming\npm;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:PYTHONIOENCODING = "utf-8"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = $PSScriptRoot
$codexExe = (Get-Command codex -ErrorAction SilentlyContinue).Source
if (-not $codexExe -or -not (Test-Path -LiteralPath $codexExe)) {
    $codexBinRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
    $codexExe = Get-ChildItem -LiteralPath $codexBinRoot -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $codexExe) { throw "Codex executable was not found." }
$codexDirectory = Split-Path -Parent $codexExe
if (($env:Path -split ';') -notcontains $codexDirectory) {
    $env:Path = "$codexDirectory;$env:Path"
}
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
    $syncOutput = & git pull --no-rebase --autostash origin master 2>&1
    $syncExitCode = $LASTEXITCODE
    Write-ScanLog ($syncOutput | Out-String)
    Write-ScanLog "upstream sync exit code: $syncExitCode"
    if ($syncExitCode -ne 0) {
        Write-ScanLog "원격 최신 변경을 안전하게 병합하지 못해 스캔을 시작하지 않습니다. 로컬/원격 자료는 그대로 보존합니다."
        exit 1
    }
    Write-ScanLog "runner: Codex / model: gpt-5.6-luna / reasoning: low"

    $prompt = @"
job-scan 스킬을 사용해서 오늘자 제약/바이오 대기업·중견기업의 신입/인턴 채용공고를 직무 제한 없이 스캔하고 report/index.html 대시보드를 최신화해줘.
기존 data/postings.json, data/companies.json, Git 히스토리와 GitHub Pages URL을 유지해라. Claude나 다른 작성자가 원격 저장소에 추가한 공고를 포함해 기존 공고를 모두 보존하고 이번 검색 결과만으로 전체 목록을 덮어쓰지 마라. 기존 공고는 동일 URL/제목으로 병합하고, 공식 페이지에서 종료나 마감이 확인된 경우에만 닫아라. git reset --hard, git clean, force push는 사용하지 마라.
.claude 폴더와 Claude/Anthropic CLI 또는 API는 사용하지 마라. 현재 프로젝트의 .agents 스킬과 .codex 에이전트 정의, 로컬 빌드 스크립트만 사용해라.
한글 JSON을 직접 수동 이스케이프하거나 JSON.parse('"'+문자열+'"')로 만들지 마라. 객체를 UTF-8 JSON으로 직렬화하고, 저장 직후 JSON 파싱을 검증해라.
이 자동 실행을 지금부터 직접 수행해라. 현재 Codex/PowerShell 프로세스나 작업 스케줄러를 조회해 자기 자신이 이미 실행 중이라고 판단하거나, 이를 기다리며 Start-Sleep/폴링하지 마라. 배치 1~3을 순서대로 실제 조사하고, 각 결과를 _workspace/{오늘날짜}/scraper_batch{N}.json에 저장해라. 사이트 접속 실패는 실제 접근 차단이 확인된 경우에만 unreachable로 기록하고, 검색 가능한 사이트를 확인했으나 신입/인턴 공고를 못 찾은 경우는 실패 목록에 넣지 마라. 세 배치 결과를 병합하고 대시보드까지 완료한 뒤 종료해라. 완료하지 못한 배치가 있으면 성공으로 끝내지 말고 구체적인 실패 사유를 남겨라.
"@

    $codexExitCode = 1
    try {
        $output = & $codexExe --search -m gpt-5.6-luna -c 'model_reasoning_effort="low"' -a never -s danger-full-access -C $projectRoot exec --ephemeral $prompt 2>&1
        $codexExitCode = $LASTEXITCODE
        Write-ScanLog ($output | Out-String)
        Write-ScanLog "Codex exit code: $codexExitCode"
    } catch {
        Write-ScanLog "Codex 실행 오류: $($_.Exception.Message)"
    }

    # 성공 종료 코드만으로는 스캔 완료를 보장하지 않는다. 오늘의 배치 산출물이 모두 있어야 완료로 인정한다.
    if ($codexExitCode -ne 0) {
        Write-ScanLog "스캔 미완료 - Codex exit code: $codexExitCode. 게시를 건너뜁니다."
        exit 1
    }
    $scanDate = Get-Date -Format 'yyyy-MM-dd'
    $completionScript = "const fs=require('fs'),path=require('path');const today=process.argv[1],dir=path.join('_workspace',today);for(const n of [1,2,3]){const f=path.join(dir,'scraper_batch'+n+'.json');if(!fs.existsSync(f))throw new Error('missing batch output: '+f);if(!Array.isArray(JSON.parse(fs.readFileSync(f,'utf8'))))throw new Error('invalid batch output: '+f)}const postingsPath=path.join('data','postings.json'),postings=JSON.parse(fs.readFileSync(postingsPath,'utf8'));JSON.parse(fs.readFileSync(path.join('data','companies.json'),'utf8'));if(!Array.isArray(postings.postings))throw new Error('invalid postings schema');postings.lastUpdated=today;fs.writeFileSync(postingsPath,JSON.stringify(postings,null,2)+'\n','utf8');console.log('all 3 batch outputs valid; lastUpdated='+today);"
    $completionOutput = & node -e $completionScript $scanDate 2>&1
    $completionExitCode = $LASTEXITCODE
    Write-ScanLog ($completionOutput | Out-String)
    Write-ScanLog "scan completion validation exit code: $completionExitCode"
    if ($completionExitCode -ne 0) {
        Write-ScanLog "스캔 미완료 또는 배치 결과 누락 - 게시를 건너뜁니다."
        exit 1
    }

    # 손상된 JSON을 HTML로 빌드하거나 GitHub Pages에 게시하지 않는다.
    $validationOutput = & node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('data/postings.json','utf8'));JSON.parse(fs.readFileSync('data/companies.json','utf8'));if(!Array.isArray(p.postings)||!/^\d{4}-\d{2}-\d{2}$/.test(p.lastUpdated))throw new Error('postings.json schema/date validation failed');" 2>&1
    $validationExitCode = $LASTEXITCODE
    Write-ScanLog ($validationOutput | Out-String)
    Write-ScanLog "JSON validation exit code: $validationExitCode"
    if ($validationExitCode -ne 0) {
        Write-ScanLog "JSON 검증 실패 - 대시보드 빌드와 게시를 건너뜁니다. 기존 공개 페이지를 유지합니다."
        Write-ScanLog ""
        exit 1
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
            exit 1
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
            exit 1
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
