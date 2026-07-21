---
name: job-scan
description: 제약/바이오 기업(셀트리온, 삼성바이오로직스, SK바이오팜 등)의 신입/인턴 채용공고를 공식 채용사이트 및 사람인/잡코리아 등에서 조사해 정리하고, 연봉·초봉·인재상·복지 등 기업정보도 함께 관리하는 스킬. "채용공고 스캔해줘", "채용 정보 업데이트", "새 공고 확인", "채용 스캔 다시 실행", "오늘자 채용공고", "이 회사 연봉/인재상 알려줘", "기업정보 추가해줘" 등 채용정보·기업정보 수집·갱신 요청 시 반드시 사용. 이미 만들어진 report/index.html 대시보드를 다시 만들거나 데이터를 최신화할 때도 이 스킬을 사용한다.
---

# Job Scan — 제약/바이오 신입 채용공고 스캐너

의공학 석사 졸업예정자(2027년 2월 졸업) 대상, 제약/바이오 기업의 신입·인턴 채용공고를 매일 수집해 `report/index.html` 대시보드로 제공하는 오케스트레이터.

**실행 모드:** 서브 에이전트 (팬아웃/팬인). 각 배치는 독립적으로 기업 사이트를 조사하고 결과만 반환하면 되므로 실시간 팀 통신이 불필요하다.

## Phase 0: 컨텍스트 확인

1. `data/postings.json` 존재 여부 확인.
   - 없음 → **초기 실행**. 전체 배치 스캔.
   - 있음 → **후속 실행**. 기존 데이터를 읽어 이번 스캔 결과와 비교해 "신규 공고"를 판별한다.
2. `_workspace/{오늘날짜}/` 폴더가 이미 있고 산출물이 있으면(같은 날 재실행 요청), 사용자가 "다시" 실행을 요청한 경우에만 덮어쓰고, 아니면 기존 결과를 재사용해도 되는지 판단한다.
3. `data/artifact_republish_pending.txt` 존재 여부를 확인한다 — 새벽 무인 실행 세션에 Artifact 도구가 없어서 밀린 웹 재게시가 있다는 표시다. 있으면 (본 스캔 여부와 무관하게) Phase 3c의 안내대로 즉시 재게시하고 마커를 지운다.

## Phase 1: 팬아웃 스캔

`references/companies.md`에 정의된 배치 1~3(대기업/탄탄한 중견기업만 — 중소기업은 대상에서 제외됨)을 각각 별도의 `job-scraper` 에이전트에 배정한다. **model 파라미터는 지정하지 않는다** — `job-scraper` 에이전트 정의(`model: sonnet`)를 그대로 따른다.

**배치는 하나씩 순차로 실행한다 (병렬 금지, `run_in_background` 쓰지 않음).** 예전엔 3개를 동시에(`run_in_background: true`) 병렬 실행했는데, 웹서치/웹페치를 수십 번 반복하는 무거운 배치 3개가 동시에 API를 두들기는 구조라 세션 사용량 한도(rate limit)에 매우 쉽게 걸렸다 — 2026-07-09~2026-07-21 사이 opus/sonnet 모델 여부와 무관하게 반복적으로 새벽 자동 스캔이 시작하자마자 세션 한도 초과로 실패했다(무인 실행 환경은 Pro 플랜 기준으로 보임, 병렬 동시 요청량 자체가 문제였을 가능성이 높음). 배치1 완료 → 배치2 시작 → 배치3 시작 순서로 하나씩 끝난 뒤 다음 배치를 시작해서, 한 번에 API에 걸리는 부하를 줄인다. 시간은 더 걸리지만(병렬 대비 약 3배) 한도 초과 위험이 줄어드는 게 우선이다.

