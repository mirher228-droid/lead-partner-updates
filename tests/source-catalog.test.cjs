const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const key = 'leadPartnerSharedCatalogV1';

function fixture() {
  let resolveRead, change;
  const context = vm.createContext({URL, console, chrome:{storage:{
    local:{get:() => new Promise(resolve => {resolveRead=resolve;})},
    onChanged:{addListener:listener => {change=listener;}}
  }}});
  for (const name of ['leadpartner-rules.js','crm-avito-owner-sources.js','avito-source-catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),context,{filename:name});
  }
  return {api:context.LeadPartnerSourceCatalog,
    finish:value => resolveRead({[key]:value}),
    notify:value => change({[key]:{newValue:value}},'local')};
}
const entry = code => ({code,url:'https://example.test/'+code});

test('late initial storage read cannot replace a newer catalogue notification', async () => {
  const f = fixture();
  f.notify({revision:12,entries:[entry('new')]});
  f.finish({revision:11,entries:[entry('old')]});
  await f.api.ready();
  assert.equal(f.api.revision,'12');
  assert.equal(f.api.entries[0].code,'new');
});

test('same entries with newer revision still protect against an old initial read', async () => {
  const f = fixture();
  f.notify({revision:12,entries:[entry('same')]});
  f.notify({revision:13,entries:[entry('same')]});
  f.finish({revision:11,entries:[entry('old')]});
  await f.api.ready();
  assert.equal(f.api.revision,'13');
  assert.equal(f.api.entries[0].code,'same');
});

test('initial catalogue is restored without a competing notification; invalid updates are ignored', async () => {
  const f = fixture();
  f.notify({revision:99,entries:[{code:'bad',url:'javascript:alert(1)'}]});
  f.finish({revision:11,entries:[entry('stored')]});
  await f.api.ready();
  assert.equal(f.api.revision,'11');
  assert.equal(f.api.entries[0].code,'stored');
});
