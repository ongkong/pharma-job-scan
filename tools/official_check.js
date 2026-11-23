// Official career-site check (no LLM, 0 tokens). Additive only: never edits or closes existing postings.
// Usage: node tools/official_check.js [--apply]   (needs: npm i playwright-core, and Chrome installed)
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const DATA = path.join(__dirname, '..', 'data', 'postings.json');

// Runs inside the page. Returns [{title, dday, start, end, endTime, rest}]
function extractCelltrion() {
  const t = document.body.innerText.replace(/\s+/g, ' ');
  const out = [];
  const re = /접수중\s+(.+?)\s+D-(\d+)\s+(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})\s+(.+?)(?=\s+\(새 창\))/g;
  let m;
  while ((m = re.exec(t))) {
    out.push({ title: m[1].trim(), start: `${m[3]}-${m[4]}-${m[5]}`, end: `${m[6]}-${m[7]}-${m[8]}`, endTime: m[9], rest: m[10].trim() });
  }
  return { items: out, sawList: /채용공고 목록/.test(t), total: (t.match(/접수중/g) || []).length };
}

// SK Careers lists every SK group company on one page; "더보기" loads 40 more each click.
async function prepareSK(page) {
  for (let i = 0; i < 25; i++) {
    const before = await page.$$eval('a[href*="Recruit/Detail"]', (a) => new Set(a.map((x) => x.href)).size);
    const btn = await page.$('button:has-text("더보기"):visible, a:has-text("더보기"):visible');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(1500);
    const after = await page.$$eval('a[href*="Recruit/Detail"]', (a) => new Set(a.map((x) => x.href)).size);
    if (after === before) break;
  }
}
function extractSK() {
  const seen = new Set();
  const items = [];
  document.querySelectorAll('a[href*="Recruit/Detail"]').forEach((a) => {
    if (seen.has(a.href)) return;
    seen.add(a.href);
    const li = a.closest('li') || a.parentElement;
    const t = li.innerText.replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.+?)\s+(\d{4})년 (\d{2})월 (\d{2})일\([^)]\) ~ (\d{4})년 (\d{2})월 (\d{2})일\([^)]\)\s+(D-\d+|D-DAY|상시|채용시)?\s*(.+)$/);
    if (m) items.push({ title: m[1], start: `${m[2]}-${m[3]}-${m[4]}`, end: `${m[5]}-${m[6]}-${m[7]}`, rest: m[9].replace(/공유하기.*$/, '').trim(), url: a.href });
  });
  const mt = document.body.innerText.match(/현재 총 (\d+)건/);
  return { items, sawList: items.length > 0, total: mt ? parseInt(mt[1], 10) : seen.size, seen: seen.size };
}

// Common page-side extraction for official lists. Each link is reduced to its
// nearest card so the checker can compare parsed cards with the visible total.
function extractCards(config) {
  const { selector, titleSelector, totalPattern, listPattern } = config;
  const body = document.body.innerText.replace(/\s+/g, ' ');
  const seen = new Set();
  const items = [];
  document.querySelectorAll(selector).forEach((a, index) => {
    const href = a.href || a.querySelector('a[href]')?.href || `${location.href}#row-${index}`;
    if (seen.has(href)) return;
    let card = a.closest('li, article, [class*="posting"], [class*="Posting"], [class*="recruit"], [class*="Recruit"], [class*="item"], [class*="Item"]');
    if (!card || card.innerText.trim().length < 15 || card.innerText.trim().length > 1800) {
      card = a.parentElement;
      for (let i = 0; i < 4 && card?.parentElement && card.innerText.trim().length < 30; i++) card = card.parentElement;
    }
    if (!card) return;
    const text = card.innerText.replace(/\s+/g, ' ').trim();
    if (text.length < 15 || text.length > 1800) return;
    seen.add(href);
    const titleEl = titleSelector ? card.querySelector(titleSelector) : null;
    const title = (titleEl?.innerText || a.innerText || text).replace(/\s+/g, ' ').trim();
    const dates = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s*(?:~|–|-|∼)\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
    items.push({ title, start: dates ? `${dates[1]}-${dates[2].padStart(2,'0')}-${dates[3].padStart(2,'0')}` : '', end: dates ? `${dates[4]}-${dates[5].padStart(2,'0')}-${dates[6].padStart(2,'0')}` : '', rest: text, url: href });
  });
  const tm = totalPattern ? body.match(new RegExp(totalPattern)) : null;
  const total = tm ? parseInt(tm[1], 10) : items.length;
  return { items, sawList: items.length > 0 || (listPattern ? new RegExp(listPattern).test(body) : false), total, openCount: items.filter((x) => !/(접수마감|채용마감|마감\s*$|마감되었습니다)/.test(x.rest)).length };
}

