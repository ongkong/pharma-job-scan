// Require every original row, including repeated legacy IDs, to survive intact.
const fs = require('node:fs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8')).postings;
const before = read(process.argv[2]);
const after = read(process.argv[3]);
const balance = new Map();
for (const row of after) {
  const key = JSON.stringify(row);
  balance.set(key, (balance.get(key) || 0) + 1);
}
for (const row of before) {
  const key = JSON.stringify(row);
  const available = balance.get(key) || 0;
  if (!available) throw new Error('removed or modified ' + row.id);
  balance.set(key, available - 1);
}
console.log('integrity ok, added ' + (after.length - before.length));
