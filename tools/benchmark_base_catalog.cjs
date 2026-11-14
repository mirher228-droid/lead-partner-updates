'use strict';
// Offline request-count/latency fixture: never contacts a CRM or browser profile.
const {performance} = require('node:perf_hooks');
const {create} = require('../extension/leadchat-crm-service.js');

function fixture({delay = 0, workBody, serviceBody, createBody, responseUrl, dependencies = [], partnerOptions, journal} = {}) {
  const calls = [];
  const form = {id:'customerRequestForm', fields:[
    {name:'CustomerRequest[city_id]',tag:'select',options:[{id:'1',text:'Город 1'},{id:'2',text:'Город 2'}]},
    {name:'CustomerRequest[appliance_type_id]',tag:'select',options:[]},
    {name:'CustomerRequest[subappltype_id]',tag:'select',options:[],dependencies},
    {name:'CustomerRequest[partner_id]',tag:'select',options:partnerOptions || [{id:'7',text:'Партнёр 7'}]}
  ],values:{'CustomerRequest[opened_at]':'2026-11-14',cr_opened_at_time:'10:00'}};
  const service = create({
    storage:journal || {get:async()=>{throw Error('A catalogue must not read an operation journal');},set:async()=>{throw Error('A catalogue must not write an operation journal');}},
    request:async input => {
      calls.push({...input});
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      const url = new URL(input.url);
      let text;
      if(url.pathname.endsWith('/city-timetable'))text='notice';
      else if(url.pathname.endsWith('/sub-list'))text=JSON.stringify([{id:'201',text:'Резервная услуга'}]);
      else if(url.searchParams.has('get_subappltypes'))text=serviceBody === undefined
        ? JSON.stringify([{id:'101',text:url.hostname+' / '+url.searchParams.get('city_id')+' / '+url.searchParams.get('appl_id')}])
        : typeof serviceBody==='function' ? serviceBody(url) : serviceBody;
      else if(url.searchParams.has('_get_appltype'))text=workBody === undefined
        ? JSON.stringify([{id:'11',text:'Работа Q'},{id:'12',text:'Работа R'},{id:'13',text:'Недоступная работа',disabled:true}])
        : typeof workBody==='function' ? workBody(url) : workBody;
      else text=createBody === undefined ? 'form' : createBody;
      return {status:text==='http-error'?503:200,url:responseUrl ? responseUrl(url) : input.url,text};
    },
    parseDocument:async text => text==='form'
      ? {forms:[structuredClone(form)],options:[],csrfParam:'_csrf',csrfToken:'offline-token'}
      : text==='notice' ? {forms:[],options:[],cityNotice:'Расписание'}
      : text==='login' ? {forms:[],options:[],login:true}
      : {forms:[],options:[]}
  });
  return {service,calls};
}

async function measure(mode, {delay = 200, bases = ['kp','bt'], works = ['11','12']} = {}) {
  const f = fixture({delay}), started = performance.now();
  const results = await Promise.all(bases.map(async base => {
    const args = {base,cityId:'1',partnerId:''};
    const catalog = mode === 'optimized'
      ? await f.service.readWorkCatalog(args)
      : await f.service.dependencies({...args,applianceTypeId:''});
    if(!catalog.ok)throw Error(catalog.error);
    return Promise.all(works.map(work => mode === 'optimized'
      ? catalog.servicesFor(work)
      : f.service.dependencies({...args,applianceTypeId:work})));
  }));
  if(results.flat().some(result=>!result.ok))throw Error('Synthetic catalogue read failed');
  return {mode,bases:bases.length,works:works.length,requestDelayMs:delay,requests:f.calls.length,
    timetableRequests:f.calls.filter(call=>call.url.includes('/city-timetable?')).length,
    elapsedMs:Number((performance.now()-started).toFixed(1))};
}
module.exports = {fixture,measure};
if(require.main===module) {
  const mode=process.argv[2] || 'optimized';
  measure(mode).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'),error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
