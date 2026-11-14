const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../extension/leadchat-crm-service.js');

function fixture() {
  const reads = [];
  const form = {id:'customerRequestForm', fields:[
    {name:'CustomerRequest[city_id]', tag:'select', options:[{id:'1',text:'Город'}]},
    {name:'CustomerRequest[appliance_type_id]', tag:'select', options:[]}
  ], values:{'CustomerRequest[opened_at]':'2026-11-13', cr_opened_at_time:'10:00'}};
  const service = create({
    request:async input => {
      assert.equal(input.method, 'GET', 'a timetable lookup must never write to CRM');
      const url = new URL(input.url);
      if (url.pathname.endsWith('/city-timetable')) {
        reads.push(input.url);
        return {status:200, url:input.url, text:'notice:'+url.searchParams.get('on_time')};
      }
      return {status:200, url:input.url, text:url.searchParams.has('_get_appltype') ? '[{"id":"2","text":"Работы"}]' : 'form'};
    },
    parseDocument:async body => body.startsWith('notice:')
      ? {cityNotice:body.slice(7), forms:[]}
      : {forms:[structuredClone(form)]}
  });
  return {service, reads};
}

test('changing appointment time reloads its timetable instead of reusing the previous time', async () => {
  const {service,reads} = fixture();
  const args = {base:'kp',cityId:'1',date:'2026-11-13'};
  const first = await service.dependencies({...args,time:'10:00'});
  const second = await service.dependencies({...args,time:'15:00'});
  assert.equal(first.ok,true);
  assert.equal(first.cityNotice,'10:00');
  assert.equal(second.cityNotice,'15:00');
  assert.equal(reads.length,2);
});

test('concurrent equal timetable lookups share a read; another CRM base does not', async () => {
  const {service,reads} = fixture();
  const args = {base:'kp',cityId:'1',date:'2026-11-13',time:'10:00'};
  const results = await Promise.all([service.dependencies(args),service.dependencies(args)]);
  assert.ok(results.every(result => result.ok && result.cityNotice==='10:00'));
  assert.equal(reads.length,1);
  await service.dependencies({...args,base:'bt'});
  assert.equal(reads.length,2);
});