function extractSamsung() {
  const body = document.body.innerText.replace(/\s+/g, ' ');
  const items = [];
  document.querySelectorAll('a[href="/#none"]').forEach((a) => {
    const card = a.closest('li');
    if (!card) return;
    const text = card.innerText.replace(/\s+/g, ' ').trim();
    const href = a.href;
    if (!text || text.length > 2000) return;
    const title = text.match(/(?:신입|경력|인턴|무관)\s+(.+?)\s+20\d{2}\.\d{2}\.\d{2}/)?.[1] || a.innerText.trim();
    const dates = text.match(/(20\d{2})\.(\d{2})\.(\d{2})\s*~\s*(20\d{2})\.(\d{2})\.(\d{2})/);
    items.push({ title: title || text.slice(0, 160), start: dates ? `${dates[1]}-${dates[2]}-${dates[3]}` : '', end: dates ? `${dates[4]}-${dates[5]}-${dates[6]}` : '', rest: text, url: href });
  });
  const total = document.querySelectorAll('ul.col3List.job > li').length;
  return { items, sawList: /채용공고/.test(body), total, openCount: items.length };
}

async function prepareLG(page) {
  await page.locator('button').filter({ hasText: /^회사별$/ }).click({ force: true });
  await page.locator('button').filter({ hasText: /^LG화학$/ }).click({ force: true });
  await page.locator('button').filter({ hasText: /^검색$/ }).click({ force: true });
  await page.waitForTimeout(1200);
}
async function prepareGC(page) {
  await page.locator('select').first().selectOption('1100');
  await page.getByText('검색', { exact: true }).last().click();
  await page.waitForTimeout(1000);
}
function keepEntryLevel(it) {
  if (/(신입|인턴|무관)/.test(it.rest)) return true;
  if (/(경력|경력직|경력사원)/.test(it.rest)) return false;
  return true;
}
async function readCards(page, config) {
  let items = [], total = null, sawList = false, openCount = 0;
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const r = await page.evaluate(extractCards, config);
    total = r.total;
    sawList = sawList || r.sawList;
    openCount += r.openCount;
    for (const it of r.items) if (!seen.has(it.url)) { seen.add(it.url); items.push(it); }
    const next = page.locator('button[aria-label="다음 페이지"]').first();
    if (!(await next.count())) break;
    const state = await next.evaluate((b) => ({ disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', cls: b.className }));
    if (state.disabled || /impossible|disabled/i.test(state.cls)) break;
    const before = await page.locator(config.selector).first().innerText().catch(() => '');
    await next.click();
    await page.waitForFunction(({ sel, old }) => {
      const el = document.querySelector(sel);
      return el && el.innerText !== old;
    }, { sel: config.selector, old: before }, { timeout: 10000 }).catch(() => {});
  }
  return { items, total: total ?? items.length, sawList, openCount };
}
async function collectDaewoong(page) {
  const config = { selector: 'a.apply-item[href*="/job-posting/"]', titleSelector: '.apply-list-heading', listPattern: '채용유형' };
  let items = [], sawList = false;
  const seen = new Set();
  for (let n = 1; n <= 5; n++) {
    if (n > 1) {
      await page.goto(`https://career.daewoong.co.kr/apply/posting?daae99d2_page=${n}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(500);
    }
    const r = await page.evaluate(extractCards, config);
    sawList = sawList || r.sawList;
    for (const it of r.items) if (!seen.has(it.url)) { seen.add(it.url); items.push(it); }
  }
  return { items, total: items.length, sawList, openCount: items.filter((it) => !/(접수마감|마감\s*$|마감되었습니다)/.test(it.rest)).length };
}
const SK_BIO = /(SK바이오팜|SK바이오사이언스|SK바이오텍|SK케미칼|SK플라즈마|SK디스커버리)/;

const SITES = [
  { company: '셀트리온', url: 'https://celltrion.recruiter.co.kr/career/jobs', wait: '채용공고 목록', extract: extractCelltrion, label: '셀트리온 공식 채용사이트' },
  { company: null, url: 'https://www.skcareers.com/Recruit', wait: '현재 총', prepare: prepareSK, extract: extractSK, label: 'SK Careers 공식 채용사이트', keep: (it) => /(신입|인턴|무관)/.test(it.rest), companyOf: (it) => { const m = (it.title + ' ' + it.rest).match(SK_BIO); return m ? m[1] : null; } },
  { company: null, url: 'https://www.samsungcareers.com/hr/', wait: '채용공고', extract: extractSamsung, label: '삼성 커리어스 공식 채용사이트', keep: (it) => /(신입|인턴|무관)/.test(it.rest), companyOf: (it) => /삼성바이오로직스/.test(it.rest) ? '삼성바이오로직스' : /삼성바이오에피스/.test(it.rest) ? '삼성바이오에피스' : null },
  { company: null, url: 'https://recruit.lotte.co.kr/apply/announcement', wait: '채용공고', selector: 'a[href*="/apply/announcement/detail/"]', titleSelector: '[class*="title"], h3, strong', totalPattern: '전체\\((\\d+)\\)', label: '롯데그룹 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$)/.test(it.rest) && keepEntryLevel(it), companyOf: (it) => /롯데바이오로직스/.test(it.rest) ? '롯데바이오로직스' : null },
  { company: '유한양행', url: 'https://yuhan.recruiter.co.kr/career/apply', wait: '채용', selector: 'a[href*="/career/jobs/"]', titleSelector: 'h2, h3, strong, [class*="title"]', label: '유한양행 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$)/.test(it.rest) },
  { company: null, url: 'https://recruit.gccorp.com/kor/recruit/list', wait: '진행공고', prepare: prepareGC, selector: '.list-item.recruit', titleSelector: '.job-title', label: 'GC그룹 공식 채용사이트', keep: (it) => !/(마감|종료)/.test(it.rest) && keepEntryLevel(it), companyOf: (it) => /\[GC녹십자\]/.test(it.rest) ? 'GC녹십자' : null },
  { company: null, url: 'https://hanmi.recruiter.co.kr/career/home', wait: '채용공고 목록', selector: 'a[href*="/career/jobs/"]', titleSelector: '[class*="title"]', label: '한미그룹 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$)/.test(it.rest) && keepEntryLevel(it), companyOf: () => '한미약품' },
  { company: null, url: 'https://career.daewoong.co.kr/apply/posting', wait: '채용유형', collect: collectDaewoong, label: '대웅그룹 공식 채용사이트', keep: keepEntryLevel, companyOf: (it) => /대웅제약/.test(it.rest) ? '대웅제약' : null },
  { company: '종근당', url: 'https://ckd.recruiter.co.kr/career/Posting', wait: '채용공고', selector: 'a[href*="/career/jobs/"]', titleSelector: 'h2, h3, strong, [class*="title"]', totalPattern: '총\\s*(\\d+)\\s*건', label: '종근당 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$|경력사원|경력직|경력 채용)/.test(it.rest) },
  { company: 'LG화학', url: 'https://careers.lg.com/apply', wait: '공고', prepare: prepareLG, selector: '.job-card-title', titleSelector: '.job-card-title', totalPattern: '전체\\s*(\\d+)\\s*건', label: 'LG Careers 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$)/.test(it.rest) && (/생명과학|바이오|의약|상시 인재등록/.test(it.rest)) },
  { company: null, url: 'https://kolmar.recruiter.co.kr/career/joblist', wait: '채용공고 목록', collect: (page) => readCards(page, { selector: 'a[href*="/career/jobs/"]', titleSelector: '[class*="title"]', totalPattern: '총\\s*(\\d+)\\s*건', listPattern: '채용공고 목록' }), label: 'HK이노엔 공식 채용사이트', keep: (it) => /HK이노엔/.test(it.rest) && !/(접수마감|마감\s|마감$)/.test(it.rest) && keepEntryLevel(it), companyOf: (it) => /HK이노엔/.test(it.rest) ? 'HK이노엔' : null },
  { company: '동아에스티', url: 'https://talent.dongasocio.com/kr/page/jobs/jobList', wait: '채용 공고', selector: 'a[href*="jobDetail"], a[href*="jobView"]', titleSelector: 'h2, h3, strong, [class*="title"]', totalPattern: '(\\d+)\\s*개의 채용 공고', label: '동아쏘시오그룹 공식 채용사이트', keep: keepEntryLevel },
  { company: '보령', url: 'https://recruit.boryung.co.kr/recruit', wait: '진행 중인 채용 공고', selector: 'a[href*="/job_posting/"]', titleSelector: 'h3, h2, [class*="Title"]', label: '보령 공식 채용사이트', keep: (it) => !/(접수마감|마감\s|마감$)/.test(it.rest) && keepEntryLevel(it) },
];

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  let added = 0, alerts = 0;
  for (const s of SITES) {
    const page = await browser.newPage();
    try {
      await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction((w) => document.body.innerText.includes(w), s.wait, { timeout: 30000 });
      await page.waitForTimeout(2000);
      if (s.prepare) await s.prepare(page);
      const r = s.collect ? await s.collect(page) : s.extract ? await page.evaluate(s.extract) : await page.evaluate(extractCards, { selector: s.selector, titleSelector: s.titleSelector, totalPattern: s.totalPattern, listPattern: s.wait });
      // Structure-change guard: "접수중" appears more often than parsed rows => parser is stale.
      if (!r.sawList || r.items.length !== r.total) {
        alerts++;
        console.log(`ALERT ${s.company || s.label}: parsed ${r.items.length} of ${r.total} rows (sawList=${r.sawList}) - site layout may have changed, check manually`);
      }
      console.log(`${s.company || s.label}: ${r.openCount ?? r.items.length} open postings`);
      const norm = (x) => String(x || '').replace(/[\s\[\]()]/g, '');
      const bigrams = (x) => { const g = new Set(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
      const similar = (a, b) => { if (a === b || a.includes(b) || b.includes(a)) return true; const A = bigrams(a), B = bigrams(b); let n = 0; A.forEach((x) => B.has(x) && n++); return n / (A.size + B.size - n) >= 0.75; };
      for (const it of r.items) {
        const company = s.company || (s.companyOf && s.companyOf(it));
        if (!company) continue; // not a target company
        if (s.keep && !s.keep(it)) continue; // experienced-only rows are excluded by the user's own rule
        const exists = db.postings.some((p) => {
          if (p.company !== company) return false;
          if (it.url && p.url && p.url.includes(it.url.split('/').pop())) return true;
          return similar(norm(p.title), norm(it.title)) && (p.deadline || '') === it.end;
        });
        if (exists) continue;
        console.log(`NEW ${company} | ${it.title} | ${it.start}~${it.end} | ${it.rest}`);
        if (APPLY) {
          db.postings.push({
            id: `official-${company}-${it.end.replace(/-/g, '')}-${Buffer.from(it.title).toString('hex').slice(0, 12)}`,
            company, title: it.title, url: it.url || s.url, jobFunction: '분야별 상이(공고 확인 필요)',
            employmentType: it.rest, location: null, requiredQualifications: null, preferredQualifications: null,
            jobDescription: null, postedDate: it.start, deadline: it.end, processSchedule: null,
            source: 'official', sourceLabel: s.label, status: 'confirmed',
            note: `${today} official_check.js가 공식 채용사이트 목록에서 자동 추가. 상세 직무·자격 미수집, 원문 확인 필요.`,
            firstSeen: today, isNew: true, addedBy: 'official_check',
          });
          added++;
        }
      }
    } catch (e) {
      alerts++;
      console.log(`ALERT ${s.company || s.label}: ${e.message.split('\n')[0]}`);
    } finally { await page.close(); }
  }
  await browser.close();
  if (APPLY && added) {
    db.lastUpdated = today;
    fs.writeFileSync(DATA, JSON.stringify(db, null, 2) + '\n');
  }
  console.log(`done: added=${added} alerts=${alerts}`);
  process.exit(alerts ? 2 : 0);
}
if (require.main === module) main();
module.exports = { extractCelltrion, extractSK };
