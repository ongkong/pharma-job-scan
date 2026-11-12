오늘자 더블체크를 수행해라. 범위는 아래로 한정한다. 전체 스캔(job-scan 스킬의 배치 1~3)은 하지 마라. 토큰을 아끼기 위해 필요한 만큼만 도구를 호출해라.

[확인 대상]
1. 잡코리아에서 대상 기업(셀트리온, 삼성바이오로직스, 삼성바이오에피스, SK바이오팜, SK바이오사이언스, 롯데바이오로직스, 유한양행, GC녹십자, 종근당, 한미약품, 대웅제약, 보령, 휴온스, 동국제약, 코오롱생명과학, 휴젤)의 신입 공고를 확인한다.
2. 공식 채용사이트: 셀트리온, 삼성커리어스(삼성바이오로직스/에피스), SK(바이오팜/바이오사이언스), 롯데바이오로직스, 유한양행. 접속이 되는 것만 확인하고, 안 열리면 사유를 로그에 남기고 넘어가라.

[규칙]
- data/postings.json에는 추가만 한다. 기존 공고를 삭제하거나 닫거나 수정하지 마라. 이번에 못 찾았다는 이유로 다른 작성자(ChatGPT/Codex)의 공고를 건드리지 마라. 공식 페이지에서 마감이 직접 확인된 경우에만 status를 바꿀 수 있다.
- 이미 data/postings.json에 있는 공고(URL의 공고 번호 또는 같은 회사·제목)는 상세 페이지를 다시 열지 마라.
- 새 공고는 기존 스키마(id, company, title, url, jobFunction, employmentType, location, requiredQualifications, preferredQualifications, jobDescription, postedDate, deadline, processSchedule, source, sourceLabel, status, note, firstSeen, isNew)를 따르고 addedBy:"claude", sourceLabel에 출처 사이트명을 쓴다.
- 영업·마케팅·경영지원·계약직·중소기업 공고도 걸러내지 말고 수집해라. 숨김 처리는 report/build/classify.js가 대시보드에서 한다.
- 한글 JSON은 객체를 직렬화해서 저장하고, 저장 직후 JSON.parse로 검증해라. git 작업(commit/push)과 대시보드 빌드는 하지 마라. 실행 스크립트가 처리한다.
- 마지막에 추가한 공고 수와 확인하지 못한 사이트와 사유를 한 줄씩 출력해라.