각 Agent 호출 prompt에 반드시 포함할 내용:
- 배정된 배치 번호와 기업/소스 목록 (companies.md에서 해당 배치 섹션 발췌)
- 출력 파일 경로: `_workspace/{오늘날짜}/scraper_batch{N}.json`
- job-scraper.md의 필터 기준 요약 (에이전트 정의에도 있지만 prompt에도 명시해 누락 방지)
- 출처 표기 시 "2차"처럼 뭉뚱그리지 말고 실제 플랫폼명(잡코리아/사람인/캐치/잡다 등) 또는 "공식 홈페이지"를 `sourceLabel`에 남기라고 명시
- 인턴/상시모집 공고는 포함하되 `employmentType`/`note`에 명확히 표기하라고 명시 (정규 채용과 구분해서 대시보드 하단에 표시하기 위함)

각 배치 에이전트가 끝나는 대로(동기 호출이므로 자동으로) 다음 배치로 넘어간다 — 백그라운드 대기/폴링 로직 불필요.

새 기업을 추가할 때는 `references/companies.md`의 "기업 범위" 기준(대기업 계열 또는 코스피 상장 대형 제약사 수준)을 반드시 통과해야 하며, 중소기업은 추가하지 않는다.

## Phase 1b: 기업정보 보강 (연봉·인재상·복지)

채용공고와 달리 기업정보(초봉/평균연봉/인재상/복지/기업문화 평점)는 자주 바뀌지 않으므로 매일 갱신하지 않는다. `data/companies.json`을 확인해 다음 조건에 해당하는 기업만 `company-profiler` 에이전트로 조사한다:
- `data/companies.json`에 아예 없는 기업 (신규 등장 기업 포함)
- `lastUpdated`가 30일 이상 지난 기업

대상 기업이 있으면 `company-profiler` 에이전트에 4~5개씩 묶어 배정하고 **하나씩 순차로 실행한다(병렬 금지, Phase 1과 동일한 이유 — 세션 한도 초과 방지)**. **model 파라미터는 지정하지 않는다** — `company-profiler` 에이전트 정의(`model: sonnet`)를 그대로 따른다. 출력은 `_workspace/{오늘날짜}/profiler_batch{N}.json`. 완료되면 `data/companies.json`에 기업명을 키로 병합 저장한다.

