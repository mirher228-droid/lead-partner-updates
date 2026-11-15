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

const links624={
  'К1':'https://www.avito.ru/brands/1fcce90ff0e4a6db02ba74c9bd908fe7',
  'К2':'https://www.avito.ru/brands/5104951ac495be62f1b54d1a141616d7'
};

test('624 sources resolve with either alphabet and a complete department suffix', async () => {
  const f=fixture();
  const verify=()=>{
    for(const [code,url] of Object.entries(links624)){
      for(const alias of [code,'K'+code.slice(1),code+' МНЧ','K'+code.slice(1)+' (МНЧ/БТ)']){
        const source=f.api.match(f.api.entries,alias,'624','mnc');
        assert.equal(source?.code,code);
        assert.equal(source?.partnerId,'624');
        assert.equal(source?.url,url);
        assert.equal(source?.externalIds.length,0);
        assert.equal(source?.sourceBases.length,0);
      }
    }
    for(const code of ['K11','К21','Новый К1','K2 другое']){
      assert.equal(f.api.match(f.api.entries,code,'624','mnc'),null);
    }
    assert.equal(f.api.match(f.api.entries,'К1','7','mnc'),null);
  };
  verify();
  f.finish({revision:764,entries:[entry('С77')]});
  await f.api.ready();
  verify();
  assert.equal(f.api.entries[0].code,'С77');
  assert.equal(f.api.entries.length,3);
});

test('confirmed shared mappings in either alphabet take priority for 624', async () => {
  const f=fixture();
  f.finish({revision:765,entries:[{...entry('K1'),partnerId:'624'},entry('С77')]});
  await f.api.ready();
  assert.equal(f.api.match(f.api.entries,'К1 МНЧ','624','mnc')?.url,entry('K1').url);
  assert.equal(f.api.match(f.api.entries,'К2','624','mnc')?.url,links624['К2']);
  assert.equal(f.api.entries.filter(value=>value.code==='K1' || value.code==='К1').length,1);
  f.notify({revision:766,entries:[{...entry('К1'),partnerId:'7'},entry('С77')]});
  assert.equal(f.api.match(f.api.entries,'К1','624','mnc'),null);
  assert.equal(f.api.match(f.api.entries,'K1','7','mnc')?.url,new URL(entry('К1').url).href);
});
