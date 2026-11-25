오늘자 Claude 더블체크를 수행한다. 저장소 루트의 `SCAN_RULES.md`를 읽고 공식 사이트·사람인 스크립트를 한 번 점검한다. Codex의 배치를 다시 만들 필요는 없다.
공통 기준의 전체 우선 기업과 기존 확인 기업(휴온스, 동국제약, 코오롱생명과학, 휴젤 포함)에 대해 공식·잡코리아·사람인·캐치에서 빠진 신규/변경 후보를 확인하고, 업종 신규 목록도 확인한다. 우선 기업 점검에 실패하면 해당 기업·출처·실패 사유를 남긴다.
[규칙]
- data/postings.json에는 추가만 한다. 기존 공고를 삭제하거나 닫거나 수정하지 마라. 이번에 못 찾았다는 이유로 다른 작성자(ChatGPT/Codex)의 공고를 건드리지 마라.
- 기존 공고 중 자격·마감 변화가 없고 상세가 충분한 경우만 재사용한다. 같은 통합공고의 다른 부문은 구분한다. 변경 후보는 기존 기록을 덮어쓰지 말고 보고한다.
- 새 공고는 기존 스키마(id, company, title, url, jobFunction, employmentType, location, requiredQualifications, preferredQualifications, jobDescription, postedDate, deadline, processSchedule, source, sourceLabel, status, note, firstSeen, isNew)를 따르고 addedBy:"claude", sourceLabel에 출처 사이트명을 쓴다.
- 신입·인턴·경력무관의 대기업·중견을 수집한다. 문과 단독 공고는 신규 등록하지 않는다. 혼합 공고는 부문별로 원문 확인 후 기록한다.
- 한글 JSON은 객체를 직렬화해서 저장하고, 저장 직후 JSON.parse로 검증해라. git 작업(commit/push)과 대시보드 빌드는 하지 마라. 실행 스크립트가 처리한다.
- 마지막에 추가한 공고 수와 확인하지 못한 사이트와 사유를 한 줄씩 출력해라.