`report/index.html`에는 이 데이터를 `<script>window.__COMPANY_INFO__ = {...};</script>` 블록으로 인라인 주입한다 (채용공고와 동일한 이유 — 로컬 file:// CORS 회피). 기업명을 클릭하면 모달로 표시된다.

## Phase 2: 집계 및 신규 판별

1. `_workspace/{오늘날짜}/scraper_batch*.json` 5개 파일을 모두 읽어 병합한다.
2. `status: "unreachable"` 항목은 별도로 모아 리포트에 "확인 실패 목록"으로 남긴다 (조용히 버리지 않는다).
3. 유효한 공고끼리 `company + title` 기준으로 중복 제거 (같은 공고가 공식 사이트와 잡코리아 양쪽에서 잡히면 `source: "official"` 우선).
4. `data/postings.json`이 있으면 이전 데이터와 비교해 새로 등장한 공고에 `isNew: true`를 표시하고, 이전에 있었지만 이번에 안 잡힌 공고는 `status: "closed_or_missing"`으로 표시(삭제하지 않음 — 마감된 건지 확인 실패인지는 다음 스캔에서 재확인).
5. 결과를 `data/postings.json`에 저장한다. 스키마:
   ```json
   {
     "lastUpdated": "ISO8601",
     "unreachable": [{"company": "...", "note": "..."}],
     "postings": [
       {"id": "company+title 해시 또는 슬러그", "company": "", "title": "", "url": "", "jobFunction": "",
        "employmentType": "", "postedDate": null, "deadline": null, "source": "official|secondary",
        "status": "confirmed|closed_or_missing", "note": "", "firstSeen": "YYYY-MM-DD", "isNew": true}
     ]
   }
   ```

## Phase 3: 대시보드 생성

`report/index.html`은 React(로컬 인라인 번들, CDN 아님)로 만든 단일 HTML 앱이다. `data/postings.json`, `data/companies.json`을 빌드 시점에 인라인으로 삽입해서 렌더링한다 — 로컬 `file://`에서는 `fetch()`가 CORS로 막히는 경우가 많고, Claude Artifact로 게시할 때는 외부 CDN 스크립트 자체가 차단되기 때문에 두 경우 모두 인라인 방식이 필요하다.

**필수 UI 요소:**
- 정렬: 마감임박순(기본, null은 맨 뒤) / 신규순 / 기업명순 / 평균연봉 높은순(회사정보의 `avgSalary` 문자열에서 첫 "OO만원" 숫자를 추출해 비교, 정보 없는 회사는 맨 뒤)
- 신규 공고(`isNew: true`) 강조 표시
- 기업/직무/출처(공식·2차)로 필터링 가능
- 공고는 **기업별 아코디언**으로 그룹화한다. 접힌 상태에서도 그 기업의 공고 개수와 마감일(여러 건이면 여러 개 칩)이 보여야 한다. 기업명 옆에는 `recommendTier` 배지(S/A/B/정보부족)를 표시한다. 기업명 클릭 시 연봉/인재상 모달이 뜬다.
- 아코디언을 펼치면 공고별로 다시 한 번 펼쳐서(중첩 아코디언) 근무지·필수조건·우대사항·직무설명(JD)을 볼 수 있어야 한다 — 사용자가 원문 링크를 따로 열지 않아도 판단할 수 있게 하는 것이 목적. 해당 필드가 없으면 "상세 정보 없음" 정도로만 표시.
- 마감일은 `postedDate`가 있으면 "게시 YYYY-MM-DD ~ 마감 YYYY-MM-DD" 범위로, 없으면 마감일만 표시.
- 인턴/상시모집(`employmentType`/`note`에 "인턴" 또는 "상시" 포함)은 각 기업 아코디언 안에서 하위 섹션으로 분리.
- 마지막 업데이트 날짜는 헤더에서 눈에 잘 띄게 크게 표시한다.
- "확인 실패" 기업 목록을 접을 수 있는 섹션으로 하단에 표시 (숨기지 않되 방해하지 않게)

**갱신 방법 (중요 — 반드시 빌드 스크립트로 재생성한다):**
`report/index.html`을 직접 문자열 치환으로 수정하지 않는다. React/ReactDOM 소스나 JSON 데이터에 `$&`, `$\`` 같은 시퀀스가 우연히 포함되면 JS `String.replace(pattern, stringWithDollar)`가 이를 특수 치환 패턴으로 오인해 파일이 깨진다 (실제로 한 번 발생했던 사고).

대신 `report/build/` 안의 빌드 파이프라인을 사용한다:
- `report/build/dashboard_template.html` — `%%REACT_SRC%%`, `%%REACT_DOM_SRC%%`, `%%JOB_DATA%%`, `%%COMPANY_INFO%%` 플레이스홀더가 있는 템플릿. UI/로직을 바꿀 때는 **이 파일을 수정**한다.
- `report/vendor/react.production.min.js`, `react-dom.production.min.js` — 로컬에 받아둔 React 소스 (CDN 아님, Artifact 게시 시 외부 요청이 없어야 하므로 필요).
- `report/build/build_dashboard.js` — 템플릿 + vendor + `data/*.json`을 안전한 `split('token').join(value)` 방식(치환 패턴 해석 없음)으로 합쳐 `report/index.html`을 재생성한다. 데이터만 바뀐 경우 실행 명령은 `node report/build/build_dashboard.js` (해당 디렉토리에서 실행).

즉 매 스캔 후 순서: `data/postings.json` / `data/companies.json` 갱신 → `node build_dashboard.js` 실행 → `report/index.html`이 최신 상태로 재생성됨.

## Phase 3c: Artifact 재게시

`data/artifact_url.txt`가 있으면 사용자가 이미 Claude Artifact로 대시보드를 게시해둔 것이다. `report/index.html`을 재생성한 뒤, Artifact 도구에 `url` 파라미터로 그 주소를 넘겨 같은 URL에 재게시한다 (파일 경로는 `report/index.html` 그대로, `favicon: "💊"` 유지 — 아이콘을 바꾸면 사용자가 탭을 못 찾는다). `data/artifact_url.txt`가 없으면 이 Phase는 건너뛴다 (사용자가 로컬 파일만 쓰기로 한 것).

`data/artifact_url.txt`가 없는데 사용자가 "웹주소로도 보고싶다"고 새로 요청하면, 먼저 `report/build/build_dashboard.js`로 `report/index.html`이 완전히 인라인(외부 CDN 없음) 상태인지 확인한 뒤 Artifact로 새로 게시하고, 반환된 URL을 `data/artifact_url.txt`에 저장한다.

**중요 — Artifact 도구가 이 세션에 없는 경우 (새벽 무인 실행 등):** 새벽 2시 예약 작업(`claude -p --dangerously-skip-permissions`)으로 돌아가는 세션에는 Artifact 도구 자체가 제공되지 않는다(2026-07-09~07-13에 매일 밤 확인된 사실 — `ToolSearch`로 찾아도 "No matching deferred tools found"). 이 경우 재게시를 조용히 포기하지 말고:
1. `data/artifact_republish_pending.txt`에 현재 시각을 기록한다 (이미 파일이 있으면 내용을 그대로 갱신).
2. 사용자에게 보고할 때 "로컬 파일은 최신화됐지만 이번 세션엔 웹 게시 도구가 없어 웹 링크는 못 갱신했다"고 명확히 알린다.

**Phase 0에서 이 마커 파일을 항상 먼저 확인한다:** `data/artifact_republish_pending.txt`가 존재하고 이번 세션에 Artifact 도구가 있으면(대부분의 대화형 세션), 본 스캔 작업과 무관하게 즉시 현재 `report/index.html`을 `data/artifact_url.txt`의 URL로 재게시하고 마커 파일을 삭제한다 — 무인 실행 밤 동안 밀린 웹 게시를 다음 대화형 세션이 자동으로 따라잡기 위함이다.

## Phase 4: 알림

이번 스캔에서 `isNew: true` 공고가 1건 이상이면, 사용자에게 개수와 대표 기업명을 짧게 알린다 (PushNotification 사용 가능하면 활용). 신규 공고가 없으면 알림을 생략하고 조용히 종료해도 된다 — 매일 "새 공고 없음" 알림으로 피로감을 주지 않는다.

## Phase 5: 스케줄 확인

사용자가 최초 확인(컨펌)을 마친 후에만 수행한다. `CronList`로 이 스킬을 매일 새벽 2시(KST)에 실행하는 크론이 이미 있는지 확인한다. 없으면 `CronCreate`로 등록한다 — 프롬프트는 "job-scan 스킬로 채용공고 스캔 실행"처럼 이 스킬이 확실히 트리거되는 문구로 작성한다.

## 에러 핸들링

- 개별 배치 에이전트 실패(타임아웃, 완전 무응답) 시 1회 재시도. 재실패하면 해당 배치는 `_workspace/{날짜}/scraper_batch{N}_failed.txt`에 사유를 남기고 나머지 배치 결과만으로 진행 — 리포트 상단에 "배치 N 스캔 실패, 일부 기업 정보 누락" 명시.
- `data/postings.json`이 손상되어 읽기 실패하면 덮어쓰지 않고 `data/postings.json.bak`으로 백업 후 사용자에게 보고.

## 테스트 시나리오

- **정상 흐름:** 5개 배치 모두 성공 → 집계 → 신규 3건 발견 → 알림 → 대시보드 갱신
- **에러 흐름:** 배치 3(중견 제약 전반) 접속 실패 → 1회 재시도도 실패 → 나머지 4개 배치로 집계 진행, 리포트에 배치 3 기업 목록은 "확인 실패"로 표시, 사용자에게 부분 실패 보고

## 참고
- 대상 기업 및 소스 상세 목록: `references/companies.md`
- 채용공고 스크래핑 원칙 및 필터 기준: `.claude/agents/job-scraper.md`
- 기업정보(연봉·인재상·복지) 조사 원칙: `.claude/agents/company-profiler.md`
