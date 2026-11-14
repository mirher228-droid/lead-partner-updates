/* Atomic public data catalogue. Existing request bindings never follow catalogue updates. */
(() => {
  'use strict';
  const seed=globalThis.CRMAvitoOwnerSources,rules=globalThis.LeadPartnerRules;
  if(!seed?.entries?.length||!rules)throw Error('Каталог источников не загрузился.');
  const KEY='leadPartnerSharedCatalogV1',BASES=['kp','mnc','bt'],numeric=value=>typeof value==='string'&&/^\d{1,20}$/u.test(value);
  const latin=code=>code.replace(/[АВСМБ]/g,v=>({А:'A',В:'B',С:'C',М:'M',Б:'B'})[v]);
  const indexes=new WeakMap(),listeners=new Set();let entries,revision='builtin-2',loaded,updates=0;
  const key=rules.sourceKey;
  function list(value){if(value==null)return [];if(!Array.isArray(value)||value.length>200)throw Error('Некорректные данные источника.');return value;}
  function numericBases(entry,id){
    const refs=entry.externalRefs.filter(ref=>ref.id===id),bases=new Set();
    for(const ref of refs.length?refs:[{base:''}])for(const base of ref.base?[ref.base]:entry.sourceBases.length?entry.sourceBases:[''])bases.add(base);
    return bases;
  }
  function validate(input){
    if(!Array.isArray(input)||!input.length||input.length>2500)throw Error('Некорректный общий каталог.');
    const owners=new Map();
    for(const value of input){
      if(value?.manualDeleted||value?.confirmed===false||value?.status&&value.status!=='active')continue;
      const rawCode=String(value?.code||value?.label||'').trim(),special=rules.specialSource(rawCode),code=special?.code||rawCode;let url;
      try{url=new URL(String(value?.url||''));}catch(_){throw Error('Некорректная ссылка источника.');}
      if(!code||code.length>120||/[<>\u0000-\u001f]/u.test(code)||url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>2000)throw Error('Некорректная запись источника.');
      const ids=[...new Set([...(value.externalId==null||value.externalId===''?[]:[value.externalId]),...list(value.externalIds),...(numeric(code)?[code]:[])])];
      if(ids.some(id=>!numeric(id)))throw Error('ID источника должен быть строкой из 1–20 цифр.');
      const sourceBases=[...new Set([...list(value.sourceBases),...(BASES.includes(value.base)?[value.base]:[])])];
      if(sourceBases.some(base=>!BASES.includes(base)))throw Error('Некорректная база источника.');
      const refs=list(value.externalRefs).map(ref=>{
        if(!ref||!numeric(ref.id)||!ids.includes(ref.id)||!['',...BASES].includes(ref.base??''))throw Error('Некорректная связь ID и базы.');
        return {id:ref.id,base:ref.base||''};
      });
      const aliases=[...new Set([code,rawCode,latin(code),...list(value.aliases)])];
      if(aliases.some(alias=>typeof alias!=='string'||alias.length>120||/[<>\u0000-\u001f]/u.test(alias)||numeric(alias)&&alias!=='748'&&!ids.includes(alias)))throw Error('Некорректный псевдоним источника.');
      const partnerId=String(value.partnerId||'');if(partnerId&&!/^\d{1,20}$/u.test(partnerId))throw Error('Некорректный партнёр источника.');
      const previous=owners.get(key(code));
      if(previous){
        if(previous.url!==url.href||previous.partnerId&&partnerId&&previous.partnerId!==partnerId)throw Error('Противоречивые данные одного источника.');
        previous.externalIds.push(...ids);previous.externalRefs.push(...refs);previous.sourceBases.push(...sourceBases);previous.aliases.push(...aliases);if(!previous.partnerId)previous.partnerId=partnerId;
      }else owners.set(key(code),{code,label:code,url:url.href,base:'',externalIds:ids,externalRefs:refs,sourceBases,aliases,partnerId,confirmed:true,status:'active'});
    }
    const out=[...owners.values()].map(value=>{
      value.externalIds=[...new Set(value.externalIds)];value.externalId=value.externalIds[0]||'';
      value.externalRefs=[...new Map(value.externalRefs.map(ref=>[ref.id+'|'+ref.base,ref])).values()];
      value.sourceBases=[...new Set(value.sourceBases)];value.aliases=[...new Set([...value.aliases,...value.externalIds])];
      return value;
    });
    if(!out.length)throw Error('Общий каталог пуст.');
    // Reused numeric IDs are ambiguous lookup keys, not invalid named sources.
    return Object.freeze(out.map(value=>Object.freeze({...value,externalIds:Object.freeze(value.externalIds),externalRefs:Object.freeze(value.externalRefs.map(Object.freeze)),sourceBases:Object.freeze(value.sourceBases),aliases:Object.freeze(value.aliases)})));
  }
  function setEntries(values,nextRevision){const next=validate(values);updates++;revision=String(nextRevision||'local');if(JSON.stringify(next)===JSON.stringify(entries))return false;entries=next;for(const fn of listeners)try{fn(entries)}catch(_){}return true;}
  entries=validate(seed.entries);
  function index(catalog,base){
    if(!indexes.has(catalog))indexes.set(catalog,new Map());const cached=indexes.get(catalog),scope=BASES.includes(base)?base:'';if(cached.has(scope))return cached.get(scope);
    const map=new Map();
    for(const v of catalog)for(const alias of [v.code,v.externalId,...(v.externalIds||[]),...(v.aliases||[])]){
      const k=key(alias);if(!k||k==='748')continue;
      if(numeric(k)&&scope){const bases=numericBases({...v,externalRefs:v.externalRefs||[],sourceBases:v.sourceBases||[]},k);if(!bases.has(scope)&&!bases.has(''))continue;}
      const previous=map.get(k);map.set(k,previous===null||previous&&(previous.code!==v.code||previous.url!==v.url)?null:v);
    }
    cached.set(scope,map);return map;
  }
  function match(catalog,raw,partner,base){
    if(!Array.isArray(catalog))return null;const special=rules.specialSource(raw,partner);
    if(special)return catalog.find(v=>key(v.code)===key(special.code))||null;
    let normalized=key(raw);if(/^(?:парт(?:н[её]р)?\s*)?0*748(?:\s|$)/iu.test(String(partner||''))&&normalized==='АВИТО')normalized=key('748 Авито ДБ');
    if(!normalized)return null;
    const sources=index(catalog,base);
    // An exact identity, including a conflicting alias, always takes priority.
    if(sources.has(normalized))return sources.get(normalized)||null;
    // LeadChat may append the department to a source label. Strip only that
    // complete annotation; never search arbitrary text for a partial code.
    const bare=normalized.replace(/(?:\s+|\s*[-–—/]\s*|\s*(?=\())(?:(?:КП|МНЧ|БТ)(?:\s*[/+]\s*(?:КП|МНЧ|БТ))*|\((?:КП|МНЧ|БТ)(?:\s*[/+]\s*(?:КП|МНЧ|БТ))*\))$/u,'');
    if(bare===normalized||!bare)return null;
    const named=rules.specialSource(bare,partner);
    if(named)return catalog.find(v=>key(v.code)===key(named.code))||null;
    // The remainder must itself be an exact, unambiguous registered alias.
    return sources.get(bare)||null;
  }
  function ready(){if(!loaded)loaded=(async()=>{if(!globalThis.chrome?.storage?.local)return;try{const before=updates,value=(await chrome.storage.local.get(KEY))[KEY];if(before===updates&&value?.entries)setEntries(value.entries,value.revision);}catch(_){}})();return loaded;}
  const api={get entries(){return entries},get revision(){return revision},key,match,validate,setEntries,ready,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}};
  globalThis.LeadPartnerSourceCatalog=Object.freeze(api);
  if(globalThis.chrome?.storage?.onChanged){chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY]?.newValue?.entries)try{setEntries(changes[KEY].newValue.entries,changes[KEY].newValue.revision)}catch(_){}});void ready();}
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
