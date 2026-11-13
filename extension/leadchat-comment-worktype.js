/* Local work/service vocabulary, adapted from https://github.com/Razetka228/crm-updates at 0b9f08e9348d00f82f64a9552f12a03056d6f911.
   Only enabled entries from the current CRM catalogue may be selected. */
(function(root,factory){
  'use strict';
  const data=typeof module==='object'&&module.exports?require('./leadchat-worktype-data.js'):root.LeadChatWorktypeData;
  const api=factory(data);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LeadChatCommentWorktype=api;
})(typeof globalThis==='object'?globalThis:this,function(data){
  'use strict';
  const text=value=>String(value??'');
  const normalize=value=>text(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
  const rule = (keys, workId, serviceId, labels) => ({keys, workId:text(workId), serviceId:text(serviceId || ''), labels:Array.isArray(labels) ? labels : String(labels || '').split('|').filter(Boolean)});
  const KP = [
    rule(['пк','компьютер','комп','ноутбук','ноут','моноблок','виндовс','windows','макбук','macbook','аймак','imac'],'257','','компьютер|ноутбук|пк'),
    rule(['роутер','роутар','router','маршрутизатор','вайфай','wifi','wi fi'],'262','','роутер|маршрутизатор|wi fi|wifi'),
    rule(['принтер','мфу','печатающее'],'258','','принтер|мфу'),
    rule(['телевизор','телик','тв','tv','плазма'],'259','','телевизор|тв'),
    rule(['монитор','видеокарта'],'261','','монитор|видеокарта'),
    rule(['айфон','iphone','телефон','смартфон','планшет','ipad','айпад'],'260','','телефон|смартфон|планшет'),
    rule(['плейстейшн','playstation','ps4','ps5','ps3','xbox','иксбокс','nintendo','приставка'],'264','','приставка|консоль'),
    rule(['восстановление','восстановить','удаленные файлы'],'263','','восстановление|данных'),
    rule(['обжим','обжать'],'437','','обжим|кабель')
  ];
  const MNC = [
    rule(['стиральная','стиралка','стиральную','стиральной'],'565','661',['бытов','техник']),
    rule(['посудомоечная','посудомойка','посудомойку','посудомоечную'],'565','660',['бытов','техник']),
    rule(['холодильник','морозилка'],'565','662',['бытов','техник']),
    rule(['духовка','духовой','электроплита','плита'],'565','657',['бытов','техник']),
    rule(['вытяжка','вытяжку'],'565','656',['бытов','техник']),
    rule(['кофемашина'],'565','658',['бытов','техник']),
    rule(['бойлер','водонагреватель'],'565','655',['бытов','техник']),
    rule(['смеситель','сифон'],'458','539',['сантех']),
    rule(['полотенцосушитель'],'458','540',['сантех']),
    rule(['ванна','душевая','кабинка'],'458','542',['сантех']),
    rule(['пластиковые трубы'],'458','544',['сантех']),
    rule(['кран на кухне','кран в ванной','кран в туалете'],'458','545',['сантех']),
    rule(['раковина','мойка'],'458','541',['сантех']),
    rule(['унитаз','инсталляция'],'458','543',['сантех']),
    rule(['засор'],'458','701',['сантех']),
    rule(['розетка','выключатель'],'457','546',['электр']),
    rule(['люстра','светильник'],'457','547',['электр']),
    rule(['проводка','кабель'],'457','548',['электр']),
    rule(['телевизор','тв'],'703','704',['телевизор','тв']),
    rule(['кондиционер','кондер'],'665','',['кондиционер']),
    rule(['сборка мебели','собрать мебель','мебель','шкаф'],'554','556',['мебел']),
    rule(['сборка кухни','собрать кухню','установка кухни'],'554','578',['мебел']),
    rule(['турник'],'459','551',['навес','мастер']),
    rule(['сушилка'],'459','552',['навес','мастер']),
    rule(['замок','замка'],'459','689',['навес','мастер']),
    rule(['окно','оконная ручка'],'459','692',['навес','мастер']),
    rule(['карниз','шторы','жалюзи','повесить','полка','полки','зеркало','кронштейн'],'459','550',['навес','мастер']),
    rule(['дезинфекция','травля'],'579','580',['дезинф']),
    rule(['плинтус'],'577','558',['отдел']),
    rule(['ламинат','линолеум'],'577','557',['отдел'])
  ];
  const BT = [
    rule(['стиральная','стиралка','стиральную','стиральной'],'311','',['стирал']),
    rule(['посудомоечная','посудомойка','посудомойку'],'312','',['посудомо']),
    rule(['холодильник','морозилка'],'310','',['холодиль']),
    rule(['духовка','духовой','электроплита'],'315','',['духов','плит']),
    rule(['вытяжка','вытяжку'],'316','',['вытяж']),
    rule(['кофемашина'],'313','',['кофема']),
    rule(['бойлер','водонагреватель'],'441','',['бойлер','водонагрев']),
    rule(['телевизор','тв'],'318','',['телевизор','тв']),
    rule(['кондиционер','кондер'],'436','',['кондицион'])
  ];
  const RULES = Object.freeze({kp:KP,mnc:MNC,bt:BT});
  const words=value=>normalize(value).replace(/https?:\/\/\S+/giu,' ').match(/[\p{L}\p{N}]+/gu)||[];
  const labelKey=value=>words(value).filter((word,index)=>index!==0 || word!=='бт').join('');
  function validOptions(options){
    return (Array.isArray(options)?options:[]).filter(option=>option&&!option.disabled&&text(option.id??option.value).trim()).map(option=>({id:text(option.id??option.value),label:text(option.label??option.text??option.name??option.title)}));
  }
  const stem=word=>word.length<5?word:word.replace(/(?:иями|ого|ему|ому|ыми|ими|ами|ями|ая|яя|ую|юю|ое|ее|ые|ие|ий|ый|ой|ей|ом|ем|ах|ях|ам|ям|ов|ев|ию|ия|ью|а|я|ы|и|у|ю|е|о|ь)$/u,'');
  function sameWord(left,right){
    if(left===right)return true;
    if(left.startsWith('подключ')&&right.startsWith('подключ'))return true;
    const a=stem(left),b=stem(right);
    return a.length>=4 && a===b;
  }
  function location(tokens,term){
    const phrase=words(term);if(!phrase.length)return null;
    for(let index=0;index<=tokens.length-phrase.length;index++){
      if(index>0 && /^(?:не|нет)$/u.test(tokens[index-1]))continue;
      if(phrase.every((word,offset)=>sameWord(tokens[index+offset],word)))return {position:index,specificity:phrase.length,exact:phrase.every((word,offset)=>word===tokens[index+offset])};
    }
    return null;
  }
  function labelAliases(base,wanted){
    const canonical=labelKey(wanted),result=new Set([canonical]);
    for(const [label,aliases]of Object.entries(data?.labelAliases||{})){
      if(labelKey(label)!==canonical)continue;
      for(const alias of aliases)result.add(labelKey(alias));
    }
    return result;
  }
  function resolveLabel(options,base,wanted){
    if(!wanted)return null;
    const valid=validOptions(options),key=labelKey(wanted),exact=valid.filter(option=>labelKey(option.label)===key);
    if(exact.length)return exact.length===1?exact[0]:null;
    const aliases=labelAliases(base,wanted),matches=valid.filter(option=>aliases.has(labelKey(option.label)));
    return matches.length===1?matches[0]:null;
  }
  function legacyWork(options,item){
    const valid=validOptions(options);
    const compatible=label=>item.labels.some(hint=>normalize(label).includes(normalize(hint)));
    const canonicalLabels=new Set(Object.entries(data?.labelAliases||{}).filter(([label,aliases])=>[label,...aliases].some(compatible)).flatMap(([label,aliases])=>[label,...aliases]).map(labelKey));
    const matches=valid.filter(option=>compatible(option.label)||canonicalLabels.has(labelKey(option.label)));
    const exact=matches.find(option=>option.id===item.workId);
    return exact || (matches.length===1?matches[0]:null);
  }
  function suggest({base,comment,workOptions,serviceOptions,selectedWorkId}){
    const reference=data?.bases?.[base];if(!reference)return null;
    const tokens=words(comment),candidates=[];
    if(!tokens.length && text(comment).trim()!=='-')return null;
    const referencedTerms=new Set(reference.entries.map(entry=>words(entry.term).join(' ')));
    for(const item of reference.entries){
      const hit=item.term==='-'?(text(comment).trim()==='-'?{position:0,specificity:1,exact:true}:null):location(tokens,item.term);
      if(!hit)continue;
      const work=resolveLabel(workOptions,base,item.workLabel);
      if(!work || selectedWorkId && work.id!==text(selectedWorkId))continue;
      candidates.push({...hit,item,work,reference:true});
    }
    // Retain existing vocabulary not supplied by the reference (e.g. засор,
    // Windows). A conflicting reference term always has the primary meaning.
    for(const item of RULES[base]||[]){
      for(const term of item.keys){
        if(referencedTerms.has(words(term).join(' ')))continue;
        const hit=location(tokens,term);if(!hit)continue;
        const work=legacyWork(workOptions,item);
        if(work && (!selectedWorkId || work.id===text(selectedWorkId)))candidates.push({...hit,item,work,reference:false});
      }
    }
    if(!candidates.length)return null;
    candidates.sort((a,b)=>a.position-b.position || b.specificity-a.specificity || Number(b.exact)-Number(a.exact) || Number(b.reference)-Number(a.reference));
    const picked=candidates[0];
    const conflict=candidates.some(row=>row.position===picked.position && row.specificity===picked.specificity && row.exact===picked.exact && row.reference===picked.reference && row.work.id!==picked.work.id);
    if(conflict)return null;
    let service=picked.reference?resolveLabel(serviceOptions,base,picked.item.serviceLabel):validOptions(serviceOptions).find(option=>option.id===picked.item.serviceId);
    if(!service && picked.reference && !picked.item.serviceLabel){
      const legacy=(RULES[base]||[]).find(item=>item.workId===picked.work.id && item.serviceId && item.keys.some(term=>location(tokens,term)));
      if(legacy)service=validOptions(serviceOptions).find(option=>option.id===legacy.serviceId);
    }
    return {workId:picked.work.id,serviceId:service?.id||'',category:picked.work.label,source:'comment',position:picked.position,matchedTerm:picked.item.term||'',serviceLabel:picked.item.serviceLabel||'',dictionaryRevision:data.revision};
  }
  return {suggest,words};
});
