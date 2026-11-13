/* Conservative map labels and native geocoder address components. No network. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadChatAddress = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clean = value => String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const key = value => clean(value).toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const mapHousePattern = '\\d{1,4}(?:[а-яa-z]|/\\d{1,4}[а-яa-z]?)?(?:\\s*(?:корпус|корп\\.?|к\\.?|строение|стр\\.?)\\s*\\d{1,4}[а-яa-z]?)*';
  const mapHouseNumber = value => new RegExp('^(?:(?:дом|д\\.)\\s*№?\\s*)?(' + mapHousePattern + ')$', 'iu').exec(clean(value))?.[1] || '';
  function microdistrictName(value) {
    const raw=clean(value),marker='(?:микрорайон|мкр(?:-н)?\\.?|квартал|кв-л\\.?)';
    const match=new RegExp('^(?:'+marker+'\\s+(.+)|(.+?)\\s+'+marker+')$','iu').exec(raw);
    if(!match)return '';
    const name=match[1]||match[2];
    if(/[,;]|(?:^|\s)(?:дом|д\.|улица|ул\.|проспект|пр-т|переулок|пер\.|проезд|шоссе|площадь|набережная|бульвар)(?:\s|$)/iu.test(name))return '';
    const numeric=/^(\d{1,4}[а-яa-z]?)(?:-(?:й|ый|ой))?$/iu.exec(name);
    const unit=/(?:^|\s)(?:квартал|кв-л\.?)(?:\s|$)/iu.test(raw)?'квартал':'микрорайон';
    return numeric?numeric[1]+' '+unit:raw;
  }
  function returnedLabelParts(labels) {
    const microdistricts=[],houses=[],settlements=[];let separateStreet=false;
    for(const label of labels){
      for(const part of addressDetails(label).rest.split(',').map(clean).filter(Boolean)){
        if(/(?:^|\s)(?:улица|ул\.|проспект|пр-т|переулок|пер\.|проезд|шоссе|площадь|пл\.|набережная|бульвар)(?:\s|$)/iu.test(part))separateStreet=true;
        const inline=/^(.+?)\s+(?:дом|д\.)\s*(.+)$/iu.exec(part);
        const microdistrict=microdistrictName(inline?inline[1]:part);
        if(microdistrict)microdistricts.push(microdistrict);
        if(/^(?:(?:(?:рабочий|городской)\s+)?пос[её]лок(?:\s+городского\s+типа)?|пгт\.?|деревня|дер\.|село|с\.)\s+/iu.test(part))settlements.push(part);
        const house=mapHouseNumber(inline&&microdistrict?inline[2]:part);
        if(house)houses.push(house);
      }
    }
    return {microdistricts,houses:[...new Map(houses.map(value=>[key(value),value])).values()],settlements,separateStreet};
  }
  function addressDetails(value) {
    const found={apartment:[],entrance:[],floor:[]};
    let rest=clean(value);
    rest=rest.replace(/(^|[^\p{L}\p{N}])(?:квартира|квартиру|квартиры|кв)\.?\s*[:№#-]?\s*(\d{1,5}[а-яa-z]?)(?![\p{L}\p{N}])/giu,(...args)=>{found.apartment.push(args[2].toUpperCase());return args[1]||' ';});
    rest=rest.replace(/(^|[^\p{L}\p{N}])(?:под[ъь]?езд(?:а|у)?|подъ|пд|п)\.?\s*[:№#-]?\s*(\d{1,3}[а-яa-z]?)(?![\p{L}\p{N}])/giu,(...args)=>{found.entrance.push(args[2].toUpperCase());return args[1]||' ';});
    rest=rest.replace(/(^|[^\p{L}\p{N}])(?:этаж(?:а|е)?|эт)\.?\s*[:№#]?\s*(-?\d{1,3})(?![\p{L}\p{N}])/giu,(...args)=>{found.floor.push(String(Number(args[2])));return args[1]||' ';});
    rest=rest.replace(/(^|[^\p{L}\p{N}])(-?\d{1,3})\s*(?:-?\s*(?:й|ый|ой))?\s+этаж(?:а|е)?(?![\p{L}\p{N}])/giu,(...args)=>{found.floor.push(String(Number(args[2])));return args[1]||' ';});
    rest=rest.replace(/(^|[^\p{L}\p{N}])первый\s+этаж(?![\p{L}\p{N}])/giu,(...args)=>{found.floor.push('1');return args[1]||' ';});
    const fields=Object.fromEntries(Object.entries(found).map(([name,values])=>[name,[...new Set(values)]]));
    return {rest:rest.replace(/^[\s,;]+|[\s,;]+$/g,'').replace(/\s+/g,' ').trim(),fields,conflict:Object.values(fields).some(values=>values.length>1)};
  }
  function parseSimpleAddress(value) {
    const empty={ok:false,manual:true,address:'',street:'',house:'',apartment:'',entrance:'',floor:''},raw=clean(value);
    if(!raw)return {...empty,manual:false};
    // Rural, regional and plot descriptions need a human choice, even when they
    // contain a street-looking fragment or separate flat/floor numbers.
    if(/(?:^|[^\p{L}])(?:область|обл\.|район|р-н|деревня|дер\.|село|пос[её]лок|пгт|участок|снт|днт|республика|край)(?!\p{L})/iu.test(raw))return empty;
    const details=addressDetails(raw);if(details.conflict)return empty;
    const fields=Object.fromEntries(Object.entries(details.fields).map(([name,values])=>[name,values[0]||'']));
    const rest=details.rest.replace(/^адрес\s*[:—-]\s*/iu,'').replace(/(^|[\s,])(?:дом|д\.)\s*(?=\d)/giu,'$1').trim();
    if(!rest)return {...empty,...fields,ok:true,manual:false};
    const match=/^(.+?)[\s,]*(\d{1,4}(?:[а-яa-z]|\/\d{1,4}[а-яa-z]?)?)(?:\s*[-—]\s*(\d{1,5}[а-яa-z]?)|\s+(\d{1,5}[а-яa-z]?))?$/iu.exec(rest);
    if(!match)return empty;
    const street=match[1].replace(/[\s,]+$/u,'').trim(),house=match[2],implicit=match[3]||match[4]||'';
    if(!/\p{L}/u.test(street)||street.length>100||street.split(/\s+/u).length>8||/^(?:ул(?:ица)?\.?|проспект|пр-т|переулок|пер\.?|проезд|шоссе|площадь|пл\.?)$/iu.test(street)||implicit&&fields.apartment&&key(implicit)!==key(fields.apartment))return empty;
    const marked=/^(?:ул(?:ица)?\.?|проспект|пр-т|переулок|пер\.?|проезд|шоссе|площадь|пл\.?)\s+/iu.test(street);
    if(!marked&&(street.replace(/[^\p{L}]/gu,'').length<3||/^\d/u.test(street)||/^(?:от|до|за|по|нас|нам|мне|вам|цена|стоимость|время|час|часов|руб|рублей|завтра|сегодня|вчера|утром|вечером|привет|мастер)(?:\s|$)/iu.test(street)||/^(?:буду|будем|будет|приеду|приедем)/iu.test(street)))return empty;
    return {...empty,...fields,ok:true,manual:false,street,house,apartment:fields.apartment||implicit,address:street+', '+house};
  }
  // The operator has explicitly chosen the Street field. Match the native
  // crm-auto-house suffix extraction here, without relaxing chat inference.
  function splitStreetAddress(value) {
    const empty={ok:false,street:'',house:''},details=addressDetails(value);
    if(details.conflict)return empty;
    const rest=details.rest;
    if(/^(?:\d{1,4}[а-яa-z]?(?:-(?:й|ый|ой))?\s+(?:микрорайон|мкр(?:-н)?\.?|квартал|кв-л\.?)|(?:микрорайон|мкр(?:-н)?\.?|квартал|кв-л\.?)\s+\d{1,4}[а-яa-z]?)$/iu.test(rest))return empty;
    const match=/^(.+?)[,\s]+(?:(?:дом|д\.?)\s*№?\s*)?(\d{1,4}(?:[а-яa-z]|[/-]\d{1,4}[а-яa-z]?)?(?:\s*(?:корпус|корп\.?|к\.?|строение|стр\.?)\s*\d{1,4}[а-яa-z]?)*)(?:\s+дом)?$/iu.exec(rest);
    if(!match)return empty;
    const street=match[1].replace(/[,\s]+$/u,'').trim();
    if(!/\p{L}/u.test(street)||/^(?:дом|д\.?|улица|ул\.?|микрорайон|мкр(?:-н)?\.?|квартал|кв-л\.?)$/iu.test(street))return empty;
    const fields=Object.fromEntries(Object.entries(details.fields).map(([name,values])=>[name,values[0]||'']));
    return {...fields,ok:true,street,house:match[2],address:street+', '+match[2]};
  }
  function pickAddressCandidate(candidates,hint,city){
    const exact=(candidates||[]).filter(item=>item?.exact===true && item.house && (item.street || item.addressMode==='settlement-house') && Array.isArray(item.coordinates));
    const direct=exact.filter(item=>String(item.id)===String(hint?.id)||item.mapAddress?.uri===hint?.id);
    if(direct.length===1)return direct[0];
    const normalize=value=>key(mapQuery(city,value)).replace(/[^\p{L}\p{N}]+/gu,' ').trim(),query=hint?.query||hint?.label||'',wanted=normalize(query);
    const same=exact.filter(item=>normalize(item.label)===wanted);if(same.length===1)return same[0];
    const requested=splitStreetAddress(query).house;
    if(requested){const houses=exact.filter(item=>key(item.house)===key(requested)&&[item.street,item.settlement].some(name=>name&&wanted.includes(key(name).replace(/[^\p{L}\p{N}]+/gu,' ').trim())));if(houses.length===1)return houses[0];}
    return exact.length===1?exact[0]:null;
  }
  function normalizeMapCity(value) {
    let city = clean(value).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' ').replace(/\s+/g,' ').trim().replace(/^(?:г\.|город)\s*/iu, '').replace(/\s+(?:электрика|сантехника)$/iu, '').trim();
    if (/^(?:иркутск\s*\(\s*ангарск\s*\)|ангарск\s*\(\s*иркутск\s*\))$/iu.test(city)) return 'Ангарск';
    // CRM catalogue appends a routing city in parentheses and an office number.
    // They are not part of the address sent to the map service.
    city = city.replace(/\s*\([^)]*\).*$/, '').replace(/\s*\d+\s*-?\s*$/, '').replace(/\s*-\s*$/, '').trim();
    if (/^(?:спб|санкт[\s-]петербург)(?:\s*\d{1,2})?$/iu.test(city)) return 'Санкт-Петербург';
    if (/^ангарск$/iu.test(city)) return 'Ангарск';
    return city;
  }
  function geocoderComponents(input, options = {}) {
    const components = (Array.isArray(input) ? input : []).filter(item => item && typeof item.kind === 'string' && typeof item.name === 'string').map(item => ({kind:item.kind,name:clean(item.name)}));
    const get = kind => components.find(item => item.kind === kind)?.name || '';
    const expected = normalizeMapCity(options.city || get('locality'));
    const city = components.find(item => item.kind === 'locality' && key(normalizeMapCity(item.name)) === key(expected))?.name || get('locality');
    const markedSettlement = /^(?:(?:(?:рабочий|городской)\s+)?пос[её]лок(?:\s+городского\s+типа)?|пгт\.?|деревня|дер\.|село|с\.)\s+/iu;
    const labels=returnedLabelParts(Array.isArray(options.labels)?options.labels:[]);
    const settlement = components.find(item => ['locality','other'].includes(item.kind) && markedSettlement.test(item.name) && key(normalizeMapCity(item.name)) !== key(expected))?.name || labels.settlements.find(value=>key(normalizeMapCity(value))!==key(expected)) || '';
    const marked=components.filter(item => ['district','other','locality'].includes(item.kind) && microdistrictName(item.name));
    const names=[...new Map([...marked.map(item=>microdistrictName(item.name)),...labels.microdistricts].map(value=>[key(value),value])).values()];
    const microdistrict=marked[0]?.name || (names.length===1?names[0]:'');
    const house=get('house') || (options.houseResult&&labels.houses.length===1?labels.houses[0]:'');
    // A district is an address unit only when explicitly a microdistrict/quarter
    // and the provider supplied a house. Administrative districts never qualify.
    const street=get('street') || (house&&names.length===1&&!labels.separateStreet?names[0]:'');
    const microdistrictIsStreet=microdistrict&&key(microdistrictName(street))===key(microdistrictName(microdistrict));
    return { city, street, house, settlement:settlement || (microdistrictIsStreet?'':microdistrict), microdistrict };
  }
  function mapQuery(city, query) {
    const name=normalizeMapCity(city);let raw=clean(query);
    const aliases=[clean(city),name].filter(Boolean).sort((a,b)=>b.length-a.length);
    let prefix='';for(const alias of aliases)if(key(raw).startsWith(key(alias))&&/^[\s,]/.test(raw.slice(alias.length,alias.length+1))){prefix=name;raw=raw.slice(alias.length).replace(/^[\s,]+/,'');break;}
    const parsed=parseSimpleAddress(raw),details=addressDetails(raw);
    raw=parsed.ok&&parsed.address&&(parsed.apartment||parsed.entrance||parsed.floor)?parsed.address:details.rest;
    // This shorthand belongs to a deliberate map search with a selected city;
    // conversational address extraction above remains conservative.
    const shorthand=name&&new RegExp('^(\\d{1,4}[а-яa-z]?)\\s*[,\\s]\\s*('+mapHousePattern+')$','iu').exec(raw);
    if(shorthand)raw=shorthand[1]+' микрорайон, дом '+shorthand[2];
    if(prefix)raw=[prefix,raw].filter(Boolean).join(', ');
    if(!raw)return name;
    if(raw.split(',').some(part=>key(part)===key(name)))return raw.split(',').map(part=>key(part)===key(city)?name:part.trim()).join(', ');
    for(const alias of aliases){
      if(key(raw)===key(alias))return name;
      if(key(raw).startsWith(key(alias)) && /^[\s,]/.test(raw.slice(alias.length,alias.length+1)))return [name,raw.slice(alias.length).replace(/^[\s,]+/,'')].filter(Boolean).join(', ');
    }
    return [name,raw].filter(Boolean).join(', ');
  }
  function settlementFromAddress(value, city) {
    const parts=clean(value).split(',').map(item=>item.trim());
    return parts.find(item=>(microdistrictName(item)||/^(?:(?:(?:рабочий|городской)\s+)?пос[её]лок(?:\s+городского\s+типа)?|пгт\.?|деревня|дер\.|село|с\.)\s+/iu.test(item)) && key(normalizeMapCity(item))!==key(normalizeMapCity(city))) || '';
  }
  return Object.freeze({ normalizeMapCity, geocoderComponents, mapQuery, settlementFromAddress, parseSimpleAddress, splitStreetAddress, pickAddressCandidate });
});
