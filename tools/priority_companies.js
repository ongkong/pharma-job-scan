// Include all large employers and mid-sized employers meeting the salary threshold.
const { startingSalaryAmount } = require('../report/build/classify');
const profiles = require('../data/companies.json');

function priorityCompanies() {
  return Object.keys(profiles).filter(name => {
    const profile = profiles[name];
    return /대기업/.test(profile.companySize) ||
      (/중견/.test(profile.companySize) && startingSalaryAmount(profile) >= 4000);
  });
}

if (require.main === module) console.log(priorityCompanies().join('\n'));
module.exports = { priorityCompanies };
