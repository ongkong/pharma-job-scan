#!/usr/bin/env node
/*
 * Saramin per-company cross-check (no LLM, zero tokens).
 * Fetches Saramin search results for each target company, keeps postings open to 신입/경력무관,
 * and ADDS the ones missing from data/postings.json. Existing postings are never deleted or closed.
 *
 *   node tools/saramin_diff.js              dry run (prints what would change)
 *   node tools/saramin_diff.js --apply      write data/postings.json
 *   node tools/saramin_diff.js --selftest   fetch one page and verify the parser still works
 *   --data <path>      postings.json path (default data/postings.json)
 *   --fixture <file>   parse a saved HTML file instead of fetching (testing)
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const APPLY = flag('--apply');
const DATA = opt('--data') || path.join(__dirname, '..', 'data', 'postings.json');
const FIXTURE = opt('--fixture');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Search word -> optional exclude pattern for look-alike company names.
const TARGETS = [
  ['셀트리온'], ['삼성바이오로직스'], ['삼성바이오에피스'], ['SK바이오팜'], ['SK바이오사이언스'],
  ['SK플라즈마'], ['SK케미칼'], ['롯데바이오로직스'], ['GC녹십자'], ['녹십자홀딩스'], ['유한양행'], ['종근당'],
  ['한미약품'], ['대웅제약'], ['대웅바이오'], ['광동제약'], ['휴온스'], ['동아에스티'], ['HK이노엔'], ['보령', /덕산지에스/],
  ['대원제약'], ['일동제약'], ['JW중외제약'], ['동국제약'], ['제일약품'], ['동화약품'], ['삼진제약'], ['안국약품'],
  ['신풍제약'], ['부광약품'], ['코오롱생명과학'], ['휴젤'], ['메디톡스'], ['알테오젠'], ['리가켐바이오'],
  ['에이비엘바이오'], ['에스티팜'], ['이연제약'], ['명인제약'], ['CJ바이오사이언스'], ['한올바이오파마'],
];

const norm = (s) => (s || '').replace(/\(주\)|㈜|\s/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(today);

function parseDeadline(t) {
  t = (t || '').trim();
  if (/오늘마감/.test(t)) return TODAY;
  if (/내일마감/.test(t)) { const d = new Date(today); d.setDate(d.getDate() + 1); return iso(d); }
  const m = t.match(/(\d{2})\/(\d{2})/);
  if (!m) return null; // 채용시 / 상시
  let y = today.getFullYear();
  if (Number(m[1]) < today.getMonth() + 1 - 6) y += 1;
  return `${y}-${m[1]}-${m[2]}`;
}
const dayIso = (s) => { const m = (s || '').match(/등록일\s*(\d{2})\/(\d{2})\/(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}` : null; };

function fn(t) {
  if (/품질보증|QA|Data Integrity|GMP 컴플라이언스/i.test(t)) return '품질보증';
  if (/QC|품질관리|동물시험/.test(t)) return '품질관리';
  if (/공정개발|공정연구/.test(t)) return '공정개발';
  if (/Regulatory|RA\b|허가/.test(t)) return '인허가(RA)';
  if (/제제연구|제품개발|연구소|연구/.test(t)) return '연구개발';
  if (/영업|MR|마케팅|MD|상품기획/.test(t)) return '영업·마케팅';
  if (/IR|총무|인사|경영/.test(t)) return '경영지원';
  if (/SCM/.test(t)) return 'SCM';
  if (/CRS|Medical/.test(t)) return '의학·임상';
  if (/정보보호/.test(t)) return 'IT·정보보호';
  if (/생산|제조|DP|포장|칭량|Utility|유틸리티|설비|배양|정제|원액|완제|분말|고형제/.test(t)) return '생산·공정';
  return '부문별 모집';
}

function parsePage(html, word, exclude) {
  const $ = cheerio.load(html);
  const items = $('.item_recruit');
  const rows = [];
  items.each((_, el) => {
    const e = $(el);
    const a = e.find('.job_tit a').first();
    const href = a.attr('href') || '';
    const rec = (href.match(/rec_idx=(\d+)/) || [])[1];
    const company = norm(e.find('.corp_name a').first().text());
    const cond = e.find('.job_condition span').map((_, s) => $(s).text().trim()).get();
    if (!rec || !company.includes(norm(word))) return;
    if (exclude && exclude.test(company)) return;
    const exp = cond[1] || '';
    if (!/신입|무관/.test(exp)) return;
    rows.push({
      rec, company, title: (a.attr('title') || a.text()).trim(), deadline: parseDeadline(e.find('.job_date .date').first().text()),
      exp, loc: cond[0] || null, edu: cond[2] || '', type: cond[3] || '', day: e.find('.job_day').first().text().trim(),
    });
  });
  return { total: items.length, rows };
}

async function getHtml(word) {
  if (FIXTURE) return fs.readFileSync(FIXTURE, 'utf8');
  const url = `https://www.saramin.co.kr/zf_user/search/recruit?searchType=search&searchword=${encodeURIComponent(word)}&recruitPageCount=40`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

(async () => {
  if (typeof fetch !== 'function' && !FIXTURE) { console.error('Node 18+ required (global fetch).'); process.exit(2); }

  if (flag('--selftest')) {
    const html = await getHtml('종근당');
    const r = parsePage(html, '종근당');
    console.log(`selftest: items=${r.total} matched=${r.rows.length}`);
    process.exit(r.total > 0 ? 0 : 1);
  }

  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const before = JSON.parse(JSON.stringify(data.postings));
  const known = new Map();
  data.postings.forEach((p, i) => {
    const m = (p.url || '').match(/rec_idx=(\d+)/); if (m) known.set(m[1], i);
    const m2 = (p.id || '').match(/(\d{8})$/); if (m2 && !known.has(m2[1])) known.set(m2[1], i);
  });

  const found = new Map(); const failed = [];
  for (const [word, exclude] of FIXTURE ? [['종근당']] : TARGETS) {
    try {
      const { total, rows } = parsePage(await getHtml(word), word, exclude);
      if (total === 0) throw new Error('no result items parsed (blocked or markup changed)');
      rows.forEach((r) => found.set(r.rec, r));
    } catch (err) { failed.push(`${word}: ${err.message}`); }
    if (!FIXTURE) await sleep(1200);
  }
  const attempted = FIXTURE ? 1 : TARGETS.length;
  if (failed.length > attempted * 0.3) {
    console.error(`ABORT: ${failed.length}/${attempted} lookups failed, data left untouched.\n` + failed.join('\n'));
    process.exit(1);
  }

  const added = []; const revived = [];
  for (const r of found.values()) {
    if (known.has(r.rec)) {
      const p = data.postings[known.get(r.rec)];
      if (p.status !== 'confirmed') {
        p.status = 'confirmed'; if (r.deadline) p.deadline = r.deadline; p.isNew = false;
        p.note = `${p.note ? p.note + ' ' : ''}[${TODAY} Claude 교차확인] 사람인 목록에서 진행 중으로 확인되어 재개 처리.`;
        revived.push(`${r.company} ${r.title}`);
      }
      continue;
    }
    if (/경영지원|영업·마케팅/.test(fn(r.title)) || /총무|인사|IR팀|영업직|MR\b|구매|회계|재무|법무/.test(r.title)) continue; // 문과 직무 제외(2026-11-09 사용자 요청)
    added.push({
      id: `saramin-${r.rec}`, company: r.company, title: r.title,
      url: `https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=${r.rec}`, jobFunction: fn(r.title),
      employmentType: `${r.exp} / ${r.type}`, location: r.loc, requiredQualifications: `학력 ${r.edu}`,
      preferredQualifications: null, jobDescription: null, postedDate: dayIso(r.day), deadline: r.deadline,
      processSchedule: null, source: 'secondary', sourceLabel: '사람인(Claude 교차확인)', status: 'confirmed',
      note: `${TODAY} Claude 더블체크로 추가. 사람인 목록 기준(${r.day}).` + (r.deadline ? '' : ' 마감일 미표기(채용시/상시).') + ' 상세 JD·전형일정은 미수집, 지원 전 공고 원문 확인 필요.',
      firstSeen: TODAY, isNew: true, addedBy: 'claude',
    });
  }

  // Integrity: nothing removed, nothing closed, nothing modified except revived records.
  const next = [...data.postings, ...added];
  const byId = new Map(next.map((p) => [p.id, p]));
  for (const b of before) {
    const a = byId.get(b.id);
    if (!a) throw new Error('integrity: removed ' + b.id);
    if (JSON.stringify(a) !== JSON.stringify(b) && !(a.status === 'confirmed' && b.status !== 'confirmed')) throw new Error('integrity: modified ' + b.id);
  }

  console.log(JSON.stringify({ date: TODAY, mode: APPLY ? 'apply' : 'dry-run', lookups: attempted, failed, matched: found.size, added: added.length, revived: revived.length }, null, 1));
  added.forEach((p) => console.log(`+ ${p.company} | ${p.title} | ${p.deadline || '-'} | ${p.url}`));
  revived.forEach((t) => console.log(`~ revived ${t}`));
  if (APPLY && (added.length || revived.length)) {
    data.postings = next; data.lastUpdated = TODAY;
    fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
    JSON.parse(fs.readFileSync(DATA, 'utf8'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
