// 공고 분류 규칙 (2026-11-09 사용자 기준). 대시보드에 인라인되고 Node에서도 테스트 가능.
function classifyPosting(p, info) {
  var title = p.title || "", jf = p.jobFunction || "", et = p.employmentType || "";
  var req = (p.requiredQualifications || ""), desc = p.jobDescription || "";
  var noteTxt = p.addedBy === "claude" ? "" : (p.note || "");
  var job = title + " " + jf;
  var reasons = [];

  var CORE = /배양|정제|\bDS\b|\bDP\b|원액|완제|바이오의약품|생산|공정개발|공정연구|MSAT|기술이전|Tech\s*Transfer|\bQC\b|품질관리|분석|시험법|이화학|미생물|R&D|연구|단백질|항체|세포|발효|비임상|효력/i;
  var NONBIO_EXCL = /영업|마케팅|\bMR\b|MR\)|인허가|\bRA\b|Regulatory|약사|경영지원|총무|인사|구매|\bIR\b|상품기획|소비자상담|준법|정보보호/i;
  var isCore = CORE.test(job);
  var MIXED = /생산|품질|연구|개발|바이오|\bQC\b|\bQA\b/i;

  if (p.excluded) {
    var map = { "non-science": "영업·마케팅·경영지원 등 제외 직무", "small-company": "중소기업", "low-salary": "초봉 4천만원 미만" };
    reasons.push(map[p.excluded] || "제외 표시");
  }
  if (NONBIO_EXCL.test(job) && !isCore && !MIXED.test(job)) reasons.push("영업·마케팅·RA·약사·경영지원 직무");

  if (/파트타임|파트타이머|아르바이트|단순생산|생산보조|보조직|포장지원|이물검사/.test(job + " " + et)) reasons.push("보조직·파트타임");
  var convertible = /전환|채용\s*연계/.test(et + " " + title + " " + desc + " " + noteTxt) && !/전환\s*(불가|없)/.test(et + " " + noteTxt);
  var isIntern = /인턴/.test(et + " " + title);
  var hasRegular = /정규직/.test(et);
  var emp = "regular";
  if (/체험형/.test(et + " " + title)) reasons.push("체험형 인턴(기간제)");
  else if (isIntern && !hasRegular) emp = convertible ? "conv_intern" : "intern_unknown";
  else if (/계약직|기간제/.test(et + " " + title) && !hasRegular && !convertible) reasons.push("기간제·계약직(전환 조건 없음)");
  if (/경력/.test(et) && !/신입|무관/.test(et)) reasons.push("경력직 전용");

  var pool = /상시|인재\s*풀|Talent\s*Pool/i.test(title + " " + jf + " " + et + " " + noteTxt);

  var salaryNum = null;
  var ss = info && info.startingSalary ? String(info.startingSalary) : "";
  var m = ss.match(/([\d,]{4,6})\s*만/);
  if (m) { salaryNum = parseInt(m[1].replace(/,/g, ""), 10); if (isNaN(salaryNum)) salaryNum = null; }
  if (salaryNum !== null && salaryNum < 4000) reasons.push("초봉 4천만원 미만(" + salaryNum + "만원 추정)");

  var track = "adjacent";
  var NONBIO_RND = /화장품|식품|합성|제제|제형|소재|화학/;
  var BIO_KEEP = /발효|바이오|배양|세포|단백|항체|원료\s*분석|정제/;
  if (/연구|R&D|개발/.test(job) && NONBIO_RND.test(job) && !BIO_KEEP.test(job)) track = "lowprio";
  else if (isCore) track = "core";

  var edu = req + " " + title + " " + jf + " " + desc + " " + noteTxt;
  var master = "표기 없음";
  if (/석사\s*(이상|↑|필수)|학력\s*석사/.test(edu) && !/학사\s*이상|대졸\s*이상|학력\s*대졸/.test(edu)) master = "석사 필수";
  else if (/석사.{0,8}우대|우대.{0,25}석사|박사.{0,8}우대/.test(edu)) master = "석사 우대";
  else if (/석사\s*(이상|↑|필수)/.test(edu)) master = "석사 이상 포함(학사 가능 직무 혼재)";

  var newgrad = /신입/.test(et + " " + title) ? "가능" : (/무관/.test(et) ? "가능(경력무관)" : "확인 필요");

  var section = reasons.length ? "excluded" : (track === "lowprio" ? "low" : (pool ? "pool" : "main"));
  var recommend = (section === "main" || section === "pool") && track === "core" && salaryNum !== null && salaryNum >= 4000;
  return { recommend: recommend, section: section, reasons: reasons, track: track, emp: emp, pool: pool, master: master, newgrad: newgrad, salaryNum: salaryNum };
}
if (typeof module !== "undefined") module.exports = { classifyPosting };
