(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LeadChatRequestPanel = api;
    if (typeof document !== 'undefined') {
      const start=()=>{const instance=api.mount();root.LeadChatPanelTools?.attach(instance);};
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
      else start();
    }
  }
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const BASES = ['kp', 'mnc', 'bt'];
  const RESTORE_ACTIONS = ['cancel_transaction','unroll_finish','take','not_taken_to_await'];
  const BASE_LABELS = {kp: 'КП', mnc: 'МНЧ', bt: 'БТ'};
  function creationStamp(match) {
    const raw = text(match?.createdAt || match?.created_at || match?.creationDate).trim();
    if (!raw) return null;
    let parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
    const ru = raw.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!ru) return null;
    const year = Number(ru[3]) + (ru[3].length === 2 ? 2000 : 0);
    parsed = Date.UTC(year, Number(ru[2]) - 1, Number(ru[1]), Number(ru[4] || 0), Number(ru[5] || 0));
    return Number.isFinite(parsed) ? parsed : null;
  }
  function latestMatch(matches) {
    const values = (Array.isArray(matches) ? matches : []).filter(item => /^\d+$/.test(text(item?.id || item?.number)));
    if (!values.length) return null;
    return values.reduce((best, item) => {
      if (!best) return item;
      const a = creationStamp(item), b = creationStamp(best);
      if (a !== null && b !== null && a !== b) return a > b ? item : best;
      // CRM identifiers grow with creation. The appointment date is NOT the creation date.
      return BigInt(text(item.id || item.number)) > BigInt(text(best.id || best.number)) ? item : best;
    }, null);
  }
  const isSystemField = name => /^CustomerRequest\[date_changes\](?:\[\])?$/.test(text(name));
  function nativeVisitHistory(record) {
    if (!record) return '';
    const name = 'CustomerRequest[date_changes]';
    // Only saved native history belongs here; dates from the local form are not
    // transfers until the CRM records them itself.
    for (const values of [record.form?.values, record.values, record.fields]) {
      if (values && Object.prototype.hasOwnProperty.call(values, name)) return text(values[name]);
    }
    const native = record.nativeComments?.date_changes ?? record.document?.nativeComments?.date_changes;
    if (native !== undefined && native !== null) return text(typeof native === 'object' ? native.value : native);
    const field = record.form?.fields?.find(item => isSystemField(item.name));
    return text(field?.value);
  }
  const isAdditionalPhoneField = name => /^Customer\[phone_extra_[1-3]\]$|^Customer\[contact_phones\]\[[^\]]+\]\[v\]$/.test(text(name));
  function editableExtras(fields) { return Object.fromEntries(Object.entries(fields || {}).filter(([name]) => !isSystemField(name))); }
  function editableDraft(draft) { if (!draft) return draft; const copy = {...draft, extraFields: editableExtras(draft.extraFields)}; delete copy.autoQuotedPrice; for (const name of Object.keys(copy)) if (isSystemField(name)) delete copy[name]; return copy; }
  const DRAFT_FIELDS = ['base', 'cityId', 'street', 'house', 'apartment', 'settlement', 'entrance', 'floor', 'intercom', 'clientName', 'age', 'phone', 'serviceId', 'workId', 'date', 'time', 'comments', 'commentsService', 'visitHistory', 'partnerComment', 'partnerId', 'requestType'];
  function mergeRefreshedDraft(previous, local, fresh) {
    const merged = {...fresh, extraFields: {...fresh.extraFields}};
    if(typeof local.extraPhoneExpanded==='boolean')merged.extraPhoneExpanded=local.extraPhoneExpanded;
    if(local.extraPhoneMessageKey)merged.extraPhoneMessageKey=local.extraPhoneMessageKey;
    if(local.sourceOverride===true)for(const name of ['sourceOverride','sourceCode','sourceUrl','partnerId','partnerComment'])merged[name]=local[name];
    const same = (a, b) => Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : text(a) === text(b);
    for (const name of [...DRAFT_FIELDS, 'farRide', 'callBeforeVisit', 'callCheck', 'urgent', 'zakrep', 'feedback']) {
      if (name !== 'base' && !same(local[name], previous[name])) merged[name] = local[name];
    }
    for (const [name, value] of Object.entries(local.extraFields || {})) {
      if(isSystemField(name))continue;
      const previousValue=previous.extraFields?.[name];let unchanged=same(value,previousValue);
      if(isAdditionalPhoneField(name) || name==='Customer[phone]'){const a=phoneInfo(value),b=phoneInfo(previousValue);if(a.valid && b.valid)unchanged=a.canonical===b.canonical;}
      if(!unchanged)merged.extraFields[name]=value;
    }
    if (!same(local.date, previous.date) || !same(local.time, previous.time)) merged.reason = local.reason || '';
    for (const name of ['creationCycleId', 'existingRequestId', 'allowDuplicate']) if (local[name] !== undefined) merged[name] = local[name];
    return merged;
  }
  // Publish a verified CRM receipt before a slow local draft-cache write.
  function commitVerifiedReceipt({publish, persist, onError}) {
    try { publish(); } catch (error) { if (onError) onError(error); }
    return Promise.resolve().then(persist).catch(error => { if (onError) onError(error); });
  }
  function messageFingerprint(context) {
    const messages = Array.isArray(context?.messages) ? context.messages : [], last = messages[messages.length - 1];
    return JSON.stringify([messages.length, last?.id || '', last?.createdAt || '', last?.direction || '', last?.body || '']);
  }
  function recordViewFingerprint(record) {
    const values = Object.fromEntries([...DRAFT_FIELDS, 'farRide', 'callBeforeVisit', 'callCheck', 'urgent', 'zakrep', 'feedback'].map(name => [name, record?.[name]]));
    const extras = Object.fromEntries(Object.entries(record?.extraFields || {}).filter(([name]) => !/csrf|token/i.test(name)));
    const actions = (record?.actions || []).map(action => [action.key, action.enabled, action.type, action.label, action.href || action.url || '']);
    const fields = (record?.form?.fields || []).filter(field => !/csrf|token/i.test(field.name || '') && !['hidden','submit','button','reset','password'].includes(field.type)).map(field => [field.name,field.label,field.type,field.disabled,field.readOnly,field.required,field.options,field.checked]);
    // A hidden Yii form revision may change on GET without changing the card.
    return JSON.stringify([record?.id,record?.customerId,record?.base,record?.status,record?.statusLabel,record?.statusColor,record?.hasClaim,record?.capabilities,values,extras,actions,fields,record?.lists,record?.partnerLabel,record?.fieldDifferences,nativeVisitHistory(record),record?.paymentSummary,record?.auditInfo,record?.audioAvailable,record?.customerHistory]);
  }
  const RECOVERY_DELAYS = Object.freeze([250,400,600,900,1300,2000,3000,4500,6500,8500,11000,14000]);
  function nextRecoveryDelay(attempts) { return RECOVERY_DELAYS[attempts] ?? null; }
  function canAutoReconcile(operation) { return /^\d+$/.test(text(operation?.id)) || operation?.kind === 'create' && !!text(operation.operationId); }
  function shouldSurfaceSaveError(result, attempts) {
    return result?.state !== 'uncertain' || !!result?.code || nextRecoveryDelay(attempts) === null;
  }
  const EXACT = {
    cityId: ['CustomerRequest[city_id]'], street: ['Customer[address_street]', 'CustomerRequest[address_street]'],
    house: ['Customer[address_building]', 'CustomerRequest[address_building]'], apartment: ['Customer[address_office]', 'CustomerRequest[address_office]'],
    settlement: ['Customer[address_locality]'], entrance: ['Customer[address_entrance]', 'Customer[address_porch]', 'CustomerRequest[address_entrance]', 'CustomerRequest[address_porch]'], floor: ['Customer[address_floor]', 'CustomerRequest[address_floor]'], intercom: ['Customer[address_has_intercom]', 'Customer[address_intercom]', 'CustomerRequest[address_has_intercom]', 'CustomerRequest[address_intercom]'],
    clientName: ['Customer[first_name]', 'CustomerRequest[first_name]'], age: ['Customer[age]', 'CustomerRequest[age]'],
    phone: ['Customer[phone]', 'CustomerRequest[phone]'], serviceId: ['CustomerRequest[service_id]', 'CustomerRequest[service_type_id]', 'CustomerRequest[appliance_sub_type_id]'],
    workId: ['CustomerRequest[appliance_type_id]'], date: ['CustomerRequest[opened_at]'], time: ['cr_opened_at_time', 'CustomerRequest[opened_at_time]'],
    comments: ['CustomerRequest[comments]'], commentsService: ['CustomerRequest[comments_service]'], visitHistory: ['CustomerRequest[date_changes]'], partnerComment: ['CustomerRequest[partner_comment]'],
    partnerId: ['CustomerRequest[partner_id]'], requestType: ['CustomerRequest[type]']
  };
  function text(value) { return value === undefined || value === null ? '' : String(value); }
  function clientFirstName(value) { return text(value).trim().match(/^[\p{L}]+(?:[-'’][\p{L}]+)*/u)?.[0] || ''; }
  function normalizeOptions(items) {
    if (!items) return [];
    if (!Array.isArray(items)) items = Object.entries(items).map(([id, label]) => typeof label === 'object' ? {id, ...label} : {id, label});
    const out = [];
    for (const item of items) {
      if (item && Array.isArray(item.children)) { out.push(...normalizeOptions(item.children)); continue; }
      const source = typeof item === 'object' && item !== null ? item : {id: item, label: item};
      const id = source.id ?? source.value ?? source.key;
      if (id === undefined || id === null) continue;
      if (text(id) === '') continue;
      out.push({...source, id: text(id), label: text(source.label ?? source.text ?? source.name ?? source.title ?? id)});
    }
    return out;
  }
  function boolishOptionId(options, value) {
    const list = normalizeOptions(options).filter(item => !item.disabled);
    if (!list.length) return '';
    const raw = text(value).trim().toLocaleLowerCase('ru');
    if (!raw) return '';
    const wantTrue = /^(?:1|true|yes|да|есть|нужен|нужно|подключен|подключён)$/i.test(raw);
    const wantFalse = /^(?:0|false|no|нет|не нужен|не нужно|отсутствует|без|none)$/i.test(raw);
    const exact = list.find(item => text(item.id) === text(value));
    if (exact) return exact.id;
    const pick = test => list.find(item => test.test(text(item.label)) || test.test(text(item.id)));
    if (wantTrue) return (pick(/^(?:1|да|есть|yes|true)$/i) || pick(/есть|домофон|подключ/i) || list[0]).id;
    if (wantFalse) return (pick(/^(?:0|нет|no|false)$/i) || pick(/нет|отсутств/i) || list[0]).id;
    return '';
  }
  function appendUniqueLines(existing, additions) {
    const lines = text(existing).split(/\r?\n/);
    const keys = new Set(lines.map(line => line.trim()).filter(Boolean));
    for (const addition of additions || []) for (const line of text(addition).split(/\r?\n/)) {
      if (line.trim() && !keys.has(line.trim())) { lines.push(line); keys.add(line.trim()); }
    }
    return lines.filter((line, index) => index !== 0 || line.trim()).join('\n');
  }
  function scopeKey(context, base) {
    const operator = context && (context.operatorId || context.scope && context.scope.operatorId);
    const account = context && (context.accountId || context.scope && context.scope.accountId);
    const chat = context && (context.chatId || context.conversationId);
    let origin = ''; try { origin = new URL(context.dialogUrl || context.conversationUrl).origin; } catch (_) {}
    if (!operator || !account || !chat || !origin || !BASES.includes(base)) return '';
    const client = context.client && context.client.id || context.clientId || '';
    return 'leadchat.request.panel.v3:' + JSON.stringify([text(operator), text(account), text(chat), base, origin, text(client)]);
  }
  function clockParts(timeZone, now) {
    if (!timeZone) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now || new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return {date: values.year + '-' + values.month + '-' + values.day, time: values.hour + ':' + values.minute, minutes: Number(values.hour) * 60 + Number(values.minute)};
    } catch (_) { return null; }
  }
  function minutesToTime(minutes) { return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }
  function timeToMinutes(value) { const match = /^(\d{2}):(\d{2})$/.exec(text(value)); return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : NaN; }
  function overdueMinutes(record, timeZone, at) {
    if (!record?.id || record.verified !== true || record.capabilities?.readOnly === true
      || /Отмен|Отказ|Не\s*оформ|Не\s*создан|Готов|Выполн|Закрыт|Оплачен|Брак/i.test(text(record.statusLabel || record.status))) return 0;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(record.date)), visitMinutes = timeToMinutes(record.time);
    const current = clockParts(timeZone, at);
    if (!match || !Number.isFinite(visitMinutes) || !current) return 0;
    const day = Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]));
    if (new Date(day).toISOString().slice(0,10) !== record.date) return 0;
    // Both dates use the request city's calendar, including a visit yesterday.
    const elapsed = Math.floor((Date.parse(current.date+'T00:00:00Z') - day)/60000) + current.minutes - visitMinutes;
    return elapsed >= 10 ? elapsed : 0;
  }
  function latenessText(minutes) {
    const hours = Math.floor(minutes/60), rest = minutes%60;
    return 'Опоздание: ' + (hours ? hours+'ч'+(rest ? ' '+rest+' мин' : '') : rest+' мин');
  }
  function phoneInfo(value) {
    const raw = text(value).trim(), digits = raw.replace(/\D/g, '');
    let canonical = '';
    if (/^[+\d\s().\-–—]*$/.test(raw)) {
      if (digits.length === 10) canonical = digits;
      else if (digits.length === 11 && /^[78]/.test(digits)) canonical = digits.slice(1);
    }
    if (canonical) return {valid: true, canonical, full: '7' + canonical, formatted: '+7 (' + canonical.slice(0, 3) + ') ' + canonical.slice(3, 6) + '-' + canonical.slice(6, 8) + '-' + canonical.slice(8), reason: ''};
    const reason = !raw ? 'empty' : digits.length > 11 ? 'too_long' : digits.length < 10 ? 'incomplete' : 'invalid';
    const message = reason === 'empty' ? '' : reason === 'too_long' ? 'В номере слишком много цифр. Укажите 10 цифр номера или 11 с начальной 7/8.' : 'Введите полный номер: 10 цифр номера или 11 с начальной 7/8.';
    return {valid: false, canonical: '', full: '', formatted: raw, reason, message};
  }
  function phoneNationalDigits(value) {
    const raw=text(value),digits=raw.replace(/\D/g,'');
    return (/^\s*\+7/.test(raw) || digits.length>=11 && /^[78]/.test(digits) ? digits.slice(1) : digits).slice(0,10);
  }
  function phoneInputDisplay(value) { return '+7 '+phoneNationalDigits(value); }
  function phoneFieldValue(value) {
    const digits=phoneNationalDigits(value);if(!digits)return '';
    const info=phoneInfo(digits);return info.valid?info.formatted:'+7 '+digits;
  }
  function bindRussianPhoneInput(input) {
    if(!input || input.dataset.russianPhoneBound==='true')return;
    input.dataset.russianPhoneBound='true';input.inputMode='tel';input.value=phoneInputDisplay(input.value);
    const normalize=()=>{
      const raw=input.value,position=input.selectionStart ?? raw.length,before=raw.slice(0,position),digitsBefore=before.replace(/\D/g,'').length;
      const country=/^\s*\+7/.test(raw) || raw.replace(/\D/g,'').length>=11 && /^[78]/.test(raw.replace(/\D/g,''));
      input.value=phoneInputDisplay(raw);const caret=Math.min(input.value.length,3+Math.max(0,digitsBefore-(country?1:0)));
      if(input.ownerDocument.activeElement===input)input.setSelectionRange(caret,caret);
    };
    input.addEventListener('beforeinput',event=>{
      if(input.disabled || input.readOnly || event.isComposing)return;
      const inserted=text(event.data),insertedDigits=inserted.replace(/\D/g,'');
      if(/^insert/.test(event.inputType) && insertedDigits.length>=10){event.preventDefault();input.value=phoneInputDisplay(inserted);input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));return;}
      const start=input.selectionStart ?? 3,end=input.selectionEnd ?? start;
      if(start<3){
        if(/^delete/.test(event.inputType) && end<=3){event.preventDefault();input.setSelectionRange(3,3);return;}
        input.setSelectionRange(3,Math.max(3,end));
      }else if(start===3 && start===end && event.inputType==='deleteContentBackward')event.preventDefault();
    });
    input.addEventListener('input',normalize,true);
    input.addEventListener('focus',()=>{input.value=phoneInputDisplay(input.value);if((input.selectionStart ?? 0)<3)input.setSelectionRange(3,3);});
    input.addEventListener('paste',event=>{
      if(input.disabled || input.readOnly || !event.clipboardData)return;
      const raw=event.clipboardData.getData('text'),digits=raw.replace(/\D/g,'');event.preventDefault();
      const start=Math.max(3,input.selectionStart ?? input.value.length),end=Math.max(start,input.selectionEnd ?? start);
      if(digits.length>=10){input.value=phoneInputDisplay(raw);input.setSelectionRange(input.value.length,input.value.length);}
      else input.setRangeText(digits,start,end,'end');
      input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));
    });
    input.addEventListener('blur',()=>{const value=phoneFieldValue(input.value);input.value=value || '+7 ';});
  }
  function cityKey(value) {
    return text(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function matchCity(cities, label) {
    const rules=globalThis.LeadPartnerRules || (typeof module==='object'&&module.exports?require('./leadpartner-rules.js'):null);
    return rules?.routeCity(normalizeOptions(cities),label) || null;
  }
  function createCityRoutingTask({current,resolve,apply}) {
    let pending=null,attempted='';
    function cancel(reset=false){if(pending)pending.abort.abort();pending=null;if(reset)attempted='';}
    function run(){
      const input=current();
      if(!input){cancel();return Promise.resolve();}
      if(pending?.key===input.key)return pending.promise;
      if(attempted===input.key)return Promise.resolve();
      cancel();attempted=input.key;
      const abort=new AbortController(),entry={key:input.key,abort,promise:null};pending=entry;
      entry.promise=Promise.resolve().then(()=>abort.signal.aborted?null:resolve({...input,signal:abort.signal})).then(result=>{
        if(!abort.signal.aborted&&pending===entry&&current()?.key===entry.key&&result?.ok===true)apply(result,input);
      }).catch(()=>{}).finally(()=>{if(pending===entry)pending=null;});
      return entry.promise;
    }
    return {run,cancel};
  }
  function preservedCityPin(pin,fields={}){
    const coordinates=pin?.coordinates;
    if(pin?.base!==fields.base || !Array.isArray(coordinates) || coordinates.length!==2 || !coordinates.every(Number.isFinite) || Math.abs(coordinates[0])>180 || Math.abs(coordinates[1])>90 || !text(pin.house).trim() || text(pin.street)!==text(fields.street) || text(pin.house)!==text(fields.house))return null;
    const retained=JSON.parse(JSON.stringify(pin));retained.coordinates=coordinates.slice();retained.exact=true;retained.mapBoundary=null;retained.serviceBoundary=null;retained.needsTerritoryRefresh=true;
    delete retained.territory;delete retained.cityKey;delete retained.cityId;
    return retained;
  }
  function cityChangeQuery(query,previousCity,nextCity){return text(query).trim() && cityKey(query)!==cityKey(previousCity)?text(query):text(nextCity).trim()+' ';}
  const CITY_ZONE_GROUPS = Object.freeze({
    'Europe/Kaliningrad': 'Калининград',
    'Europe/Moscow': 'Анапа|Адлер|Армавир|Балашиха|Белгород|Брянск|Видное|Владимир|Волгоград|Волгодонск|Волжский|Вологда|Воронеж|Выборг|Геленджик|Гусь Хрустальный|Дзержинск|Долгопрудный|Домодедово|Евпатория|Елец|Железногорск|Железнодорожный|Зеленоград|Иваново|Йошкар Ола|Казань|Калуга|Керчь|Киров|Кисловодск|Коломна|Королев|Кострома|Краснодар|Крымск|Курск|Липецк|Люберцы|Майкоп|Москва|Мурманск|Муром|Мытищи|Набережные Челны|Невинномысск|Нижнекамск|Нижний Новгород|Новомосковск|Новороссийск|Новочеркасск|Обнинск|Одинцово|Орёл|Орехово Зуево|Павловский Посад|Подольск|Псков|Пятигорск|Раменское Жуковский|Ростов на Дону|Рыбинск|Рязань|Саранск|Севастополь|Сергиев Посад|Серпухов|Симферополь|Славянск на Кубани|Смоленск|Сыктывкар|Сочи|СПБ|Ставрополь|Старый Оскол|Таганрог|Тамбов|Тверь|Тула|Химки|Чебоксары|Череповец|Шахты|Щекино|Электросталь Ногинск|Элиста|Ялта|Ярославль|Коммунарка|Бор|Петрозаводск|Красногорск|Губкин|Зеленодольск|Ковров|Новочебоксарск|Феодосия|Курчатов|Санкт Петербург|Туапсе|Великий Новгород|Клин|Солнечногорск|Электрогорск|Раменское|Жуковский|Дагомыс|Лазаревское|Электросталь|Ногинск|Елабуга|Керчь Феодосия|Новороссийск 2 Геленджик 2|Новороссийск Геленджик|Рязань Коломна|Ставрополь Невинномысск|Видное Домодедово|Владимир Ковров Муром|Волгодонск Элиста|Зеленоград Клин Солнечногорск|Калуга Обнинск|Курск Железногорск|Липецк Елец|Владимир Ковров|Волгоград Волжский|Казань Зеленодольск|Краснодар Славянск на Кубани|Курск Курчатов|Мытищи Королев|Нижний Новгород Дзержинск Бор|Новороссийск Анапа Геленджик|Подольск Коммунарка|Ростов на Дону Новочеркасск|Симферополь Ялта|Сочи Туапсе|Старый Оскол Губкин|Чебоксары Новочебоксарск|Ярославль Рыбинск Кострома|Новороссийск Геленджик Крымск|Орехово Зуево Электрогорск|Пятигорск Кисловодск|Симферополь Евпатория|Сочи Адлер Дагомыс Лазаревское|Санкт Петербург 2 Выборг|Тула Новомосковск|Ярославль Рыбинск',
    'Europe/Samara': 'Астрахань|Саратов|Балаково|Энгельс|Самара|Тольятти|Сызрань|Жигулевск|Новокуйбышевск|Ульяновск|Димитровград|Ижевск|Воткинск|Саратов Энгельс|Ижевск Воткинск|Самара Новокуйбышевск|Тольятти Жигулевск',
    'Asia/Yekaterinburg': 'Екатеринбург|Челябинск|Пермь|Березники|Краснокамск|Уфа|Стерлитамак|Салават|Октябрьский|Оренбург|Орск|Магнитогорск|Нижний Тагил|Тюмень|Курган|Сургут|Нефтеюганск|Нижневартовск|Новотроицк|Верхняя Пышма|Новый Уренгой|Екатеринбург 1 Верхняя Пышма|Пермь Краснокамск|Сургут Нефтеюганск|Пермь Березники|Стерлитамак Салават|Уфа Октябрьский',
    'Asia/Omsk': 'Омск',
    'Asia/Novosibirsk': 'Новосибирск|Бердск|Барнаул|Новоалтайск|Бийск|Рубцовск|Томск|Юрга|Горно Алтайск|Барнаул Новоалтайск|Бийск Горно Алтайск|Новосибирск 2 Левый берег|Новосибирск 1 Левый берег|Новосибирск 2 Правый берег|Томск Юрга|Новосибирск Бердск',
    'Asia/Krasnoyarsk': 'Красноярск|Ачинск|Норильск|Талнах|Кайеркан|Кемерово|Новокузнецк|Прокопьевск|Междуреченск|Ленинск Кузнецкий|Абакан|Красноярск сантехника|Кемерово Ленинск Кузнецкий|Красноярск Ачинск|Новокузнецк Прокопьевск',
    'Asia/Irkutsk': 'Иркутск|Ангарск|Братск|Улан Удэ|Иркутск Ангарск',
    'Asia/Yakutsk': 'Якутск|Чита|Благовещенск|Белогорск',
    'Asia/Vladivostok': 'Владивосток|Артем|Хабаровск|Комсомольск на Амуре|Хабаровск электрика|Владивосток Артем',
    'Asia/Sakhalin': 'Южно Сахалинск',
    'Asia/Kamchatka': 'Петропавловск Камчатский'
  });
  const CITY_ZONES = new Map(Object.entries(CITY_ZONE_GROUPS).flatMap(([zone,names])=>names.split('|').map(name=>[cityKey(name),zone])));
  // Prefer a confirmed CRM time zone; use this catalog only for unmistakable locations.
  function cityTimeZone(label) {
    const key = cityKey(label), normalized = key.replace(/\s+\d+$/,'');
    if (!key) return '';
    const exact = CITY_ZONES.get(key) || CITY_ZONES.get(normalized);
    if (exact) return exact;
    // Only explicit Moscow-region CRM qualifications may locate an otherwise
    // unknown suburb. A missing city never falls back to the computer's zone.
    const qualifications = text(label).match(/\([^()]*\)/g) || [];
    return qualifications.some(value=>{const area=cityKey(value.slice(1,-1));return !/(?:^|\s)не(?:\s|$)/u.test(area)&&/(?:^|\s)(?:мск|московская область|московская обл)(?:\s|$)/u.test(area);}) ? 'Europe/Moscow' : '';
  }
  function recommendedTime(timeZone, now) {
    const local = clockParts(timeZone, now);
    if (!local) return null;
    let minutes = local.minutes + 65;
    // Keep the default in the allowed CRM visit window, including a late evening.
    if (minutes > 1350) {
      const next = new Date(local.date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
      return {date: next.toISOString().slice(0,10), time:'09:00'};
    }
    return {date:local.date,time:minutesToTime(Math.max(540,minutes))};
  }
  function quickTime(timeZone, hours, now, urgent = false) {
    const current = clockParts(timeZone, now);
    if (!current) return {ok: false, error: 'Часовой пояс выбранного города не подтверждён. Укажите время вручную.'};
    const total = current.minutes + hours * 60 + (urgent ? 0 : 5);
    const date = new Date(current.date + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + Math.floor(total / 1440));
    return {ok:true,date:date.toISOString().slice(0,10),time:minutesToTime((total % 1440 + 1440) % 1440)};
  }
  function safeUrl(value, kind) {
    try {
      const url = new URL(text(value));
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      if (kind === 'crm' && (!/^https:$/.test(url.protocol) || !/^(kp|mnc|bt)-lead-centre\.ru$/.test(url.hostname))) return '';
      if (kind === 'map' && !/^(?:yandex\.(?:ru|com)|maps\.yandex\.ru)$/.test(url.hostname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  // A LeadChat name contains a reference, not proof of ownership. Opening a
  // canonical CRM URL is a navigation action only; edit rights and all writes
  // continue to require a separately verified CRM record.
  function requestCardUrl(base, id) {
    const number = text(id).trim();
    if (!BASES.includes(base) || !/^[1-9]\d{0,19}$/.test(number)) return '';
    return safeUrl('https://' + base + '-lead-centre.ru/admin/domain/customer-request/update?id=' + encodeURIComponent(number), 'crm');
  }
  function normalizeRecord(record, metadata) {
    record = record || {};
    const fields = record.fields || record.values || record.form && record.form.values || {};
    const canonical = record.draft || record.canonical || {};
    const out = {...record, extraFields: editableExtras({...fields, ...(canonical.extraFields || {}), ...(record.extraFields || {})})};
    for (const name of DRAFT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(canonical, name)) out[name] = canonical[name];
      else if (!Object.prototype.hasOwnProperty.call(record, name)) {
        const aliases = [...(EXACT[name] || [])];
        const fieldNames = metadata && metadata.fieldNames || {};
        if (name === 'serviceId' && fieldNames.service) aliases.unshift(fieldNames.service);
        if (name === 'workId' && fieldNames.workType) aliases.unshift(fieldNames.workType);
        if (name === 'date' && fieldNames.date) aliases.unshift(fieldNames.date);
        if (name === 'time' && fieldNames.time) aliases.unshift(fieldNames.time);
        if (name === 'phone' && fieldNames.phone) aliases.unshift(fieldNames.phone);
        const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(fields, alias));
        if (key) out[name] = fields[key];
      }
    }
    out.id = text(record.id ?? record.requestId ?? record.number);
    out.url = safeUrl(record.url || record.requestUrl, 'crm');
    if (out.time) out.time = text(out.time).slice(0, 5);
    if(out.date){const nativeDate=text(out.date).match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})(?:\s|$)/);if(nativeDate)out.date=nativeDate[3]+'-'+nativeDate[2]+'-'+nativeDate[1];}
    return out;
  }
  function errorText(error) { return text(error && (error.message || error.error || error.notice) || error || 'Не удалось выполнить действие.'); }
  function createStore() {
    return {
      async get(key) {
        if (!key) return null;
        if (typeof chrome === 'object' && chrome.storage && chrome.storage.local) return (await chrome.storage.local.get(key))[key] || null;
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
      },
      async set(key, value) {
        if (!key) throw new Error('Не подтверждена привязка черновика к сотруднику, диалогу и базе.');
        if (typeof chrome === 'object' && chrome.storage && chrome.storage.local) await chrome.storage.local.set({[key]: value});
        else localStorage.setItem(key, JSON.stringify(value));
      }
    };
  }
  function mount(options) {
    options = options || {};
    const doc = options.document || document;
    if (!doc.getElementById('request-form') || doc.documentElement.dataset.requestPanelMounted) return;
    doc.documentElement.dataset.requestPanelMounted = 'true';
    const win = doc.defaultView || window;
    const $ = id => doc.getElementById(id);
    for(const id of ['phone','phone-extra-1','phone-extra-2'])bindRussianPhoneInput($(id));
    const query = new URLSearchParams(win.location.search);
    const channel = query.get('channel') || '';
    const permanent = query.get('embed') === 'permanent';
    doc.body.classList.toggle('permanent-panel', permanent);
    $('close-panel').hidden = permanent;
    let hostOrigin = '';
    let expanded = false;
    let transitionKey = '', panelAnimation = null, cardTransitionPending = false, previousBodyMinHeight = '';
    const cardTransitionCover=doc.createElement('div');
    cardTransitionCover.id='card-transition-cover';cardTransitionCover.setAttribute('aria-hidden','true');
    const transitionLabel=doc.createElement('span');transitionLabel.textContent='Загружаем карточку…';cardTransitionCover.append(transitionLabel);
    const transitionFields=doc.createElement('div');transitionFields.className='card-transition-fields';
    for(let index=0;index<8;index++){const placeholder=doc.createElement('i');transitionFields.append(placeholder);}
    cardTransitionCover.append(transitionFields);doc.body.append(cardTransitionCover);
    function beginCardTransition() {
      if(!cardTransitionPending){previousBodyMinHeight=doc.body.style.minHeight;doc.body.style.minHeight=Math.max(win.innerHeight,doc.body.scrollHeight)+'px';doc.body.style.setProperty('--transition-toolbar-height',($('record-toolbar')?.getBoundingClientRect().height || 0)+'px');}
      cardTransitionPending=true;panelAnimation?.cancel();doc.body.classList.remove('route-waiting');
      doc.body.classList.add('card-transition-pending');doc.body.inert=true;
    }
    function endCardTransition() {
      if(!cardTransitionPending)return;
      cardTransitionPending=false;doc.body.classList.remove('card-transition-pending');doc.body.style.minHeight=previousBodyMinHeight;
      doc.body.style.removeProperty('--transition-toolbar-height');doc.body.inert=!!contextPending;renderMode();
    }
    function revealPanel(key) {
      if(cardTransitionPending || key === transitionKey)return;
      const previous=transitionKey;transitionKey=key;
      if(!previous || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
      panelAnimation?.cancel();
      const surface=$('request-form');
      if(surface?.animate)panelAnimation=surface.animate([{opacity:.82},{opacity:1}],{duration:140,easing:'ease-out'});
    }
    function navigateMap(url) {
      const old=$('yandex-map');
      if(old.getAttribute('src')===url){old.hidden=false;return;}
      const next=old.cloneNode(false);
      next.hidden=false;next.dataset.loading='true';
      next.addEventListener('load',()=>{
        if(!next.isConnected || $('yandex-map')!==next)return;
        delete next.dataset.loading;
      },{once:true});
      next.src=url;old.replaceWith(next);
    }
    try { const host = new URL(query.get('hostOrigin') || ''); if (['https:', 'http:'].includes(host.protocol)) hostOrigin = host.origin; } catch (_) {}
    const storage = options.storage || createStore();
    let controller;
    try {
      controller = options.controller || win.LeadChatRequestController && win.LeadChatRequestController.create();
      if (!controller) throw new Error('Модуль работы с CRM не загрузился. Обновите расширение и вкладку LeadChat.');
      controller=win.LeadChatPanelTools?.instrument(controller) || controller;
    } catch (error) { showError(errorText(error)); }
    const state = {commentInferenceEdited: false, commentAutoWorkId: '', commentAutoServiceId: '', dependencyRefreshAfterComment: false, context: null, key: '', draft: null, metadata: null, record: null, recordOrigin: '', lookupDraft: null, operation: null, mode: 'create', busy: false, preparing: false, autoReloadRequested: false, dependenciesChangedDuringLoad: false, generation: 0, dependencies: 0, dependenciesPending: false, dependenciesError: false, addressRevision: 0, phoneRevision: 0, phoneNeedsCheck: false, phoneCheck: 'idle', checkedPhone: '', duplicateMatches: [], skipAutoOpenPhone: '', clockZone: '', loaded: false, persisted: true, touched: new Set()};
    let audioState = {target: '', loaded: false, loading: false, error: false};
    const writeQueues = new Map(), completedOperations = new Set(), attemptedSafeRecovery = new Set();
    const recoveryAttempts = new Map();
    let recoveryTimer = null, recoveryInFlight = false;
    let followupType = '';
    let saveTimer, phoneTimer, clockTimer, postSaveTimer, postSaveTarget = '', trustedAction = null, resolvingBaseKey = '', failedBaseKey = '', claimTarget='';
    let refreshTimer, refreshInFlight = false, refreshQueued = false, lastRefreshStarted = 0, destroyed = false, recordReadRevision = 0;
    let commentInferenceTimer = null; 
    let addressAbort, addressSuggestTimer, addressChoiceAbort, addressChoiceRevision=0, streetSplitTimer=null;
    let navigationRecord=null, headingOpenTimer=null,openingRecord=0;
    const historyDrafts=new Map();let historyRevision=0,historyPending='',historyFingerprint='';
    const advertChoices=new Map();
    let baseResolution=null,manualBaseChoice=false,autoOpenTarget='';
    let cityPreloadKey='',cityPreloadPending='',cityPreloadAbort=null;
    let distanceKey='',distanceAbort=null,distanceRevision=0;
    let savedAddressAbort=null,savedAddressPending='',savedAddressReady=null,pinnedTerritoryAbort=null,pinnedTerritoryPending='';
    let portableScope='',portableCommon={},portableChoices=new Map(),baseTransfer=null,contextPending=false;
    let suspendedContextScope=null;
    let automaticCityChoice=null,automaticLocality='',cityRoutingReady=false;
    const cityRoutingTask=createCityRoutingTask({current:automaticCityRequest,resolve:input=>controller.resolveBranchCity(input),apply:adoptAutomaticCity});
    function sourceHeaderCity(){return text(state.context?.cityName || state.context?.cityLabel || state.context?.city).trim();}
    function automaticCityScope(){return JSON.stringify([state.generation,state.key,state.draft?.base,sourceHeaderCity()]);}
    function canChooseCity(){return !destroyed && !contextPending && !!state.context && !!state.draft && state.mode==='create' && !state.record && !state.operation && !state.touched.has('cityId') && !text(state.context.cityId);}
    function preserveAutomaticLocality(selectedLabel,sourceLocality=sourceHeaderCity()){
      if(!canChooseCity() || state.touched.has('settlement') || text(state.draft.settlement) || !sourceLocality || cityKey(sourceLocality)===cityKey(selectedLabel))return;
      state.draft.settlement=text(sourceLocality).slice(0,200);automaticLocality=state.draft.settlement;$('settlement').value=state.draft.settlement;
    }
    function syncAutomaticCity(meta){
      if(!canChooseCity())return;
      const cities=optionsFor('cityId',meta),matched=matchCity(cities,sourceHeaderCity());
      const cached=automaticCityChoice?.scope===automaticCityScope()?cities.filter(item=>!item.disabled && item.id===automaticCityChoice.cityId):[];
      const chosen=matched || (cached.length===1?cached[0]:null),previous=state.draft.cityId;
      state.draft.cityId=chosen?.id || '';
      if(chosen)preserveAutomaticLocality(chosen.label,matched?sourceHeaderCity():automaticCityChoice.sourceLocality);
      if(previous!==state.draft.cityId && state.draft.cityId && meta._dependencies && text(meta._dependencies.cityId)!==text(state.draft.cityId))state.dependenciesChangedDuringLoad=true;
    }
    function automaticCityRequest(){
      if(!canChooseCity() || !cityRoutingReady || !state.loaded || state.preparing || state.busy || !state.metadata?.form || typeof controller?.resolveBranchCity!=='function' || state.draft.cityId || !sourceHeaderCity())return null;
      const cities=optionsFor('cityId').filter(item=>!item.disabled);
      if(!cities.length || matchCity(cities,sourceHeaderCity()) || win.LeadPartnerRules?.cityAlias(sourceHeaderCity()))return null;
      const scope=automaticCityScope();
      return {key:JSON.stringify([scope,cities.map(item=>[item.id,item.label])]),scope,context:{...state.context,base:state.draft.base,cityName:sourceHeaderCity()},cities};
    }
    function adoptAutomaticCity(result,input){
      if(!canChooseCity() || automaticCityScope()!==input.scope || !['territory','route'].includes(result.source))return;
      const matches=optionsFor('cityId').filter(item=>!item.disabled && item.id===text(result.cityId));
      if(matches.length!==1)return;
      state.draft=readDraft();state.draft.cityId=matches[0].id;$('cityId').value=matches[0].id;
      automaticCityChoice={scope:input.scope,cityId:matches[0].id,sourceLocality:text(result.sourceLocality)||sourceHeaderCity()};
      preserveAutomaticLocality(matches[0].label,automaticCityChoice.sourceLocality);
      invalidateAddress(false,true,false);cityPreloadKey='';updateClock();scheduleCityMapPreload();queueSave();void dependencies();
    }
    function advertIdentity(context={}){
      const scope=context.scope || {},account=text(scope.accountId || context.accountId || context.profileId || context.profileFullTitle || context.profileTitle || context.profileName).trim();
      const operator=text(scope.operatorId || context.operatorId).trim(),id=text(context.adId || context.advertId || context.itemId || context.item?.id).trim();
      const title=text(context.workTitle || context.adTitle || context.serviceTitle).normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/g,' ').trim();
      if(!account || !id && !title)return '';
      return [hostOrigin || text(context.origin),operator,account,id?'id:'+id:'',title].map(encodeURIComponent).join('|');
    }
    function advertChoiceKey(context){const identity=advertIdentity(context);return identity?'leadchat.request.adBaseChoice.v1:'+identity:'';}
    function baseEvidenceKey(context={}){
      const source=typeof context.source==='object'?context.source?.code:context.source;
      const partner=typeof context.partner==='object'?context.partner?.number:context.partner;
      const candidates=Array.isArray(context.baseCandidates)?context.baseCandidates:[];
      return JSON.stringify([scopeKey(context,'kp'),context.scope?.key,advertIdentity(context),
        context.ok!==false,context.allowed!==false,context.routeSafe!==false,text(context.dialogUrl || context.conversationUrl),
        ...['workTitle','adTitle','serviceTitle','profileFullTitle','profileTitle','profileName','profileComment'].map(name=>text(context[name])),
        text(context.cityName || context.cityLabel || context.city),candidates,text(context.namedRequestId),!!context.ignoreNamedRequest,
        phoneInfo(context.phone || context.client?.phone).canonical,text(context.sourceCode || source),text(context.partnerNumber || partner),
        text(context.base),text(context.baseId)]);
    }
    function contextFlagsValid(context){return !!context && context.ok!==false && context.allowed!==false && context.routeSafe!==false;}
    function automaticBaseTransfer(base){
      if(state.record || state.operation || state.mode!=='create' || !state.touched.size)return null;
      const portable=portableDraftForBase(base);
      portable.transfer={...portable.transfer,automatic:true,touched:[...state.touched]};
      return portable;
    }
    function loadAutomaticBase(context,base,probe={}){
      const portable=automaticBaseTransfer(base);
      return loadContext(context,base,null,portable?.draft || null,portable?.transfer || null,probe);
    }
    function renderBaseReason(){
      const node=$('base-reason');if(!node || !state.draft)return;
      const base=state.draft.base,label=BASE_LABELS[base] || '';
      if(state.record){node.textContent=label+' — база из CRM';return;}
      if(manualBaseChoice && label){node.textContent=label+' — выбрано вручную';return;}
      const match=baseResolution?.matched?.find(item=>item.base===base);
      node.textContent=label && match ? label+' — распознано: '+match.term : baseResolution?.reason || (label?label+' — база из шапки':'Выберите базу');
    }
    function pinAdvertBase(base){
      const context=state.context,key=advertChoiceKey(context),identity=advertIdentity(context),choice={version:1,base,advertKey:identity};
      manualBaseChoice=true;if(key){advertChoices.set(key,choice);void Promise.resolve(storage.set(key,choice)).catch(()=>{});}
      const legacy=scopeKey(context,'kp').replace('leadchat.request.panel.v3:','leadchat.request.baseChoice.v1:');
      if(legacy)void Promise.resolve(storage.set(legacy,choice)).catch(()=>{});
      renderBaseReason();
    }
    let visitReasonTarget=null;
    let renderedVisitHistory='';
    const datePicker=win.LeadChatDatePicker?.create({document:doc,input:$('date')});
    function post(type, extra) { if (hostOrigin && channel && win.parent !== win) win.parent.postMessage({type, channel, ...extra}, hostOrigin); }
    function showError(message) { const value=text(message).trim();$('error').textContent=value;$('error').hidden=!value; }
    function notice(message, warning) { $('status').textContent = ''; $('status').hidden = true; }
    function clarificationRecord() { return !!state.record && /^на\s+уточнени[еи](?:\s|$)/iu.test(text(state.record.statusLabel || state.record.status).trim()); }
    function setCreateDisabled(value) { $('create-request').disabled=value;$('create-clarification').disabled=value; }
    function deliveryModeForRecord(){const status=text(state.record?.statusLabel || state.record?.status).trim();return /^(?:В\s*работе\s+)?СД(?:$|[\s.,()/])/iu.test(status)?'sd':/^в\s*работе(?:\s|$)/iu.test(status) || /^ЗПЧ(?:$|[\s.,()/])/iu.test(status)?'zpch':'';}
    function deliveryCopyText(){const record=normalizeRecord(state.record,state.metadata),mode=deliveryModeForRecord(),phone=phoneInfo(record.phone);if(!mode || !/^\d+$/.test(text(record?.id)) || !phone.valid)return '';const p=phone.canonical;return record.id+'  Тел: +7 '+p.slice(0,3)+'-'+p.slice(3,6)+'-'+p.slice(6)+' по '+(mode==='sd'?'сд':'зпч');}
    async function copyDeliveryStatus(event){if(!event.isTrusted)return;const value=deliveryCopyText();if(!value)return;try{await win.navigator.clipboard.writeText(value);}catch(_){const active=doc.activeElement,input=doc.createElement('textarea');input.value=value;input.readOnly=true;input.style.cssText='position:fixed;left:-9999px;top:0';doc.body.append(input);try{input.select();doc.execCommand('copy');}finally{input.remove();if(active?.isConnected)active.focus({preventScroll:true});}}}
    function renderRecordType(){const badge=$('record-request-type'),record=state.record;if(!record){badge.hidden=true;return;}const current=normalizeRecord(record,state.metadata),nativeField=record.form?.fields?.find(field=>(EXACT.requestType || []).includes(field.name)),list=[...optionsFor('requestType',record),...optionsFor('requestType'),...normalizeOptions(nativeField?.options || [])];const selected=list.find(item=>item.id===text(current.requestType)),label=text(selected?.label || record.requestTypeLabel || record.typeLabel || current.requestType);const type=/гарант/iu.test(label)?'warranty':/повтор/iu.test(label)?'repeat':/вперв|первич/iu.test(label)?'first':['first','repeat','warranty'].includes(label)?label:'';badge.hidden=!type;if(type){badge.dataset.requestType=type;badge.textContent=type==='warranty'?'Гарантия':type==='repeat'?'Повтор':'Впервые';badge.title='Тип заявки: '+badge.textContent;}}
    function nativeActions() { return Array.isArray(state.record?.actions) ? state.record.actions : []; }
    function nativeAction(name) { return nativeActions().find(item=>item?.key===name && item.enabled===true); }
    function recordLocked() { return !!state.record && state.record.capabilities?.readOnly!==false; }
    function writableRecord(name) { return !!state.record && !recordLocked() && !!nativeAction(name); }
    function descriptorFor(name) {
      const mapping = state.metadata?.fieldNames || {}, aliases = [...(EXACT[name] || [])];
      if(name==='serviceId'&&mapping.service)aliases.unshift(mapping.service);
      if(name==='workId'&&mapping.workType)aliases.unshift(mapping.workType);
      if(name==='date'&&mapping.date)aliases.unshift(mapping.date);
      if(name==='time'&&mapping.time)aliases.unshift(mapping.time);
      if(name==='phone'&&mapping.phone)aliases.unshift(mapping.phone);
      return fieldDescriptors().find(item=>aliases.includes(item.name || item.key));
    }
    function applyNativeAccess() {
      if(!state.record)return;
      const locked=recordLocked(), blocked=state.busy || !!state.operation;
      for(const name of DRAFT_FIELDS.filter(name=>name!=='base')) {
        const descriptor=descriptorFor(name);
        $(name).disabled=blocked || locked || !descriptor || descriptor.disabled || descriptor.readOnly
          || descriptor.type==='hidden' && name!=='time';
      }
      for(const field of $('extra-fields').querySelectorAll('[data-crm-name]'))field.disabled=blocked || locked;
      $('save-request').disabled=blocked || !writableRecord('save') || state.record.capabilities?.save!==true || state.dependenciesPending || state.dependenciesError;
      $('set-waiting').disabled=blocked || !state.loaded || !checkedContext() || !writableRecord('precheck_to_await') || state.dependenciesPending || state.dependenciesError;
      $('save-reschedule').disabled=blocked || locked || state.record.capabilities?.reschedule!==true;
      $('edit-time-reason').disabled=blocked || locked || state.record.capabilities?.reschedule!==true;
      for(const button of doc.querySelectorAll('[data-type]')){const expression=button.dataset.type==='warranty'?/гарант/i:button.dataset.type==='repeat'?/повтор/i:/вперв|первич/i;button.disabled=blocked || locked || $('requestType').disabled || !optionsFor('requestType').some(item=>expression.test(item.label)||item.id===button.dataset.type);}
      for(const id of ['plus-one','plus-two','time-slots-toggle','time-scale'])$(id).disabled=blocked || locked || state.record.capabilities?.reschedule!==true;
      for(const button of $('time-grid').querySelectorAll('button'))button.disabled=blocked || locked || state.record.capabilities?.reschedule!==true;
      for(const button of doc.querySelectorAll('[data-intercom]'))button.disabled=$('intercom').disabled;
    }
    function checkedContext() {
      return !destroyed && !contextPending && state.context && state.context.ok !== false && scopeKey(state.context, state.draft && state.draft.base) && state.context.routeSafe !== false && state.context.allowed !== false;
    }
    function setBusy(value, message) {
      if(contextPending)value=true;
      state.busy = value;
      doc.body.classList.toggle('busy', value);
      $('panel').setAttribute('aria-busy', value ? 'true' : 'false');
      $('editable-fields').disabled = value && !state.preparing || !state.context || state.context.ok === false || state.context.routeSafe === false || state.context.allowed === false || !controller || !!state.operation;
      $('base').disabled = value || !!state.operation;
      // Visible segmented buttons are not children of the hidden select. Re-enable
      // them explicitly after ambiguous automatic-base detection finishes.
      for (const button of doc.querySelectorAll('.base-option[data-base]')) {
        button.disabled = value || !!state.operation;
      }
      for (const id of ['serviceId', 'workId', 'partnerId', 'requestType']) $(id).disabled = value && state.preparing || (id === 'serviceId' || id === 'workId') && state.dependenciesPending;
      for (const field of $('extra-fields').querySelectorAll('[data-crm-name]')) field.disabled = value && state.preparing;
      for (const id of ['create-request', 'create-clarification', 'set-waiting', 'save-request', 'save-reschedule', 'check-result', 'refresh-record', 'edit-request', 'reschedule-request', 'new-request', 'cancel-edit', 'cancel-reschedule']) $(id).disabled = value || (id !== 'check-result' && id !== 'refresh-record' && !!state.operation);
      setCreateDisabled(value || state.dependenciesPending || state.dependenciesError || !state.loaded || !checkedContext() || !!state.operation || !phoneReady() || !automaticSource().ready);
      $('save-request').disabled = value || state.dependenciesPending || state.dependenciesError || !state.loaded || !!state.operation || !state.record || !checkedContext();
      $('retry-load').disabled = value;
      renderAutomaticSource();
      applyNativeAccess(); renderNativeActions(); renderPriceAvailability();
      syncExtraPhoneAccess();
      if(!value && state.record && syncIncomingExtraPhone())queueSave();
      for (const id of ['cancel-reason', 'cancel-comment', 'save-cancellation']) $(id).disabled = value;
      if (!value) armPhoneCheck();
      if (message) notice(message);
      void cityRoutingTask.run();
    }
    function contextFor(base) { return {...state.context, base: base || state.draft && state.draft.base, cityId: state.draft && state.draft.cityId || '', cityName: cityLabel()}; }
    function metadataInput(base, id) {
      const context = contextFor(base), draft = structuredCopy(state.draft);
      if (!id && !phoneInfo(draft.phone).valid) {
        draft.phone = ''; context.phone = '';
        if (context.client) context.client = {...context.client, phone: ''};
      }
      return {context, draft, id,allBases:false};
    }
    const cityCombobox=win.LeadPartnerCityCombobox?.mount($('cityId'));
    function uniqueOperation() { return win.crypto && win.crypto.randomUUID ? win.crypto.randomUUID() : 'lp-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
    function renderAdvertisement(context) {
      const link = $('ad-avito-link');
      if (!link) return;
      let href = '';
      if (!contextPending && context && context.ok !== false && context.allowed !== false && context.routeSafe !== false) {
        try {
          const value = context.adUrl;
          const raw = typeof value === 'string' ? value : '';
          if (!raw || raw.length > 4096 || /[\u0000-\u0020\u007f]/.test(raw)) throw new Error('Unavailable advertisement');
          const url = new URL(raw);
          if (url.protocol === 'https:' && ['avito.ru', 'www.avito.ru'].includes(url.hostname) && !url.username && !url.password && !url.port) href = url.href;
        } catch (_) { /* Missing native URL: keep the link hidden. */ }
      }
      link.hidden = !href;
      if (href) link.setAttribute('href', href); else link.removeAttribute('href');
    }
    function renderContextFacts(ctx) {
      renderAdvertisement(ctx);
      ctx = ctx || {};
      const rawPartner = text(ctx.partnerNumber || ctx.partner).trim(), rawSource = text(ctx.sourceCode || ctx.source).trim();
      $('fact-partner').textContent = rawPartner ? 'Партнёр ' + rawPartner + ' · проверка CRM' : 'Партнёр не указан';
      $('fact-source').textContent = rawSource ? 'Источник ' + rawSource + ' · проверка CRM' : 'Источник не указан';
      $('fact-work').textContent = text(ctx.workTitle).trim() ? 'Работы: ' + text(ctx.workTitle).slice(0,130) : '';
      const id = text(ctx.namedRequestId || '').trim();
      $('fact-existing').textContent = /^[1-9]\d{3,11}$/.test(id) ? 'В имени указан №' + id + ' · проверка CRM' : '';
      $('context-facts').hidden = false;
    }
    function manualSource() {
      const partnerId=text($('partnerId').value || state.draft?.partnerId), code=text($('source-choice').value || state.draft?.sourceCode);
      const partners=optionsFor('partnerId').filter(item=>item.id===partnerId && !item.disabled);
      const sources=(state.metadata?.sources || win.LeadPartnerSourceCatalog?.entries || []).filter(item=>text(item.code)===code && safeUrl(item.url));
      const source=sources.length===1?sources[0]:null;
      const reason=partners.length!==1?'Выберите партнёра из списка CRM.':!source?'Выберите источник из рабочего справочника.':'';
      return {ready:!reason,partnerId:partners.length===1?partnerId:'',partnerLabel:partners[0]?.label || '',code:source?.code || '',url:source?.url || '',reason};
    }
    function renderSourceChoices() {
      const manual=false, blocked=state.busy || !!state.operation;
      $('source-override').checked=manual; $('source-override').disabled=blocked;
      $('partner-fields').hidden=!manual; $('partnerId').disabled=!manual || blocked;
      const selected=manual?state.draft?.sourceCode:state.mode==='create'?state.metadata?.defaults?.sourceCode:state.record?.partnerComment;
      populate('source-choice',(state.metadata?.sources || win.LeadPartnerSourceCatalog?.entries || []).map(item=>({id:item.code,label:item.label || item.code})), 'Выберите источник', selected || '');
      $('source-choice').disabled=!manual || blocked;
    }
    function automaticSource() {
      // Partner and source are always taken from the verified channel.
      if (state.autoReloadRequested) return {ready:false,partnerId:'',partnerLabel:'',code:'',url:'',reason:'Канал изменился. Проверяем партнёра и источник…'};
      const defaults = state.metadata && state.metadata.defaults || {}, partnerId = text(defaults.partnerId), code = text(defaults.sourceCode || defaults.partnerComment).trim(), url = safeUrl(defaults.sourceUrl);
      const partners = optionsFor('partnerId').filter(item => item.id === partnerId && !item.disabled);
      const normalizedCode = value => win.CRMAvitoCore && typeof win.CRMAvitoCore.canonicalSourceCode === 'function' ? win.CRMAvitoCore.canonicalSourceCode(value) : text(value).trim().toLocaleUpperCase('ru');
      const sourceMatches = (state.metadata && state.metadata.sources || []).filter(item => normalizedCode(item.code) === normalizedCode(code) && !!safeUrl(item.url) && !!code);
      const uniqueSources = [...new Map(sourceMatches.map(item => [normalizedCode(item.code) + '|' + safeUrl(item.url), item])).values()];
      const source = uniqueSources.length === 1 && safeUrl(uniqueSources[0].url) === url && !!url ? uniqueSources[0] : null;
      const currentSource = source && win.LeadPartnerSourceCatalog.match(state.metadata?.sources || [],state.context?.sourceCode || state.context?.source,state.context?.partnerNumber || state.context?.partner,state.draft?.base || state.context?.base) === source;
      let reason = '';
      if (!state.metadata || !state.metadata.defaults) reason = 'Проверяем партнёра и источник текущего канала…';
      else if (!partnerId || partners.length !== 1) reason = 'Партнёр канала не определён однозначно в CRM. Создание недоступно.';
      else if (!source || !currentSource) reason = 'Источник или его ссылка не подтверждены для текущего канала. Создание недоступно.';
      return {ready: !reason, partnerId: partners.length === 1 ? partnerId : '', partnerLabel: partners.length === 1 ? partners[0].label : '', code: source && currentSource ? text(source.code) : '', url: source && currentSource ? url : '', reason};
    }
    function previewCreationComment(draft=state.draft) {
      if(state.mode!=='create' || state.record || state.operation || !draft)return;
      const source=draft.sourceOverride===true?manualSource():automaticSource();
      if(!source.ready)return;
      const knownUrls=new Set([...(state.metadata?.sources || []),...(win.LeadPartnerSourceCatalog?.entries || [])].map(item=>safeUrl(item.url)).filter(Boolean));
      const body=text(draft.comments).split(/\r?\n/).filter(line=>!knownUrls.has(line.trim()) || line.trim()===source.url).join('\n');
      draft.comments=win.LeadPartnerRules.whiteComment(appendUniqueLines(body,[state.context?.profileComment || state.context?.masterComment,source.url]),source.partnerLabel || state.context?.partnerNumber || state.context?.partner);
    }
    function renderAutomaticSource() {
      const creating = state.mode === 'create', auto = automaticSource();
      if(creating){previewCreationComment();if(state.draft)$('comments').value=text(state.draft.comments);}
      renderSourceChoices(); $('auto-source-info').hidden = false;
      $('partnerId').disabled = state.draft?.sourceOverride!==true || state.busy || !!state.operation;
      $('partnerComment').readOnly = creating;
      if (!creating && state.draft?.sourceOverride!==true) {
        const partnerId=text(state.record?.canonical?.partnerId || state.record?.form?.values?.['CustomerRequest[partner_id]'] || state.draft?.partnerId);
        const partners=state.metadata?.partners || state.record?.lists?.partners || [];
        const partner=partners.find(item=>text(item.id ?? item.value)===partnerId);
        $('auto-partner').textContent=text(partner?.label || partner?.text || partner?.name || state.record?.partnerLabel) || (partnerId ? '№ '+partnerId : '—');
        const source=text(state.record?.canonical?.partnerComment || state.record?.form?.values?.['CustomerRequest[partner_comment]']);
        $('auto-source').textContent=source;
        $('auto-source-link').hidden=true; $('auto-source-link').removeAttribute('href');
        $('source-help').textContent='';
        return;
      }
      $('auto-partner').textContent = auto.partnerLabel || (text(state.context?.partnerNumber || state.context?.partner) ? 'Партнёр ' + text(state.context.partnerNumber || state.context.partner) + ' (проверяется)' : 'Партнёр проверяется');
      $('auto-source').textContent = auto.code ? 'Источник ' + auto.code : text(state.context?.sourceCode || state.context?.source) ? 'Источник ' + text(state.context.sourceCode || state.context.source) + ' (проверяется)' : 'Источник проверяется';
      $('auto-source-link').hidden = !auto.url; $('auto-source-link').textContent = auto.url;
      if (auto.url) $('auto-source-link').href = auto.url; else $('auto-source-link').removeAttribute('href');
      $('source-help').textContent = auto.ready ? state.draft?.sourceOverride ? 'Партнёр и источник выбраны вручную из рабочих списков.' : 'Партнёр, источник и ссылка подставляются из текущего канала автоматически.' : auto.reason;
      $('source-help').classList.toggle('source-missing', !auto.ready);
      if (!auto.ready && state.loaded && !state.operation) $('retry-load').hidden = true;
    }
    function phoneReady() {
      const phone = phoneInfo($('phone').value);
      return phone.valid;
    }
    function readDraft() {
      const draft = editableDraft(state.draft || {});
      for (const name of DRAFT_FIELDS) {
        if (state.preparing && ['serviceId', 'workId', 'partnerId', 'requestType'].includes(name)) continue;
        if (state.preparing && name === 'cityId' && !$(name).value && !state.touched.has(name) && draft[name]) continue;
        draft[name] = name==='phone'?phoneFieldValue($(name).value):$(name).value;
      }
      draft.age = draft.age === '' ? '' : Number(draft.age);
      for(const name of ['entrance','floor'])draft[name]=text(draft[name]).replace(/[\p{White_Space}\uFEFF]/gu,'');
      for (const flag of Object.keys(FLAG_NAMES)) { const field = flagDescriptor(flag); if (field) { const checked = flag === 'feedback' && state.mode === 'create' ? true : flag==='farRide' && state.draft?.farRide==null ? null : !!state.draft?.[flag]; draft[flag] = checked; if(checked===null)delete draft.extraFields[field.name || field.key];else draft.extraFields[field.name || field.key] = flagValue(field, checked); } else delete draft[flag]; }
      if (state.mode === 'edit') draft.reason = $('edit-time-reason').value;
      if(state.mode==='create')draft.commentsService=win.LeadPartnerRules.serviceComment(draft.commentsService,state.context.dialogUrl || state.context.conversationUrl);
      if (!state.preparing && $('price-status')?.dataset.field && !$('price-status').disabled) draft.extraFields[$('price-status').dataset.field] = $('price-status').multiple ? [...$('price-status').selectedOptions].map(item=>item.value) : $('price-status').value;
      if (!state.preparing) for (const field of $('extra-fields').querySelectorAll('[data-crm-name]')) if (!isSystemField(field.dataset.crmName)) draft.extraFields[field.dataset.crmName] = field.type === 'checkbox' ? field.checked ? field.value || '1' : '0' : field.multiple ? [...field.selectedOptions].map(option => option.value) : field.value;
      for(const [index,extraPhone] of extraPhoneDescriptors().entries()){
        const extraInput=$('phone-extra-'+(index+1)),name=extraPhone.name || extraPhone.key;
        if(!state.preparing && name && extraInput && !extraInput.disabled){const info=phoneInfo(extraInput.value);draft.extraFields[name]=phoneFieldValue(extraInput.value);}
      }
      draft.sourceOverride=false;
      if (state.mode === 'create' || draft.sourceOverride) {
        const auto = automaticSource(); draft.partnerId = auto.partnerId; draft.partnerComment = auto.code; draft.sourceCode = auto.code; draft.sourceUrl = auto.url;
        for (const name of ['CustomerRequest[advert_id]', 'CustomerRequest[partner_id]', 'CustomerRequest[partner_comment]']) delete draft.extraFields[name];
      }
      return draft;
    }
    function writeDraft(draft) {
      previewCreationComment(draft);
      for (const name of DRAFT_FIELDS) $(name).value = name==='phone'?phoneInputDisplay(draft[name]):text(draft[name]);
      renderExtraPhone(draft);
      // Restore the chosen transfer reason before date/time rendering can open its dialog.
      $('edit-time-reason').value = text(draft.reason);
      renderFlags();
      for (const field of $('extra-fields').querySelectorAll('[data-crm-name]')) {
        const value = draft.extraFields && draft.extraFields[field.dataset.crmName];
        if (value === undefined) continue;
        if (field.type === 'checkbox') field.checked = value === true || value === 1 || value === '1';
        else if (field.multiple) for (const option of field.options) option.selected = (Array.isArray(value) ? value.map(text) : [text(value)]).includes(option.value);
        else field.value = text(value);
      }
      updateScale(); updateAddressState(); updateClock(); renderBaseReason(); scheduleCityMapPreload(); syncBranchDistance();
    }
    function extraPhoneDescriptors(){
      const primary=state.metadata?.fieldNames?.phone || 'Customer[phone]',fields=fieldDescriptors();
      const names=[/^Customer\[phone_extra_[1-3]\]$/.test(primary)?'Customer[phone]':'Customer[phone_extra_1]',...(state.metadata?.fieldNames?.phonesExtra || []),'Customer[phone_extra_1]','Customer[phone_extra_2]','Customer[phone_extra_3]'];
      const native=[...new Set(names)].filter(name=>name!==primary).map(name=>fields.find(field=>(field.name || field.key)===name && !field.hidden && field.type!=='hidden')).filter(Boolean);
      const shown=new Set([state.draft?.phone,state.record?.phone,...fields.filter(field=>(field.name || field.key)===primary || (field.name || field.key)==='Customer[phone]' || isAdditionalPhoneField(field.name || field.key)).map(field=>state.draft?.extraFields?.[field.name || field.key] ?? state.metadata?.form?.values?.[field.name || field.key] ?? field.value)].map(value=>phoneInfo(value).canonical).filter(Boolean));
      const summary=state.record?.verified===true?(state.record.phones || []).filter(value=>{const phone=phoneInfo(value).canonical;if(!phone || shown.has(phone))return false;shown.add(phone);return true;}).map(value=>({value,readOnly:true})):[];
      return [...native,...summary].slice(0,2);
    }
    function setExtraPhoneExpanded(open,focus=false){
      const row=$('extra-phone-row'),toggle=$('extra-phone-toggle'),input=$('phone-extra-1');if(!row || !toggle || !input)return;
      if(!open && row.contains(doc.activeElement))toggle.focus({preventScroll:true});
      row.dataset.open=String(open);row.inert=!open;row.setAttribute('aria-hidden',String(!open));
      toggle.setAttribute('aria-expanded',String(open));renderExtraPhoneIndicator();
      if(open && focus){const editable=[input,$('phone-extra-2')].find(field=>field && !field.disabled);editable?.focus({preventScroll:true});}
    }
    function renderExtraPhoneIndicator(){
      const toggle=$('extra-phone-toggle'),input=$('phone-extra-1');if(!toggle || !input)return;
      const filled=[input,$('phone-extra-2')].some(field=>!!phoneFieldValue(field?.value)),open=toggle.getAttribute('aria-expanded')==='true';toggle.dataset.hasNumber=String(filled);
      toggle.textContent=filled?'Есть второй номер':open?'−':'+';
      toggle.setAttribute('aria-label',open?'Скрыть дополнительный телефон':filled?'Показать второй номер':'Добавить дополнительный телефон');
    }
    function syncExtraPhoneAccess(){
      const fields=extraPhoneDescriptors(),toggle=$('extra-phone-toggle');if(!toggle)return;
      const blocked=state.busy && !state.preparing || !!state.operation || !state.context || state.context.ok===false || state.context.routeSafe===false || state.context.allowed===false;
      for(let index=0;index<2;index++){const field=fields[index],input=$('phone-extra-'+(index+1));if(input)input.disabled=!field || blocked || !!state.record && recordLocked() || !!field?.disabled || !!field?.readOnly;}
      toggle.disabled=!fields.length || blocked;
    }
    function renderExtraPhone(draft){
      const fields=extraPhoneDescriptors(),toggle=$('extra-phone-toggle'),row=$('extra-phone-row');if(!toggle || !row)return;
      toggle.hidden=!fields.length;row.hidden=!fields.length;
      for(let index=0;index<2;index++){
        const field=fields[index],input=$('phone-extra-'+(index+1));if(!input)continue;
        input.closest('label').hidden=!field;delete input.dataset.crmName;
        const name=field && (field.name || field.key),value=field?(name?draft.extraFields?.[name] ?? state.metadata?.form?.values?.[name]:undefined) ?? field.value ?? '':'',info=phoneInfo(value);
        if(name)input.dataset.crmName=name;input.value=phoneInputDisplay(value);input.required=false;
      }
      setExtraPhoneExpanded(!!fields.length && draft.extraPhoneExpanded===true);
      syncExtraPhoneAccess();
    }
    async function persist(snapshot) {
      snapshot = snapshot || {key: state.key, draft: state.draft, record: state.record, recordOrigin: state.recordOrigin, lookupDraft: state.lookupDraft, skipAutoOpenPhone: state.skipAutoOpenPhone, operation: state.operation, metadata: state.metadata, mode: state.mode, touched: [...state.touched]};
      if (!snapshot.key) return;
      snapshot = structuredCopy({...snapshot,metadata:snapshot.metadata || (snapshot.record?.form?snapshot.record:snapshot.key===state.key?state.metadata:null)});
      snapshot.draft = editableDraft(snapshot.draft); snapshot.lookupDraft = editableDraft(snapshot.lookupDraft);
      if (snapshot.operation && completedOperations.has(snapshot.operation.operationId)) return;
      const previous = writeQueues.get(snapshot.key) || Promise.resolve();
      const write = previous.catch(() => {}).then(() => {
        if (snapshot.operation && completedOperations.has(snapshot.operation.operationId)) return;
        return storage.set(snapshot.key, {version: 1, draft: snapshot.draft, record: snapshot.record, recordOrigin: snapshot.recordOrigin || '', lookupDraft: snapshot.lookupDraft || null, skipAutoOpenPhone: snapshot.skipAutoOpenPhone || '', operation: snapshot.operation, metadata: snapshot.metadata, touched: snapshot.touched || [], updatedAt: Date.now()});
      });
      writeQueues.set(snapshot.key, write);
      try {
        await write;
        if (snapshot.key === state.key) { state.persisted = true; $('draft-state').textContent = state.record ? 'Карточка сохранена' : 'Черновик сохранён'; }
      } catch (error) {
        if (snapshot.key === state.key) { state.persisted = false; $('draft-state').textContent = 'Не сохранён'; }
        throw new Error('Не удалось сохранить состояние операции на этом компьютере. ' + errorText(error));
      } finally { if (writeQueues.get(snapshot.key) === write) writeQueues.delete(snapshot.key); }
    }
    function queueSave() {
      if (destroyed || !state.draft || !['create', 'edit'].includes(state.mode) || state.busy && !state.preparing || state.operation) return;
      state.draft = readDraft();
      $('draft-state').textContent = 'Сохраняем…';
      clearTimeout(saveTimer);
      const snapshot = {key: state.key, draft: structuredCopy(state.draft), record: state.record, recordOrigin: state.recordOrigin, lookupDraft: state.lookupDraft, skipAutoOpenPhone: state.skipAutoOpenPhone, operation: state.operation, touched: [...state.touched]};
      const queuedGeneration=state.generation,queuedRevision=recordReadRevision,queuedRecordId=text(snapshot.record?.id);
      saveTimer=win.setTimeout(()=>{
        if(queuedGeneration!==state.generation || snapshot.key!==state.key || queuedRevision!==recordReadRevision || queuedRecordId!==text(state.record?.id))return;
        void persist(snapshot).catch(error=>showError(errorText(error)));
      },220);
    }
    function structuredCopy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function optionsFor(name, meta) {
      meta = meta || state.metadata || {};
      const lists = meta.lists || {};
      const aliases = {cityId: ['cities'], partnerId: ['partners'], serviceId: ['services'], workId: ['works', 'workTypes'], requestType: ['requestTypes', 'types']};
      for (const alias of aliases[name] || []) if (meta[alias] || lists[alias]) return normalizeOptions(meta[alias] || lists[alias]);
      return [];
    }
    function portableDraftForBase(base) {
      const scope=scopeKey(state.context,'kp');
      if(portableScope!==scope){portableScope=scope;portableCommon={};portableChoices=new Map();}
      const current=readDraft();current.base=state.draft.base;const preserveCity=!!text(current.cityId) || state.touched.has('cityId') || !!text(state.context?.cityId);
      const labels=Object.fromEntries(['cityId','workId','serviceId','requestType'].map(name=>[name,text(optionsFor(name).find(item=>item.id===text(current[name]))?.label)]));
      portableChoices.set(current.base,{values:Object.fromEntries(['cityId','workId','serviceId','requestType'].map(name=>[name,current[name]])),labels,existingRequestId:current.existingRequestId});
      const fields=['phone','clientName','age','street','house','apartment','settlement','entrance','floor','intercom','comments','commentsService','date','time','manualAddress','extraPhoneExpanded'];
      for(const name of fields)portableCommon[name]=current[name];
      for(const flag of Object.keys(FLAG_NAMES))if(flagDescriptor(flag))portableCommon[flag]=current[flag];
      portableCommon.extraPhones=extraPhoneDescriptors().map(extra=>text(current.extraFields?.[extra.name || extra.key]));
      portableCommon.allowDuplicate=current.allowDuplicate===true;
      const own=portableChoices.get(base),draft={...initialDraft(state.context,base),...structuredCopy(portableCommon),base,cityId:'',workId:'',serviceId:'',requestType:'',partnerId:'',partnerComment:'',sourceCode:'',sourceUrl:'',extraFields:{},addressConfirmed:false,addressProof:null,mapPin:null,mapCityCenter:null};
      delete draft.extraPhone;delete draft.extraPhones;
      for(const name of ['creationCycleId','customerId','id','status','operation','receipt','postSave'])delete draft[name];
      if(own?.existingRequestId && portableCommon.allowDuplicate)draft.existingRequestId=own.existingRequestId;
      else delete draft.existingRequestId;
      return {draft,transfer:{base,labels,own,extraPhones:portableCommon.extraPhones,touched:[...fields,...(preserveCity?['cityId']:[]),'workId','serviceId','requestType',...Object.keys(FLAG_NAMES).filter(flag=>typeof portableCommon[flag]==='boolean').map(flag=>'flag:'+flag)]}};
    }
    function rebindPortableChoices(meta) {
      if(!baseTransfer || baseTransfer.base!==state.draft?.base)return;
      baseTransfer.applied ||= {};
      for(const name of ['cityId','workId','serviceId','requestType']){
        const list=optionsFor(name,meta).filter(item=>!item.disabled);
        if(baseTransfer.applied[name] && state.draft[name] && list.some(item=>item.id===text(state.draft[name])))continue;
        const label=baseTransfer.labels[name],matches=list.filter(item=>cityKey(item.label)===cityKey(label));
        const own=baseTransfer.own,ownId=own?.values?.[name],native=list.find(item=>item.id===text(ownId) && cityKey(item.label)===cityKey(own?.labels?.[name]));
        const kind=value=>/гарант/iu.test(value)?'warranty':/повтор/iu.test(value)?'repeat':/вперв|первич/iu.test(value)?'first':'';
        const types=name==='requestType' && kind(label)?list.filter(item=>kind(item.label)===kind(label)):[];
        const city=name==='cityId' && label?(matchCity(list,label)?.id || win.LeadChatPriceUI?.territoryCityId(label,list)):'';
        const chosen=city || (label && matches.length===1?matches[0].id:types.length===1?types[0].id:native?.id || '');
        if(chosen || !list.some(item=>item.id===text(state.draft[name])))state.draft[name]=chosen;
        if(chosen)baseTransfer.applied[name]=true;
      }
      const extras=extraPhoneDescriptors();
      if(extras.length && baseTransfer.extraPhones){state.draft.extraFields ||= {};extras.forEach((extra,index)=>{const name=extra.name || extra.key;if(name && baseTransfer.extraPhones[index]!==undefined)state.draft.extraFields[name]=baseTransfer.extraPhones[index];});delete baseTransfer.extraPhones;}
      // A cold destination first returns its city-level work list. Once a
      // portable work label resolves to its native ID, load that work's services.
      if(meta._dependencies && (text(meta._dependencies.cityId)!==text(state.draft.cityId)
        || text(meta._dependencies.applianceTypeId)!==text(state.draft.workId)))state.dependenciesChangedDuringLoad=true;
    }
    function populate(name, items, placeholder, value) {
      const select = $(name);
      const old = value === undefined ? select.value : text(value);
      select.replaceChildren();
      const empty = doc.createElement('option'); empty.value = ''; empty.textContent = placeholder; select.appendChild(empty);
      for (const item of normalizeOptions(items)) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.label; option.disabled = !!item.disabled; select.appendChild(option); }
      select.value = old;
      if (old && (select.value !== old || select.selectedOptions[0] && select.selectedOptions[0].disabled)) select.value = '';
    }
    function fieldDescriptors(metadata) {
      metadata = metadata || state.metadata;
      const fields = metadata && metadata.form && metadata.form.fields || metadata && metadata.fields || [];
      return Array.isArray(fields) ? fields : Object.entries(fields).map(([name, value]) => typeof value === 'object' ? {name, ...value} : {name, value});
    }
    function isReviewField(field) { return field && (field.type === 'checkbox' || field.type === 'radio') && /отзыв|review/i.test(text(field.label || field.title || '')) && /^(Customer|CustomerRequest)\[[^\]]+\]$/.test(text(field.name || field.key)); }
    function renderExtraFields() {
      state.draft = editableDraft(state.draft);
      const container = $('extra-fields'); container.replaceChildren();
      if(container.closest('details')?.hidden)return;
      const aliases = new Set(Object.values(EXACT).flat());
      aliases.add('CustomerRequest[cr_form_extra][timeChangeReason]');
      for (const value of Object.values(state.metadata && state.metadata.fieldNames || {})) if (typeof value === 'string') aliases.add(value);
      const fields = fieldDescriptors().filter(field => {
        const name = field.name || field.key;
        if (isSystemField(name) || isAdditionalPhoneField(name) || isReviewField(field) || Object.values(FLAG_NAMES).includes(name) || Object.keys(FLAG_NAMES).some(flag => (flagDescriptor(flag)?.name || flagDescriptor(flag)?.key) === name)) return false;
        if (name === $('price-status')?.dataset.field || /price_statuses|озвучк[аи]|price.*voic/i.test(name+' '+text(field.label))) return false;
        if (state.mode === 'create' && name === 'CustomerRequest[advert_id]') return false;
        return name && !aliases.has(name) && /^(Customer|CustomerRequest)\[/.test(name) && !/\[(?:id|customer_id|author_id|created_by|employee_id|user_id|location|address_fias)\]/.test(name) && !field.hidden && !field.disabled && !field.readOnly && !['hidden', 'submit', 'button', 'file', 'password'].includes(field.type);
      });
      $('extra-fields').closest('details').open = fields.some(item => !!item.required);
      const names = new Set();
      for (let descriptor of fields) {
        const name = descriptor.name || descriptor.key;
        if (names.has(name)) continue;
        names.add(name);
        if (descriptor.type === 'radio') descriptor = {...descriptor, type: 'select', options: fields.filter(field => (field.name || field.key) === name).map(field => ({id: field.value, label: field.label || field.value}))};
        const label = doc.createElement('label'); label.className = 'field'; label.textContent = descriptor.label || descriptor.title || name;
        const list = descriptor.options || descriptor.items;
        let field;
        if (list && normalizeOptions(list).length || ['select', 'select-one', 'select-multiple'].includes(descriptor.type) || descriptor.tagName === 'select') {
          field = doc.createElement('select');
          field.multiple = !!descriptor.multiple;
          if (!field.multiple) { const empty = doc.createElement('option'); empty.value = ''; empty.textContent = descriptor.required ? 'Выберите значение' : 'Не указано'; field.appendChild(empty); }
          for (const option of normalizeOptions(descriptor.options || list)) { const el = doc.createElement('option'); el.value = option.id; el.textContent = option.label; el.disabled = !!option.disabled; field.appendChild(el); }
        } else if (descriptor.type === 'textarea' || descriptor.tagName === 'textarea') { field = doc.createElement('textarea'); field.rows = 2; }
        else { field = doc.createElement('input'); field.type = ['checkbox', 'number', 'date', 'time', 'tel', 'email'].includes(descriptor.type) ? descriptor.type : 'text'; }
        field.dataset.crmName = name; field.name = name; field.required = !!descriptor.required;
        const value = (state.draft.extraFields && state.draft.extraFields[name]) ?? (state.metadata.form && state.metadata.form.values && state.metadata.form.values[name]) ?? (field.type === 'checkbox' ? descriptor.checked === true : descriptor.value);
        if (field.type === 'checkbox') { field.value = text(descriptor.value || '1'); field.checked = value === '1' || value === 1 || value === true; }
        else if (field.multiple) for (const option of field.options) option.selected = (Array.isArray(value) ? value.map(text) : value === undefined || value === '' ? [] : [text(value)]).includes(option.value);
        else field.value = text(value);
        label.appendChild(field); container.appendChild(label);
      }
    }
    function renderMetadata(meta) {
      state.metadata = meta;
      rebindPortableChoices(meta);
      if (state.mode === 'create' && !state.record && !state.operation && !state.draft?.sourceOverride) {
        const auto = automaticSource(); state.draft.partnerId = auto.partnerId; state.draft.partnerComment = auto.code; state.draft.sourceCode = auto.code; state.draft.sourceUrl = auto.url;
        if (state.draft.extraFields) delete state.draft.extraFields['CustomerRequest[advert_id]'];
      }
      syncAutomaticCity(meta);
      const placeholders = {cityId: 'Выберите город', partnerId: 'Без партнёра', serviceId: 'Выберите вид услуг', workId: 'Выберите вид работ', requestType: 'Выберите тип заявки'};
      for (const name of ['cityId', 'partnerId', 'serviceId', 'workId', 'requestType']) {
        const list = optionsFor(name, meta);
        if(name==='cityId' && state.record?.verified===true && state.draft.cityId && !list.some(item=>item.id===text(state.draft.cityId))){
          const catalog=win.LeadChatCrmCityCatalog,known=normalizeOptions(typeof catalog?.forBase==='function'?catalog.forBase(state.record.base):catalog?.[state.record.base]).filter(item=>item.id===text(state.draft.cityId));
          list.push({id:text(state.draft.cityId),label:known.length===1?known[0].label:'Город №'+text(state.draft.cityId)});
        }
        if (name === 'requestType' && !list.length) { populate(name, [], 'CRM не вернула типы заявок', ''); $(name).required = true; continue; }
        if(name==='requestType' && state.mode==='create' && !state.record && !state.operation && !state.draft.existingRequestId && !state.touched.has('requestType')){const first=list.filter(option=>!option.disabled && /вперв|первич/iu.test(option.label));if(first.length===1)state.draft.requestType=first[0].id;}
        populate(name, list, placeholders[name], state.draft[name]);
        state.draft[name] = $(name).value;
      }
      const cityLabel = text(state.context.cityLabel || state.context.cityName || state.context.city);
      if (canChooseCity() && !state.draft.cityId && cityLabel) {
        const match = matchCity(optionsFor('cityId'), cityLabel);
        if (match) {state.draft.cityId = match.id;preserveAutomaticLocality(match.label);}
      }
      const intercomDescriptor = fieldDescriptors(meta).find(field => EXACT.intercom.includes(field.name || field.key));
      if (intercomDescriptor) {
        const intercomList = normalizeOptions(intercomDescriptor.options || intercomDescriptor.items || []);
        if (intercomList.length || ['select', 'select-one', 'select-multiple'].includes(intercomDescriptor.type) || intercomDescriptor.tagName === 'select') {
          const currentIntercom = boolishOptionId(intercomList, state.draft.intercom) || text(state.draft.intercom);
          populate('intercom', intercomList, 'Не указано', currentIntercom);
          $('intercom').required = false;
          state.draft.intercom = $('intercom').value;
        }
      }
      // Accept only an exact, unique work title from the chat; never guess a CRM category.
      if (state.mode === 'create' && !state.draft.workId && !state.touched.has('workId') && state.context?.workTitle) {
        const pieces = text(state.context.workTitle).split(/\s*[/|]\s*/).map(cityKey).filter(Boolean);
        const matching = optionsFor('workId').filter(item => pieces.includes(cityKey(item.label)));
        if (matching.length === 1) { state.draft.workId = matching[0].id; state.dependenciesChangedDuringLoad = true; }
      }
      for (const name of ['serviceId', 'workId']) {
        const mapping = meta.fieldNames || {};
        const descriptor = fieldDescriptors().find(field => field.name === mapping[name === 'serviceId' ? 'service' : 'workType']);
        $(name).required = name !== 'intercom' && (name === 'workId' || !!(descriptor && descriptor.required || meta.requiredFields && meta.requiredFields.includes(name)) || name === 'serviceId' && !!mapping.service && optionsFor(name, meta).length > 0);
        if (name === 'serviceId') { $(name).closest('label').hidden = !mapping.service; if (!mapping.service) $(name).required = false; }
        $(name === 'serviceId' ? 'service-label' : 'work-label').textContent = descriptor?.label && !/^(?:CustomerRequest|Customer)\[/.test(descriptor.label) ? descriptor.label : name==='serviceId'?'Вид услуг':state.draft?.base==='bt'?'Техника':'Вид работ';
      }
      $('requestType').required = true;
      for (const name of ['settlement','street','house','apartment','entrance','floor']) {
        const field=$(name); field.type='text'; field.required=false;
        for (const attribute of ['maxlength','minlength','pattern','min','max','step']) field.removeAttribute(attribute);
      }
      $('intercom').required=false;
      if (state.mode === 'create') for (const descriptor of fieldDescriptors(meta)) if (isReviewField(descriptor)) { state.draft.extraFields ||= {}; state.draft.extraFields[descriptor.name || descriptor.key] = text(descriptor.value || '1') || '1'; }
      for (const flag of Object.keys(FLAG_NAMES)) { const descriptor = flagDescriptor(flag); if (!descriptor || state.touched.has('flag:' + flag) || typeof state.draft[flag] === 'boolean' || flag==='farRide' && state.mode==='create' && !state.record) continue; const value = state.draft.extraFields?.[descriptor.name || descriptor.key] ?? meta.form?.values?.[descriptor.name || descriptor.key] ?? descriptor.checked; state.draft[flag] = value === true || value === 1 || value === '1' || value === text(descriptor.value) && value !== '0'; }
      renderFlags(); renderExtraFields(); writeDraft(state.draft); syncTypeButtons(); applyNativeAccess();
      inferWorkFromComment(false);
      let sourceSuggestions = doc.getElementById('source-suggestions');
      if (!sourceSuggestions) { sourceSuggestions = doc.createElement('datalist'); sourceSuggestions.id = 'source-suggestions'; $('partnerComment').after(sourceSuggestions); $('partnerComment').setAttribute('list', sourceSuggestions.id); }
      sourceSuggestions.replaceChildren();
      for (const source of meta.sources || []) { const option = doc.createElement('option'); option.value = text(source.code || source.id); option.textContent = text(source.label || source.code); sourceSuggestions.appendChild(option); }
      renderServicesHelp();
    }
    function initialDraft(context, base) {
      const supplied = context.draft || context.defaults || {};
      const draft = {base, cityId: context.cityId || '', street: '', house: '', apartment: '', settlement: '', entrance: '', floor: '', intercom:'',farRide:null, clientName: context.clientName || '', age: 31, phone: context.phone || '', serviceId: '', workId: '', date: '', time: '', comments: context.comments || context.comment || '', commentsService: '', partnerComment: context.sourceCode || '', partnerId: context.partnerId || '', requestType: '', addressConfirmed: false, extraFields: {}, ...supplied};
      draft.base = base; draft.age = supplied.age === undefined ? 31 : supplied.age;
      draft.manualAddress=false;draft.addressEntryPolicy='manual-only';
      draft.clientName = clientFirstName(draft.clientName);
      const phone = phoneInfo(draft.phone); if (phone.valid) draft.phone = phone.formatted;
      draft.comments = appendUniqueLines(draft.comments, [context.profileComment || context.masterComment]);
      draft.comments=win.LeadPartnerRules.withFreeVisit(draft.comments,context.messages);
      draft.commentsService=win.LeadPartnerRules.serviceComment(draft.commentsService,context.dialogUrl || context.conversationUrl);
      return editableDraft(draft);
    }
    function namedRecordOwned(record, context) {
      const normalized=normalizeRecord(record,record),ownPhone=phoneInfo(context.phone || context.client?.phone).canonical;
      const phones=Array.isArray(normalized.phones)?normalized.phones:[normalized.phone];
      const phoneVerified=!!ownPhone && phones.some(phone=>phoneInfo(phone).canonical===ownPhone);
      const dialog=text(context.dialogUrl || context.conversationUrl).trim();
      return phoneVerified || !!dialog && text(normalized.commentsService).split(/\r?\n/).some(line=>line.trim()===dialog);
    }
    async function loadContext(context, selectedBase, preloadedRecord, seedDraft=null, transfer=null,probe={}) {
      if(destroyed)return;
      const retainManualBase=manualBaseChoice && state.context && state.draft?.base===selectedBase && scopeKey(state.context,'kp')===scopeKey(context,'kp') && advertIdentity(state.context)===advertIdentity(context);
      cityRoutingTask.cancel(true);automaticCityChoice=null;automaticLocality='';cityRoutingReady=false;
      renderAdvertisement(context);
      const namedId=!context?.ignoreNamedRequest && /^[1-9]\d{3,11}$/.test(text(context?.namedRequestId))?text(context.namedRequestId):'';
      closeVisitReason(false); datePicker?.close(); cancelAddressSuggestions();clearTimeout(streetSplitTimer);streetSplitTimer=null;clearTimeout(headingOpenTimer);headingOpenTimer=null;
      const generation = ++state.generation;
      resolvingBaseKey='';
      let namedLookupAttempted=probe.namedLookupAttempted===true;
      beginCardTransition();
      resetAudio();++historyRevision;historyPending='';historyFingerprint='';openingRecord=0;
      state.preparing = false;
      stopPostSave();
      clearTimeout(saveTimer); clearTimeout(commentInferenceTimer); commentInferenceTimer = null; state.commentInferenceEdited = false; state.commentAutoWorkId = ''; state.commentAutoServiceId = ''; state.dependencyRefreshAfterComment = false; clearTimeout(phoneTimer); phoneTimer = null; state.phoneNeedsCheck = false; ++state.phoneRevision;
      setBusy(true);
      if(state.key && state.draft)void persist().catch(()=>{});
      if (generation !== state.generation) return;
      state.context = structuredCopy(context || {}); state.metadata = null; state.record = null; state.recordOrigin = ''; state.lookupDraft = null; state.skipAutoOpenPhone = ''; state.phoneCheck = 'idle'; state.checkedPhone = ''; state.duplicateMatches = []; state.operation = null; state.loaded = false; state.preparing = false; state.autoReloadRequested = false; state.dependenciesChangedDuringLoad = false; state.dependenciesPending = false; state.dependenciesError = false;
      baseTransfer=transfer;
      if(navigationRecord?.scope!==scopeKey(state.context,'kp'))navigationRecord=null;
      for(const name of [...DRAFT_FIELDS,'plus-one','plus-two','time-slots-toggle','time-scale'])$(name).disabled=false;
      for(const button of $('time-grid').querySelectorAll('button'))button.disabled=false;
      invalidateAddress(true,!!cityPreloadKey && !state.draft?.mapPin && !!$('yandex-map').getAttribute('src'));
      state.touched = new Set();
      autoOpenTarget='';
      const baseChoiceKey=scopeKey(context,'kp').replace('leadchat.request.panel.v3:','leadchat.request.baseChoice.v1:'),adKey=advertChoiceKey(context),identity=advertIdentity(context);
      // An explicit destination already decides the base. Reading preferences
      // here used to hold every manual switch behind extension storage.
      const [advertStored,legacyStored]=BASES.includes(selectedBase)?[adKey?advertChoices.get(adKey):null,null]:await Promise.all([
        adKey?(advertChoices.get(adKey) || storage.get(adKey)):null,
        baseChoiceKey?storage.get(baseChoiceKey):null
      ]).catch(()=>[null,null]);
      const chosenBase=BASES.includes(advertStored?.base)?advertStored:legacyStored && (!legacyStored.advertKey || legacyStored.advertKey===identity)?legacyStored:null;
      if(adKey && BASES.includes(advertStored?.base))advertChoices.set(adKey,advertStored);
      if(generation!==state.generation)return;
      const semanticBase = win.LeadPartnerRules?.resolveBase(context,context.baseCandidates?.length?context.baseCandidates:undefined);
      baseResolution=semanticBase;
      manualBaseChoice=retainManualBase || !!transfer && !transfer.automatic || BASES.includes(chosenBase?.base) && (!selectedBase || chosenBase.base===selectedBase);
      const base = BASES.includes(selectedBase) ? selectedBase : BASES.includes(chosenBase?.base)?chosenBase.base:BASES.includes(semanticBase?.base)?semanticBase.base:semanticBase?.requiresManual?'':BASES.includes(context.base)?context.base:BASES.includes(context.baseId)?context.baseId:'';
      state.key = scopeKey(context, base); state.draft = initialDraft(context, base); state.mode = 'create';
      if(seedDraft && !base){state.draft=editableDraft({...state.draft,...seedDraft,base:''});state.touched=new Set(transfer?.touched || []);}
      const catalog = win.LeadChatCrmCityCatalog, fallbackCities = catalog && (typeof catalog.forBase === 'function' ? catalog.forBase(base) : catalog[base]);
      if (Array.isArray(fallbackCities)) {
        const city = matchCity(fallbackCities, context.cityName || context.cityLabel || context.city);
        if (!state.draft.cityId && city) {state.draft.cityId = city.id;preserveAutomaticLocality(city.label);}
        state.metadata = {lists:{cities:fallbackCities}}; populate('cityId', fallbackCities, 'Выберите город', state.draft.cityId);
      }
      renderContextFacts(context);
      if (context.autoSelectedBaseReason && base) $('fact-work').textContent = 'База ' + BASE_LABELS[base] + ' · ' + text(context.workTitle).slice(0,130);
      $('context-label').textContent = [context.clientName || 'Клиент', context.profileName || context.profileTitle || '', base ? BASE_LABELS[base] : 'База не выбрана'].filter(Boolean).join(' · ');
      $('source-help').textContent = context.sourceUrl ? 'Ссылка источника добавляется из рабочего справочника Lead-Partner.' : 'Источник и партнёр берутся из подтверждённых данных канала.';
      $('duplicates').hidden = true; $('phone-status').textContent = ''; $('recovery').hidden = true; $('reschedule-form').hidden = true; showError('');
      $('retry-load').hidden = true;
      doc.body.classList.remove('route-waiting');
      if(!namedId){renderMode();writeDraft(state.draft);}
      if (!scopeKey(context, base || 'kp') || context.ok === false || context.routeSafe === false || context.allowed === false) {
        setBusy(false); $('editable-fields').disabled = true;
        notice('Не подтверждён текущий диалог или сотрудник. Закройте панель и откройте её из нужного чата.', true); endCardTransition(); return;
      }
      if (!base) {
        resolvingBaseKey = baseEvidenceKey(context);
        setBusy(false); $('editable-fields').disabled=false; $('base').disabled=false; renderMode();if(!namedId)endCardTransition();
      }
      // An ID already in the client name takes the direct record path. Do not
      // load creation forms, sources and phone histories before this read.
      if(!selectedBase && !context.ignoreNamedRequest && /^[1-9]\d{3,11}$/.test(text(context.namedRequestId)) && controller?.getRequest) {
        try {
          // The advertisement describes this chat, not the CRM request named
          // by the client. Only the actual card may decide its native base.
          const discoveryBases=BASES;
          const cachedRecords=await Promise.all(discoveryBases.map(async candidateBase=>{
            const cached=await storage.get(scopeKey(context,candidateBase));
            const record=cached?.version===1?cached.record:null;
            return record?.verified===true && record.form && record.base===candidateBase && text(record.id)===text(context.namedRequestId) && namedRecordOwned(record,context)?record:null;
          }));
          if(generation!==state.generation)return;
          const matches=cachedRecords.filter(Boolean);
          if(matches.length===1){await loadContext(context,matches[0].base,{...matches[0],cachedView:true});return;}
          namedLookupAttempted=true;
          const found=await controller.getRequest({context:{...context,base:''},id:text(context.namedRequestId),base:''});
          if(generation!==state.generation)return;
          if(acceptedResult(found) && BASES.includes(found.record.base) && text(found.record.id)===text(context.namedRequestId)) {
            const contextKey=[context.scope?.key,context.conversationId || context.chatId,context.client?.id].join('|');
            post('leadchat-request-record',{base:found.record.base,id:found.record.id,contextKey});
            await loadContext(context,found.record.base,found.record);return;
          }
        }catch(_){ /* The normal read-only recovery remains available below. */ }
      }
      if (!base) {
        if(controller && !context.ignoreNamedRequest)try {
          let resolvedBase='';
          if(/^[1-9]\d{3,11}$/.test(text(context.namedRequestId)) && controller.getRequest){
            if(!namedLookupAttempted){
              namedLookupAttempted=true;
              const existing=await controller.getRequest({context:{...context,base:''},id:text(context.namedRequestId),base:''});
              if(acceptedResult(existing) && BASES.includes(existing.record.base) && text(existing.record.id)===text(context.namedRequestId))resolvedBase=existing.record.base;
            }
          } else if(phoneInfo(context.phone).valid && controller.duplicates) {
            const lookup=await controller.duplicates({context:{...context,base:'kp'},phone:phoneInfo(context.phone).full,base:'kp',allBases:true});
            const existing=lookup?.ok!==false && !lookup?.incomplete ? latestMatch(lookup.matches || lookup.found || []) : null;
            if(existing && BASES.includes(existing.base))resolvedBase=existing.base;
          }
          if(generation!==state.generation)return;
          if(resolvedBase){await loadAutomaticBase(context,resolvedBase,{namedLookupAttempted});return;}
        }catch(_){ /* Ambiguous profiles remain selectable when no verified record was read. */ }
        const candidateBases = Array.isArray(context.baseCandidates) ? context.baseCandidates : [];
        const resolutionKey = baseEvidenceKey(context);
        if (controller?.resolveBase && !semanticBase?.conflict && candidateBases.length > 1 && text(context.workTitle) && resolutionKey !== failedBaseKey) {
          resolvingBaseKey = resolutionKey;
          setBusy(false,'Проверяем вид работ в ' + candidateBases.map(base=>BASE_LABELS[base]).join(' и ') + '…');
          try {
            const result = await controller.resolveBase({context:contextFor('kp'),baseCandidates:candidateBases,workTitle:context.workTitle,...(probe.refresh===true?{refresh:true}:{})});
            if (generation !== state.generation || state.draft?.base) return;
            if (result?.ok && BASES.includes(result.base)) {
              resolvingBaseKey = ''; failedBaseKey = '';
              const next = {...context, autoSelectedBaseReason: result.reason};
              await loadAutomaticBase(next,result.base,{namedLookupAttempted});
              return;
            }
            notice(result?.reason || 'CRM не подтвердила единственную подходящую базу. Выберите базу вручную.',true);
          } catch (error) {if (generation === state.generation) notice('Проверка вида работ недоступна: ' + errorText(error),true);}
          finally {if (generation === state.generation) {failedBaseKey=resolutionKey; resolvingBaseKey='';$('retry-load').hidden=false;}}
        }
        setBusy(false); $('editable-fields').disabled = false; $('base').disabled = false;
        renderMode(); // clear the disabled attributes left over from the asynchronous CRM probe
        if (!$('status').textContent.trim()) notice('Выберите КП, МНЧ или БТ: вид работ не подтверждён однозначно во всех CRM.',true);
        endCardTransition();return;
      }
      if (!controller) { setBusy(false); endCardTransition();return; }
      setBusy(true, 'Загружаем форму ' + BASE_LABELS[base] + ' CRM. Дату и время уже можно выбрать.'); updateClock();
      let initialDuplicate = null, restoredOperation = null;
      try {
        // Portable manual switches intentionally replace the destination draft;
        // a disk read cannot contribute any fields to this explicit transfer.
        let saved=null;
        if(!seedDraft){
          const loadingKey=state.key;
          // A quick A → B → A switch can return before A's disk write completes.
          // Restore only after this panel's queued snapshots for A have settled.
          let queued;
          while((queued=writeQueues.get(loadingKey))){
            await queued.catch(()=>{});
            if(generation!==state.generation)return;
          }
          saved=await storage.get(loadingKey);
        }
        if (generation !== state.generation) return;
        if(saved?.record && (saved.record.verified!==true || saved.record.base!==base || namedId && text(saved.record.id)!==namedId || !namedRecordOwned(saved.record,context)))saved=null;
        if (saved && saved.version === 1) { state.draft = editableDraft({...initialDraft(context, base), ...saved.draft, base}); state.record = saved.record || null; state.recordOrigin = saved.recordOrigin || ''; state.lookupDraft = editableDraft(saved.lookupDraft) || null; state.skipAutoOpenPhone = saved.skipAutoOpenPhone || ''; state.operation = restorableOperation(saved.operation); restoredOperation=state.operation; state.touched = new Set(saved.touched || []); }
        if(seedDraft){state.draft=editableDraft({...initialDraft(context,base),...seedDraft,base});state.record=null;state.recordOrigin='';state.operation=null;state.lookupDraft=null;state.touched=new Set(transfer?.touched || []);}
        if(!state.record && !state.draft.existingRequestId && saved?.draft && !saved.draft.addressEntryPolicy){
          for(const name of ['street','house','apartment','settlement','entrance','floor'])if(!state.touched.has(name))state.draft[name]='';
          state.draft.addressConfirmed=false;state.draft.addressProof=null;state.draft.mapPin=null;state.draft.addressEntryPolicy='manual-only';
        }
        if(preloadedRecord?.verified===true && preloadedRecord.base===base && text(preloadedRecord.id)===text(context.namedRequestId)) {
          state.record=preloadedRecord;state.recordOrigin='lookup';
          if(!state.operation || !['update','reschedule'].includes(state.operation.kind) || text(state.operation.id)!==text(preloadedRecord.id))state.operation=null;
        }
        if(!state.record && !state.operation){if(!state.touched.has('flag:farRide'))state.draft.farRide=null;if(!state.touched.has('intercom'))state.draft.intercom='';}
        if(!transfer)state.draft.extraPhoneExpanded=false;
        let cachedMetadata=seedDraft?controller.getCachedMetadata?.(metadataInput(base)):(saved?.metadata || (state.record?.form?state.record:null));
        if(seedDraft && cachedMetadata?.form && transfer?.labels.cityId) {
          const city=matchCity(optionsFor('cityId',cachedMetadata),transfer.labels.cityId);
          if(city && cachedMetadata._dependencies && text(cachedMetadata._dependencies.cityId)!==text(city.id)) {
            // Show the known native schema, but do not promote another city's
            // dependent IDs while this city's dropdowns are still being read.
            state.draft.cityId=city.id;state.draft.workId='';state.draft.serviceId='';
            state.dependenciesPending=true;state.dependenciesChangedDuringLoad=true;
            cachedMetadata={...cachedMetadata,works:[],services:[],lists:{...cachedMetadata.lists,workTypes:[],services:[]}};
          }
        }
        if(cachedMetadata?.form && state.record?.verified===true){
          const sameSavedRecord=saved?.record?.verified===true && saved.draft && text(saved.record.id)===text(state.record.id) && saved.record.base===state.record.base && /^\d+$/.test(text(state.record.customerId)) && text(saved.record.customerId)===text(state.record.customerId);
          const restored=sameSavedRecord?structuredCopy(state.draft):null;state.metadata=cachedMetadata;
          renderRecord();if(restored){state.draft=restored;writeDraft(restored);}state.preparing=false;setBusy(false);
        }else if(cachedMetadata?.form){
          state.metadata=cachedMetadata;state.loaded=true;state.preparing=false;renderMetadata(cachedMetadata);setBusy(false);if(!namedId)endCardTransition();
        }else{state.preparing=true;writeDraft(state.draft);setBusy(true);if(!namedId)endCardTransition();}
        updateClock();
        syncContextPhone(true, false);
        if(!state.record && !state.operation && phoneInfo($('phone').value).valid){state.phoneNeedsCheck=true;armPhoneCheck();}
        const metadataReadRevision=recordReadRevision;
        // A fresh verified card may already be editable before optional metadata
        // completes, even when it has never had a persisted local draft.
        const visibleRecordBaseline=state.loaded && state.record?.verified===true?{record:structuredCopy(state.record),draft:draftFromRecord(state.record)}:null;
        let metadata = await controller.getMetadata(metadataInput(base, state.record && state.record.id));
        if(metadataReadRevision!==recordReadRevision || state.operation && state.busy && state.operation!==restoredOperation)return;
        if (generation !== state.generation) return;
        if (!metadata || metadata.ok === false) throw new Error(errorText(metadata));
        cityRoutingReady=true;
        const liveDraftAtRefresh=state.loaded?readDraft():null;
        const operationStatus=typeof controller.getOperationStatus==='function' ? await controller.getOperationStatus({context:contextFor(base),base,kind:state.operation?.kind || (state.record?'update':'create'),id:state.operation?.id || state.record?.id}) : null;
        if(generation!==state.generation)return;
        let durable=operationStatus?.ok===true?operationStatus.operation:null;
        if (durable && durable.state === 'ready' && durable.cycleId && (state.record || state.operation && state.operation.kind === 'create') && (!state.operation || state.operation.kind === 'create') && durable.cycleId !== state.draft.creationCycleId) {
          state.record = null; state.recordOrigin = ''; state.lookupDraft = null; state.operation = null; state.touched = new Set();
          state.draft = {...initialDraft(context, base), creationCycleId: durable.cycleId, needsDefaults: true};
          metadata = await controller.getMetadata(metadataInput(base));
          if (generation !== state.generation) return;
          if (!metadata || metadata.ok === false) throw new Error(errorText(metadata));
          durable = null;
        }
        if (state.record && metadata.record && text(metadata.record.id) === text(state.record.id)) {
          state.record = normalizeRecord({...metadata.record, verified: true, ...(metadata.postSave || state.record.postSave ? {postSave: metadata.postSave || state.record.postSave} : {})}, metadata);
        }
        if (!state.record && !state.operation && metadata.record?.verified === true && metadata.record.base === base && /^\d+$/.test(text(metadata.record.id)) && (!namedId || text(metadata.record.id)===namedId)) {
          state.lookupDraft = structuredCopy(state.draft); state.recordOrigin = 'lookup';
          state.record = normalizeRecord(metadata.record, metadata);
        }
        if (state.record && metadata.postSave) state.record.postSave = metadata.postSave;
        if (durable && acceptedResult(durable.result) && (!state.record || state.operation && state.operation.kind === 'create' && state.operation.operationId === durable.operationId)) {
          const id = durable.result.record.id ?? durable.result.id;
          const current = await controller.getRequest({context: contextFor(base), id});
          if (generation !== state.generation) return;
          if (!acceptedResult(current)) throw new Error(errorText(current && current.error || 'Не удалось прочитать актуальную карточку созданной заявки.'));
          state.record = normalizeRecord({...current.record, id: current.record.id ?? current.id, verified: true,
            ...(durable.result.fieldDifferences?.length ? {fieldDifferences:durable.result.fieldDifferences} : {})}, metadata); state.operation = null;
        } else if (durable && !acceptedResult(durable.result) && !['ready', 'rejected', 'not_sent', 'not_created'].includes(durable.result && durable.result.state || durable.state)) {
          state.operation = {...(state.operation?.operationId===durable.operationId?state.operation:{}),...durable.result,operationId:durable.operationId,kind:durable.kind || 'create',id:durable.recordId || durable.id || '',state:durable.state || 'uncertain',candidates:durable.result?.candidates || []};
        }
        if (durable && durable.cycleId) state.draft.creationCycleId = durable.cycleId;
        // Keep an unresolved write bound to its original operation across reloads.
        // A new key cannot prove that the earlier server write did not happen.
        restoredOperation=state.operation;
        if ((!saved || state.draft.needsDefaults) && metadata.defaults) {
          for (const name of DRAFT_FIELDS) if (name !== 'base' && (state.draft[name] === '' || state.draft[name] === undefined) && metadata.defaults[name] !== undefined) state.draft[name] = metadata.defaults[name];
          state.draft.comments = appendUniqueLines(state.draft.comments, [metadata.defaults.comments]);
          state.draft.commentsService = appendUniqueLines(state.draft.commentsService, [metadata.defaults.commentsService]);
          state.draft.partnerComment = state.draft.partnerComment || metadata.defaults.partnerComment || metadata.defaults.sourceCode || '';
          if (metadata.defaults.cityTimeZone) state.context.cityTimeZone = metadata.defaults.cityTimeZone;
          delete state.draft.needsDefaults;
        }
        if (!state.record && !state.operation) {
          if (!state.touched.has('clientName')) state.draft.clientName = clientFirstName(state.context.clientName || metadata.defaults && metadata.defaults.clientName || state.draft.clientName);
          if (!state.touched.has('comments') && state.context.profileComment) {
            const legacy = text(state.context.masterComment).trim();
            state.draft.comments = appendUniqueLines(text(state.draft.comments).split(/\r?\n/).filter(line => !legacy || line.trim() !== legacy).join('\n'), [state.context.profileComment]);
          }
        }
        if(!state.record && !state.operation){state.draft.comments=win.LeadPartnerRules.withFreeVisit(state.draft.comments,state.context.messages);state.draft.commentsService=win.LeadPartnerRules.serviceComment(state.draft.commentsService,state.context.dialogUrl || state.context.conversationUrl);}
        if(state.record)state.metadata=metadata;else renderMetadata(metadata);state.loaded = true;
        if (!state.record && !state.operation) {
          const updatedPhone = syncContextPhone(true);
          const phone=phoneInfo($('phone').value);
          // prepare() only resolves the customer; an empty customer lookup is not a request search.
          if(!updatedPhone && phone.valid && (!['pending','checked','incomplete'].includes(state.phoneCheck) || state.checkedPhone!==phone.canonical))queuePhoneCheck();
          if (!phoneInfo($('phone').value).valid) showPhoneValidation();
        }
        if (state.record && state.record.id && state.record.verified === true) {
          const previousRecord=visibleRecordBaseline?.record || saved?.record,localDraft=liveDraftAtRefresh || saved?.draft;
          const sameRecord=previousRecord?.verified===true && text(previousRecord.id)===text(state.record.id) && previousRecord.base===state.record.base && /^\d+$/.test(text(state.record.customerId)) && text(previousRecord.customerId)===text(state.record.customerId);
          const restoredDraft = sameRecord && localDraft ? mergeRefreshedDraft(visibleRecordBaseline?.draft || draftFromRecord(previousRecord),localDraft,draftFromRecord(state.record)) : null;
          state.draft = draftFromRecord(state.record); state.mode = 'created'; renderRecord();
          if (restoredDraft) { restoredDraft.extraPhoneExpanded=false;state.draft = restoredDraft; writeDraft(restoredDraft); $('edit-time-reason').value = restoredDraft.reason || ''; }
          notice('');
        }
        else if (state.duplicateMatches.length) notice('Найдена последняя заявка в CRM.', false);
        else notice('Проверьте данные и создайте заявку одним нажатием.');
        if (state.operation) showRecovery();
        void persist().catch(()=>{});
      } catch (error) { if (generation === state.generation) {
        if(!state.metadata?.form)state.loaded = false;
        showError(errorText(error));
        if (state.operation) showRecovery();
        else if (base && /^[1-9]\d{3,11}$/.test(text(state.context?.namedRequestId))) {
          // Even when CRM metadata cannot be loaded, an ID already written in
          // the client's name is enough to offer a NAVIGATION link, not editing.
          showNamedHint(text(state.context.namedRequestId), 'Карточку не удалось прочитать автоматически. Перейдите к указанному номеру в CRM.');
          showError('');
        } else notice('Форма CRM не готова. Создание недоступно.', true);
        $('retry-load').hidden = true;
      } }
      finally { if (generation === state.generation) { state.preparing = false; setBusy(state.operation && state.operation!==restoredOperation || openingRecord?state.busy:false); endCardTransition();renderMode();showRecovery(); updateClock(); if (state.loaded && state.dependenciesChangedDuringLoad) { state.dependenciesChangedDuringLoad = false; dependencies(); } } }
      if (generation === state.generation && state.autoReloadRequested && !state.record && !state.operation && state.mode === 'create') { await loadContext(state.context, state.draft.base); return; }
      // A previous version may have left a confirmed new record ID in an
      // uncertain journal after a comment-save or read error. One GET-only
      // reconciliation on reopening is safe; NEVER repeat the create POST.
      const recoveryId = text(state.operation?.operationId);
      if (generation === state.generation && state.loaded && !state.busy && (!state.record || state.operation?.kind!=='create') &&
          ['create','update','reschedule'].includes(state.operation?.kind) && /^\d+$/.test(text(state.operation.id)) &&
          recoveryId && !attemptedSafeRecovery.has(recoveryId) && controller?.reconcile) {
        attemptedSafeRecovery.add(recoveryId);
        await recover(undefined, true);
      }
      if (generation === state.generation && state.operation?.state === 'awaiting_reason' && ['cancel_kc','cancel_branch','not_taken'].includes(state.operation.action)) await resumeAutomaticCancellation();
      if (generation === state.generation && !namedLookupAttempted && !state.record && !state.operation && state.context.namedRequestId && !state.context.ignoreNamedRequest && !state.draft?.existingRequestId) await openNamedRequest();
      if(generation===state.generation && state.record && !state.operation && (!preloadedRecord || preloadedRecord.cachedView===true)) void refreshRecord({quiet:true});
      // Verified records use the same native editor as new requests.
    }
    function renderMode() {
      const existing=!!state.record?.id;
      const createActions=!existing && state.mode==='create';
      const editActions=existing && !['reschedule','matches'].includes(state.mode);
      $('new-request').hidden = true;
      $('create-request').hidden = !createActions;
      $('create-clarification').hidden = !createActions;
      $('save-request').hidden = !editActions;
      $('set-waiting').hidden = !clarificationRecord();
      $('edit-footer').classList.toggle('has-waiting',clarificationRecord());
      $('base-choice-help').hidden = BASES.includes(state.draft?.base);
      const created = state.mode === 'reschedule';
      const matchesOnly = state.mode === 'matches' && state.duplicateMatches.length > 0;
      doc.body.classList.toggle('creation-success', false);
      doc.body.classList.toggle('named-existing', false);
      doc.body.classList.toggle('record-editor',existing);
      doc.body.dataset.base=state.draft?.base || '';
      $('record-toolbar').hidden=!existing;
      renderRecordDetails(existing ? state.record : null);
      $('panel-title').closest('.panel-header').hidden=existing;
      doc.body.classList.toggle('matches-only', matchesOnly);
      $('request-form').hidden = created || matchesOnly; $('created-view').hidden = true;
      $('duplicates').hidden = true;
      renderBaseReason();
      $('create-footer').hidden = !createActions; $('edit-footer').hidden = !editActions; $('reschedule-form').hidden = state.mode !== 'reschedule';
      doc.body.classList.toggle('has-panel-actions',createActions || editActions);
      $('panel-title').textContent = existing ? 'Заявка №'+state.record.id : matchesOnly ? 'Последняя заявка' : 'Новая заявка';
      $('base').disabled = state.busy || !!state.operation;
      $('kp-only-row').hidden = state.draft?.base !== 'kp';
      for(const tools of doc.querySelectorAll('.chat-tools')) tools.hidden=!existing;
      for (const button of doc.querySelectorAll('.base-option[data-base]')) { const active = button.dataset.base === state.draft?.base; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = state.busy || !!state.operation; }
      syncTypeButtons(); renderFlags();
      for(const button of doc.querySelectorAll('[data-type="repeat"],[data-type="warranty"]'))button.hidden=!existing && !state.draft?.existingRequestId;
      $('create-request').textContent = 'Создать заявку в ' + (BASE_LABELS[state.draft && state.draft.base] || 'CRM') + ' ↗';
      $('footer-title').textContent = 'Одна заявка в ' + (BASE_LABELS[state.draft && state.draft.base] || 'выбранной базе');
      renderAutomaticSource();
      applyNativeAccess();renderNativeActions();
      const contextKey=state.context ? [state.context.scope?.key,state.context.conversationId || state.context.chatId,state.context.client?.id].join('|') : '';
      revealPanel([contextKey,state.draft?.base,state.record?.id,state.record?.revision,state.mode].join('|'));
      if(!cardTransitionPending){post('leadchat-request-layout',{placement:existing || matchesOnly ? 'existing' : 'create',contextKey});
      if(existing && state.record.verified===true)post('leadchat-request-record',{base:state.record.base,id:state.record.id,contextKey});}
      syncVisitReason();
    }
    function renderNativeActions() {
      const container=$('native-record-actions');container.replaceChildren();
      const record=state.record,locked=recordLocked();
      $('record-lock-label').hidden=!locked;
      if(record) {
        const link=$('record-heading-link'),number=doc.createElement('span');number.id='record-heading-id';number.textContent=record.id;link.replaceChildren(doc.createTextNode('№'),number,doc.createTextNode(' · '+(BASE_LABELS[record.base] || 'CRM')));
        const url=requestCardUrl(record.base,record.id);if(url)link.href=url;else link.removeAttribute('href');
        const badge=$('native-record-status');badge.textContent=text(record.statusLabel || record.status || 'Статус CRM');
        const clarification=/^на\s+уточнени[еи](?:\s|$)/iu.test(text(record.statusLabel || record.status).trim());
        badge.style.backgroundColor=clarification ? '#d9534f' : /^#[\da-f]{3,8}$/i.test(record.statusColor || '') ? record.statusColor : '';
        badge.style.color=badge.style.backgroundColor?'#fff':'';
        for(const [key,label] of [['cancel_kc','Отмена КЦ'],['cancel_branch','Отмена Филиала'],['not_taken','НФ']]) {
          const action=nativeAction(key);
          const button=doc.createElement('button');button.type='button';button.className='button secondary native-action';
          button.textContent=label;button.dataset.nativeAction=key;
          button.classList.toggle('cancel-action',key==='cancel_kc'||key==='cancel_branch');
          button.disabled=!action || action.enabled!==true || !['submit','comments-only','link','comment'].includes(action.type) || state.busy || !!state.operation || locked && key!=='not_taken';
          button.addEventListener('click',event=>{if(!event.isTrusted||button.disabled)return;void prepareCancellation(event,key);});
          container.append(button);
        }
      }
      renderRecordType();
      const restore=RESTORE_ACTIONS.map(nativeAction).find(Boolean);
      $('restore-request').hidden=!record || !win.LeadPartnerRules.cancellationKind(record.statusLabel || record.status);
      $('restore-request').disabled=state.busy || !!state.operation || !restore;
      $('create-claim').hidden=!record || record.hasClaim===true;
      $('create-claim').disabled=state.busy || !!state.operation || !record || typeof controller?.prepareClaim!=='function' || !nativeAction('create_claim');
      const callField=record?.form?.fields?.find(field=>field.name==='CustomerRequest[is_need_call_check]' && field.type==='checkbox');
      const onCall=callField ? callField.checked===true : [true,1,'1'].includes(record?.callCheck ?? record?.canonical?.callCheck ?? record?.form?.values?.['CustomerRequest[is_need_call_check]']);
      $('record-call-indicator').hidden=!record || !onCall;
      const deliveryMode=deliveryModeForRecord(),badge=$('native-record-status'),copyable=!!deliveryCopyText();
      if(copyable){badge.setAttribute('role','button');badge.setAttribute('tabindex','0');badge.title='Копировать ID и телефон по '+(deliveryMode==='sd'?'СД':'ЗПЧ');badge.setAttribute('aria-label',badge.textContent+'. '+badge.title);}else{badge.removeAttribute('role');badge.removeAttribute('tabindex');badge.removeAttribute('title');badge.removeAttribute('aria-label');}
      $('record-followup').hidden=!record;$('record-followup').disabled=state.busy || !!state.operation || !record;
      if(!record || claimTarget!==state.key+'|'+record.id){$('claim-form').hidden=true;claimTarget='';}
      renderCancellation();
      updateLateness();
    }
    function renderCancellation() {
      $('cancel-form').hidden = true;
    }
    function cancellationSnapshot(operation) {
      return {generation:state.generation,key:state.key,context:structuredCopy(contextFor()),draft:structuredCopy(readDraft()),previousRecord:structuredCopy(state.record),recordOrigin:state.recordOrigin,lookupDraft:state.lookupDraft,skipAutoOpenPhone:state.skipAutoOpenPhone,metadata:state.metadata,operation,kind:'update',touched:[...state.touched]};
    }
    async function resumeAutomaticCancellation() {
      if (state.busy || state.operation?.state !== 'awaiting_reason' || !state.record || !checkedContext()) return;
      const operation = structuredCopy(state.operation), snapshot = cancellationSnapshot(operation);
      const method=operation.action==='not_taken' ? controller?.notTakenRequest : controller?.cancelRequest;
      if(typeof method!=='function')return;
      setBusy(true); showError('');
      try {
        const result = await method({context:snapshot.context,base:snapshot.previousRecord.base,id:operation.id,action:operation.action,operationId:operation.operationId,expectedRevision:snapshot.previousRecord.revision});
        await applyResult(result,snapshot);
      } catch (error) { await applyResult({ok:false,state:'uncertain',writeStarted:true,error:errorText(error)},snapshot); }
      finally { if(snapshot.generation === state.generation) { setBusy(false); renderMode();showRecovery(); } }
    }
    async function prepareCancellation(event, action) {
      if (!event.isTrusted || state.busy || state.operation || !state.record || !nativeAction(action) || recordLocked() && action!=='not_taken' || !checkedContext()) return;
      const method=action==='not_taken' ? controller?.notTakenRequest : controller?.cancelRequest;
      if (typeof method !== 'function') { showError('Действие CRM недоступно. Обновите расширение.'); return; }
      const operation = {id:state.record.id,operationId:uniqueOperation(),kind:'update',action,autoCancel:true,state:'prepared',createdAt:Date.now()}, snapshot = cancellationSnapshot(operation);
      state.draft = snapshot.draft; state.operation = operation; setBusy(true); showError(''); $('cancel-comment').value = '';
      let dispatched = false;
      try {
        clearTimeout(saveTimer); void persist().catch(()=>{}); if (snapshot.generation !== state.generation || snapshot.key !== state.key) { await persist({...snapshot, record:snapshot.previousRecord, operation:null}); return; } dispatched = true;
        const result = await method({context:snapshot.context,base:snapshot.previousRecord.base,id:operation.id,action,operationId:operation.operationId,expectedRevision:snapshot.previousRecord.revision});
        await applyResult(result,snapshot);
      } catch (error) {
        await applyResult({ok:false,state:dispatched?'uncertain':'rejected',writeStarted:dispatched,safeToRetry:!dispatched,error:errorText(error)},snapshot);
      } finally { if (snapshot.generation === state.generation) { setBusy(false); renderMode();showRecovery(); } }
    }
    const FLAG_NAMES = Object.freeze({farRide: 'CustomerRequest[is_far_ride]', callBeforeVisit: 'CustomerRequest[is_need_call_before_visit]', callCheck: 'CustomerRequest[is_need_call_check]', urgent: 'CustomerRequest[is_urgent]', zakrep: 'CustomerRequest[is_zakrep]', feedback: 'CustomerRequest[is_req_fback]'});
    const FLAG_HINTS = Object.freeze({farRide: /дальн.{0,18}выезд|is_far_ride/i, callBeforeVisit: /прозвон.{0,20}перед|перед.{0,18}выезд|is_need_call_before_visit/i, callCheck: /^(?!.*перед).*прозвон|is_need_call_check/i, urgent: /срочн|is_urgent/i, zakrep: /закреп|is_zakrep/i, feedback: /отзыв|review|fback/i});
    function flagDescriptor(flag) {
      const candidates = fieldDescriptors().filter(item => {
        const name = item.name || item.key || '';
        return /^(?:Customer|CustomerRequest)\[[^\]]+\]$/.test(name) && !item.disabled && !item.readOnly && (item.type === 'checkbox' || item.type === 'radio' || item.type === 'select-one' || item.type === 'select') && (name === FLAG_NAMES[flag] || FLAG_HINTS[flag]?.test(text(item.label || item.title || '') + ' ' + name));
      });
      const exact = candidates.find(item => (item.name || item.key) === FLAG_NAMES[flag]);
      return exact || (new Set(candidates.map(item => item.name || item.key)).size === 1 ? candidates[0] : null);
    }
    function supportedFlag(name) { return !!flagDescriptor(name); }
    function flagValue(field, checked) {
      if (!checked) return '0';
      // Some native CRM forms expose '0' as the current unchecked value.
      // Never send that value back when the user explicitly turns the flag on.
      if (field.type === 'checkbox') {
        const nativeValue = text(field.value).trim();
        return !nativeValue || /^(?:0|false|off|no|нет)$/i.test(nativeValue) ? '1' : nativeValue;
      }
      if (field.type === 'select' || field.type === 'select-one' || field.type === 'radio') {
        const options = normalizeOptions(field.options);
        return options.find(o => /^(1|да|есть|yes|true|вкл)$/i.test(o.label) || o.id === '1')?.id || '1';
      }
      return text(field.value || '1') || '1';
    }
    function priceRowsForSelection() {
      const base = state.draft?.base || $('base').value;
      const work = optionsFor('workId').find(item => item.id === $('workId').value && !item.disabled)?.label || '';
      if(base==='kp'){
        const fixed=win.LeadChatPriceUI.kpRowsForWork(work);
        if(fixed.length)return fixed;
      }
      const source = ({mnc:win.MNCH_OZVUCHKA,kp:win.KP_OZVUCHKA,bt:win.BT_OZVUCHKA})[base];
      if (!source || typeof source !== 'object') return [];
      const service = optionsFor('serviceId').find(item => item.id === $('serviceId').value && !item.disabled)?.label || '';
      const equivalent = value => text(value).normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ');
      const workKey = work && Object.keys(source).find(item => equivalent(item) === equivalent(work));
      if (!workKey) return [];
      const catalog = source[workKey]?.uslugi || {};
      const serviceKey = service && Object.keys(catalog).find(item => equivalent(item) === equivalent(service));
      const selected = service ? serviceKey ? [[serviceKey,catalog[serviceKey]]] : [] : Object.entries(catalog);
      const isMoscow = win.LeadChatPriceUI.isMoscowCity(cityLabel());
      return selected.flatMap(([group,item])=>(Array.isArray(item?.rows)?item.rows:[]).map(row=>({...row,serviceGroup:group,amount:text(isMoscow && row.priceMsk || row.price).trim()}))).filter(row=>text(row.service).trim() && /\d/u.test(row.amount));
    }
    function priceSelectionReady() {
      return !!state.draft && !state.dependenciesPending && !state.dependenciesError && priceRowsForSelection().length > 0;
    }
    function renderPriceAvailability() {
      const button=$('price-open');
      if(button){button.hidden=!priceSelectionReady();button.disabled=false;}
    }
    function renderServicesHelp(error) {
      const help=$('services-help');
      help.dataset.state=error || state.dependenciesError ? 'error' : state.dependenciesPending ? 'loading' : 'ready';
      if(error){help.textContent='Не удалось загрузить услуги: '+text(error);return;}
      if(state.dependenciesPending){help.textContent='Загружаем виды работ и услуг…';return;}
      if(state.dependenciesError)return;
      const hasServices=optionsFor('serviceId').some(option=>!option.disabled && option.id);
      if(!hasServices && $('workId').value){help.dataset.state='empty';help.textContent='Для выбранного вида работ услуги не предоставлены CRM.';}
      else help.textContent=$('workId').value ? 'Актуальные услуги выбранного вида работ из CRM.' : 'Выберите вид работ, чтобы загрузить услуги.';
    }
    function renderFlags() {
      for (const button of doc.querySelectorAll('[data-flag]')) {
        const flag = button.dataset.flag, supported = supportedFlag(flag);
        if (flag === 'feedback' && supported && state.mode === 'create' && state.draft) state.draft.feedback = true;
        const enabledValue=flag === 'feedback' && state.mode === 'create' && supported || !!state.draft?.[flag];
        const active=button.dataset.value!==undefined ? state.draft?.[flag]!=null && enabledValue === (button.dataset.value==='1') : enabledValue;
        if (button.getAttribute('role') === 'switch') button.setAttribute('aria-checked', String(!!active));
        else button.setAttribute('aria-pressed', String(!!active));
        button.classList.toggle('active', !!active);
        button.disabled = !supported || !state.loaded || state.busy && !state.preparing || !!state.operation || recordLocked() || flag === 'feedback' && state.mode === 'create';
        button.title = !supported ? 'В выбранной базе CRM это поле не подтверждено' : flag === 'feedback' && state.mode === 'create' ? 'Отзыв устанавливается автоматически' : '';
      }
      const price = fieldDescriptors().find(item=>/\[price_status(?:es)?\](?:\[\])?$/.test(item.name || item.key || '') && item.options?.length && item.type!=='hidden');
      const select=$('price-status');$('price-status-label').hidden=!price;
      if(price) {
        select.replaceChildren();select.multiple=!!price.multiple;select.size=1;
        for(const item of normalizeOptions(price.options)){const option=doc.createElement('option');option.value=item.id;option.textContent=item.label;option.disabled=!!item.disabled;select.append(option);}
        select.dataset.field=price.name || price.key;
        const current=state.draft?.extraFields?.[select.dataset.field] ?? state.metadata?.form?.values?.[select.dataset.field] ?? price.value;
        if(select.multiple)for(const option of select.options)option.selected=(Array.isArray(current)?current:[current]).map(text).includes(option.value);else select.value=text(current);
        select.disabled=!!price.disabled || !!price.readOnly || recordLocked() || state.busy || !!state.operation;
      }else{select.disabled=true;delete select.dataset.field;}
      renderPriceAvailability();
      renderVisitHistory();
      $('speechPrice').disabled=true;
      const preview = $('partner-note-preview'); if (preview) preview.value = state.mode === 'create' ? 'Источник добавится после сохранения заявки' : $('partnerComment').value || '';
      for(const button of doc.querySelectorAll('[data-intercom]')){const value=boolishOptionId(Array.from($('intercom').options).map(item=>({id:item.value,label:item.textContent})),button.dataset.intercom);const active=value!=='' && value===$('intercom').value;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);button.disabled=$('intercom').disabled || state.busy || recordLocked();}
    }
    function renderVisitHistory() {
      const box = $('visit-history'), list = $('visit-history-list');
      if (!box || !list) return;
      const lines = ['edit', 'created'].includes(state.mode) && state.record?.verified === true
        ? nativeVisitHistory(state.record).split(/\r\n?|\n/).filter(line => line.trim()) : [];
      const field=descriptorFor('visitHistory'),editable=['edit','created'].includes(state.mode) && state.record?.verified===true && !recordLocked() && !!field && !field.disabled && !field.readOnly;
      $('visitHistory').hidden=!editable;list.hidden=editable;
      box.hidden = !lines.length && !editable;
      box.closest('.price-history-row')?.classList.toggle('has-visit-history', !box.hidden);
      const key = JSON.stringify([state.record?.base, state.record?.id, lines]);
      if (key === renderedVisitHistory) return;
      renderedVisitHistory = key;
      list.replaceChildren();
      for (const line of lines) {
        const row = doc.createElement('div');
        row.className = 'visit-history-entry'; row.setAttribute('role', 'listitem');
        row.textContent = line; row.title = line; list.appendChild(row);
      }
    }
    function syncTypeButtons() {
      const list = optionsFor('requestType');
      for (const button of doc.querySelectorAll('[data-type]')) {
        const regex = button.dataset.type === 'warranty' ? /гарант/i : button.dataset.type === 'repeat' ? /повтор/i : /вперв|первич/i;
        const option = list.find(item => regex.test(item.label) || item.id === button.dataset.type);
        button.classList.toggle('active', !!option && option.id === $('requestType').value);
        button.setAttribute('aria-pressed', String(!!option && option.id === $('requestType').value));
        button.disabled = state.busy || !option;
      }
    }
    function updateScale() {
      const visitTime = $('clock-visit-time'); if (visitTime) visitTime.textContent = $('time').value || '—';
      const visitDate = $('clock-visit-date'); if (visitDate) { const d = $('date').value; visitDate.textContent = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8) + '.' + d.slice(5,7) + '.' + d.slice(2,4) : '—'; }
      const minutes = timeToMinutes($('time').value);
      $('time-scale').value = Number.isFinite(minutes) ? Math.max(540, Math.min(1350, minutes)) : 720;
      $('time-scale').setAttribute('aria-valuetext', $('time').value || 'Время не выбрано');
      for (const button of $('time-grid').querySelectorAll('[data-time]')) { const selected = button.dataset.time === $('time').value; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
      syncVisitReason();
    }
    function visitChanged() {
      return state.mode==='edit' && !!state.record && !recordLocked() && state.record.capabilities?.reschedule===true
        && ($('date').value!==text(state.record.date) || $('time').value!==text(state.record.time));
    }
    function closeVisitReason(rollback) {
      const target=visitReasonTarget; visitReasonTarget=null;
      if($('visit-reason-dialog').open)$('visit-reason-dialog').close();
      if(rollback && target && target.key===state.key && target.id===state.record?.id && target.generation===state.generation){
        $('date').value=text(state.record.date);$('time').value=text(state.record.time);$('edit-time-reason').value='';
        if(state.draft)state.draft.reason=''; updateScale(); queueSave();
      }
      if(target?.focus?.isConnected && !target.focus.disabled)target.focus.focus({preventScroll:true});
    }
    function openVisitReason() {
      if(!visitChanged() || state.busy || state.preparing || state.operation || $('visit-reason-dialog').open)return;
      $('time-grid').hidden=true;$('time').setAttribute('aria-expanded','false');datePicker?.close();
      visitReasonTarget={key:state.key,id:state.record.id,generation:state.generation,focus:doc.activeElement};
      $('visit-reason-dialog').showModal();
    }
    function syncVisitReason() {
      const changed=visitChanged();
      $('edit-time-reason-label').hidden=true;$('edit-time-reason').required=changed;
      $('date').classList.toggle('visit-changed',changed && $('date').value!==text(state.record?.date));
      $('time').classList.toggle('visit-changed',changed && $('time').value!==text(state.record?.time));
      if(!changed){$('edit-time-reason').value='';if(state.draft)state.draft.reason='';closeVisitReason(false);}
      else if(!['Клиент','Диспетчер','Директор'].includes($('edit-time-reason').value))openVisitReason();
    }
    function cityLabel() { const option = optionsFor('cityId').find(option => option.id === $('cityId').value); return option && option.label || text(state.context && (state.context.cityLabel || state.context.cityName || state.context.city)); }
    function updateLateness() {
      const record = state.record, savedCity = optionsFor('cityId').find(option => option.id === text(record?.cityId));
      const zone = savedCity && (savedCity.timeZone || savedCity.timezone || savedCity.tz || cityTimeZone(savedCity.label))
        || record && text(record.cityId) === $('cityId').value && state.clockZone || '';
      const minutes = overdueMinutes(record, zone), badge = $('record-lateness');
      badge.hidden = minutes < 10;
      const label = minutes >= 10 ? latenessText(minutes) : '';
      if (badge.textContent !== label) badge.textContent = label;
      $('city-clock').classList.toggle('is-overdue', minutes >= 10);
    }
    function updateClock() {
      const city = optionsFor('cityId').find(option => option.id === $('cityId').value);
      const noticeSource = [state.metadata, state.record].find(source => source && source.base === state.draft?.base && !!source.cityNoticeCityId && text(source.cityNoticeCityId) === $('cityId').value);
      const cityNotice = text(noticeSource?.cityNotice).trim();
      $('city-notice').textContent = cityNotice;
      $('city-notice').hidden = !cityNotice;
      const originalCity = text(state.context && (state.context.cityLabel || state.context.cityName || state.context.city));
      const contextMatches = !!city && (state.context?.cityId ? text(state.context.cityId) === $('cityId').value : cityKey(city.label) === cityKey(originalCity));
      // The static CRM city catalog has ids and names but no time-zone field.
      // Resolve zone from actual selected city, not from the computer's locale.
      state.clockZone = city && (city.timeZone || city.timezone || city.tz) || contextMatches && (state.metadata?.timeZone || state.context?.cityTimeZone || state.context?.timeZone) || city && cityTimeZone(city.label) || '';
      const now = clockParts(state.clockZone);
      $('city-clock').textContent = now ? now.time : '—';
      $('clock-date-city').textContent = now ? now.date.slice(8) + '.' + now.date.slice(5,7) + '.' + now.date.slice(2,4) : '—';
      $('city-clock-label').textContent = cityLabel() ? cityLabel() + ' · сейчас' : 'Время города клиента';
      const appointmentLocked = !!state.operation || !!state.record && (recordLocked() || state.record.capabilities?.reschedule !== true);
      $('plus-one').disabled = state.busy && !state.preparing || !now || appointmentLocked; $('plus-two').disabled = state.busy && !state.preparing || !now || appointmentLocked;
      $('city-clock').title = now ? 'Текущее время: ' + state.clockZone : 'Часовой пояс города не подтверждён';
      if (now && state.draft && state.mode === 'create') {
        const proposed = recommendedTime(state.clockZone);
        if (!state.draft.date && !state.touched.has('date')) { state.draft.date = proposed.date; $('date').value = proposed.date; }
        if (!state.draft.time && !state.touched.has('time')) { state.draft.time = proposed.time; $('time').value = proposed.time; }
      }
      updateScale();
      updateLateness();
    }
    function inferWorkFromComment(triggerDependencies, servicesReady) {
      const infer = win.LeadChatCommentWorktype?.suggest;
      if (!infer || !state.metadata || !state.draft || !['create','edit'].includes(state.mode) || state.operation) return false;
      if (state.record && !state.commentInferenceEdited) return false; // Opening a saved record is not an editing intent.
      if (state.touched.has('workId') && !$('workId').value) return false; // An explicitly cleared category is also a manual choice.
      const manualWork = state.touched.has('workId') || state.touched.has('serviceId') ? $('workId').value : '';
      const suggestion = infer({base:state.draft.base, comment:$('comments').value || state.draft.comments,
        workOptions:optionsFor('workId'),serviceOptions:optionsFor('serviceId'),selectedWorkId:manualWork || undefined});
      if (!suggestion) return false; // unknown or ambiguous: leave current selection untouched
      const currentWork = $('workId').value;
      if (manualWork && suggestion.workId !== manualWork) return false;
      const workChanged = currentWork !== suggestion.workId;
      if (workChanged) {
        $('workId').value = suggestion.workId;
        if ($('workId').value !== suggestion.workId) return false;
        state.draft.workId = suggestion.workId;
        if (!state.touched.has('serviceId')) { state.draft.serviceId = ''; $('serviceId').value = ''; }
        state.commentAutoWorkId = suggestion.workId;
        state.commentAutoServiceId = '';
        if (state.preparing) state.dependenciesChangedDuringLoad = true;
        else if (state.dependenciesPending) state.dependencyRefreshAfterComment = true;
        else if (triggerDependencies && state.loaded && !state.busy) void dependencies();
      }
      if ((!state.dependenciesPending || servicesReady) && !workChanged && suggestion.serviceId && !state.touched.has('serviceId') && $('serviceId').value !== suggestion.serviceId) {
        $('serviceId').value = suggestion.serviceId;
        if ($('serviceId').value === suggestion.serviceId) {
          state.draft.serviceId = suggestion.serviceId;
          state.commentAutoServiceId = suggestion.serviceId;
        }
      }
      if (workChanged || state.commentAutoServiceId === suggestion.serviceId && suggestion.serviceId) {
        $('services-help').textContent = 'Тип техники определён по комментарию: ' + suggestion.category + '. Можно изменить вручную.';
        queueSave();
      }
      renderPriceAvailability();
      return workChanged;
    }
    async function dependencies() {
      if (!controller || !controller.getDependencies || !state.loaded || state.busy) return;
      state.draft = readDraft(); const generation = state.generation, revision = ++state.dependencies;
      state.dependenciesPending = true;
      renderServicesHelp(); renderPriceAvailability();
      $('serviceId').disabled = true; $('workId').disabled = true; setCreateDisabled(true); $('save-request').disabled = true;
      try {
        const requested = structuredCopy(state.draft);
        const result = await controller.getDependencies({context: contextFor(), draft: requested});
        if (generation !== state.generation || revision !== state.dependencies) return;
        const current = readDraft();
        if (['base','cityId','workId'].some(name => text(current[name]) !== text(requested[name]))) { state.dependencyRefreshAfterComment = true; return; }
        if (!result || result.ok === false) throw new Error(errorText(result));
        state.metadata = {...state.metadata, ...result, lists: {...state.metadata.lists, ...result.lists}};
        rebindPortableChoices(state.metadata);
        for (const name of ['serviceId', 'workId']) { populate(name, optionsFor(name), name === 'serviceId' ? 'Выберите вид услуг' : 'Выберите вид работ', state.draft[name]); state.draft[name] = $(name).value; }
        inferWorkFromComment(false, true);
        if (!state.record && !state.draft.serviceId && !state.touched.has('serviceId') && state.context?.workTitle) {
          const parts = text(state.context.workTitle).split(/\s*[/|]\s*/).map(cityKey).filter(Boolean);
          const matches = optionsFor('serviceId').filter(item => parts.includes(cityKey(item.label)));
          if (matches.length === 1) { state.draft.serviceId = matches[0].id; $('serviceId').value = matches[0].id; }
        }
        const serviceFieldName = state.metadata.fieldNames && state.metadata.fieldNames.service || result.serviceField;
        $('serviceId').required = !!serviceFieldName && optionsFor('serviceId').some(option => !option.disabled);
        $('serviceId').closest('label').hidden = !serviceFieldName;
        if (state.dependenciesError) showError('');
        state.dependenciesError = false; $('retry-load').hidden = true;
        renderServicesHelp();
        queueSave();
      } catch (error) { if (generation === state.generation && revision === state.dependencies) { state.dependenciesError = true; renderServicesHelp(errorText(error)); $('retry-load').hidden = true; } }
      finally { if (generation === state.generation && revision === state.dependencies) { state.dependenciesPending = false; renderServicesHelp(); renderPriceAvailability(); $('serviceId').disabled = false; $('workId').disabled = false; setBusy(state.busy); updateClock(); if (state.dependencyRefreshAfterComment && !state.busy) { state.dependencyRefreshAfterComment = false; void dependencies(); } } }
    }
    function renderDuplicates(matches,incomplete){
      const list=$('duplicates');list.replaceChildren();list.hidden=true;
      const phone=phoneInfo($('phone').value);if(!phone.valid){state.duplicateMatches=[];list.hidden=true;showPhoneValidation();return;}
      const rows=Array.isArray(matches)?matches:matches?.matches || matches?.found || [],seen=new Set();
      const verified=rows.filter(row=>{const base=BASES.includes(row.base)?row.base:state.draft.base,id=text(row.id || row.number),k=base+':'+id;if(!BASES.includes(base)||!/^\d+$/.test(id)||seen.has(k))return false;seen.add(k);return true;});
      const order=[state.draft.base,...BASES.filter(base=>base!==state.draft.base)];
      const latest=order.map(base=>latestMatch(verified.filter(row=>(row.base || state.draft.base)===base))).filter(Boolean);
      state.duplicateMatches=latest;state.checkedPhone=phone.canonical;state.phoneCheck=incomplete?'incomplete':'checked';
      if(state.mode==='matches')state.mode='create';
      renderMode();$('phone-status').textContent='';
      if(!state.context?.ignoreNamedRequest && /^[1-9]\d{3,11}$/.test(text(state.context?.namedRequestId)))return;
      const row=latest.find(item=>(item.base || state.draft.base)===state.draft.base);
      if(!row || state.record || state.operation || state.draft.allowDuplicate===true || state.draft.existingRequestId || state.mode!=='create' || state.busy && !state.preparing)return;
      const target=[state.generation,state.key,state.phoneRevision,phone.canonical,row.base || state.draft.base,row.id || row.number].join('|');
      if(autoOpenTarget===target)return;autoOpenTarget=target;
      void openExisting({...row,base:state.draft.base,id:text(row.id || row.number)});
    }
    function showNamedHint(id, message) {
      // An unreadable name hint must not replace the editor with an empty wall.
      // It grants no access to a customer record; retain the actual read error.
      state.duplicateMatches=[];state.mode='create';
      $('duplicates').replaceChildren();$('duplicates').hidden=true;renderMode();
      showError(message || 'Не удалось прочитать заявку №'+id+' из CRM.');
    }
    async function openNamedRequest() {
      const id = text(state.context?.namedRequestId);
      if (!/^[1-9]\d{3,11}$/.test(id) || state.context?.ignoreNamedRequest || state.record || state.operation || !state.loaded || !checkedContext()) return;
      const generation = state.generation, key = state.key, base = state.draft.base;
      $('fact-existing').textContent = 'Проверяем заявку №' + id + ' в CRM…';
      try {
        const result = await controller.getRequest({context:{...contextFor(base),base:''}, id, base:''});
        if (generation !== state.generation || key !== state.key || state.record || state.operation) return;
        if (!acceptedResult(result) || text(result.record.id) !== id || !BASES.includes(result.record.base)) throw Error(result?.error ? errorText(result) : 'Карточка с этим номером не подтверждена в CRM.');
        const record = normalizeRecord({...result.record,verified:true}, state.metadata);
        if(record.base!==base){await loadContext(state.context,record.base,result.record);return;}
        state.lookupDraft = structuredCopy(state.draft); state.recordOrigin = 'lookup'; state.record = record; state.draft.base=record.base;state.key=scopeKey(state.context,record.base);state.mode = 'created';
        $('followup-choices').hidden = false;
        $('fact-existing').textContent = 'Заявка №' + id + ' · подтверждена CRM';
        renderRecord(); await persist();
        notice('Заявка №' + id + ' из имени клиента найдена в CRM. Откройте редактирование или перенос прямо здесь.');
      } catch (error) {
        if (generation === state.generation && key === state.key) {
          $('fact-existing').textContent = 'В имени №' + id + ' · проверка не удалась';
          showNamedHint(id, errorText(error));
        }
      } finally { if (generation === state.generation) { setBusy(false); renderMode(); } }
    }
    async function findRequestById(value,{signal}={}){
      const id=text(value).trim();
      if(!/^[1-9]\d{0,19}$/.test(id))return {ok:false,error:'Введите номер заявки цифрами.'};
      if(destroyed || !checkedContext() || state.busy || state.operation || typeof controller?.getRequest!=='function')return {ok:false,error:'Дождитесь загрузки текущей заявки.'};
      const generation=state.generation,key=state.key,revision=recordReadRevision,originalContext=structuredCopy(state.context),before=readDraft(),lookupDraft=state.record?null:structuredCopy(before);
      const fingerprint=draft=>JSON.stringify([[...DRAFT_FIELDS,...Object.keys(FLAG_NAMES)].map(name=>draft[name]),Object.entries(draft.extraFields || {}).sort(([a],[b])=>a.localeCompare(b))]);
      const originalFields=fingerprint(before),current=()=>!signal?.aborted && !destroyed && generation===state.generation && key===state.key && revision===recordReadRevision && !state.busy && !state.operation && fingerprint(readDraft())===originalFields;
      const ownPhones=new Set([before.phone,originalContext.phone,originalContext.client?.phone,...(Array.isArray(state.record?.phones)?state.record.phones:[]),state.record?.phone].map(phone=>phoneInfo(phone).canonical).filter(Boolean));
      const dialog=text(originalContext.dialogUrl || originalContext.conversationUrl).trim();
      if(!current())return {ok:false,error:'Поиск отменён.'};
      try{
        const result=await controller.getRequest({context:{...contextFor(),base:''},id,base:''});
        if(!current())return {ok:false,error:'Диалог или данные формы изменились. Повторите поиск.'};
        if(!acceptedResult(result) || text(result.record.id)!==id || !BASES.includes(result.record.base))return {ok:false,error:errorText(result?.error || 'CRM не подтвердила точную карточку с этим номером.')};
        const record=normalizeRecord({...result.record,verified:true},state.metadata),phones=Array.isArray(record.phones)?record.phones:[record.phone];
        const phoneVerified=phones.some(phone=>ownPhones.has(phoneInfo(phone).canonical));
        const linkVerified=!!dialog && text(record.commentsService).split(/\r?\n/).some(line=>line.trim()===dialog);
        if(!phoneVerified && !linkVerified)return {ok:false,error:'Заявка относится к другому клиенту.',url:requestCardUrl(record.base,id)};
        if(!record.form || !Array.isArray(record.form.fields))return {ok:false,error:'CRM не передала полную карточку заявки.',url:requestCardUrl(record.base,id)};
        if(!current())return {ok:false,error:'Поиск отменён.'};
        // getRequest already returned the complete verified native form. Commit
        // that view in one synchronous step, as openExisting does. Awaiting a
        // second metadata load after publishing would leave a cancellable finder
        // over a card that had already replaced the caller's draft.
        clearTimeout(saveTimer);saveTimer=null;
        void persist({key:state.key,draft:before,record:state.record,recordOrigin:state.recordOrigin,lookupDraft:state.lookupDraft,skipAutoOpenPhone:state.skipAutoOpenPhone,operation:null,metadata:state.metadata,touched:[...state.touched]}).catch(()=>{});
        ++state.generation;++recordReadRevision;++state.phoneRevision;++state.dependencies;++historyRevision;
        clearTimeout(phoneTimer);phoneTimer=null;clearTimeout(commentInferenceTimer);commentInferenceTimer=null;clearTimeout(streetSplitTimer);streetSplitTimer=null;
        closeVisitReason(false);datePicker?.close();stopPostSave();resetAudio();invalidateAddress(true);
        historyPending='';historyFingerprint='';openingRecord=0;autoOpenTarget='';baseTransfer=null;
        state.context={...originalContext,namedRequestId:id,ignoreNamedRequest:true};state.key=scopeKey(state.context,record.base);
        state.metadata=null;state.record=record;state.recordOrigin='lookup';state.lookupDraft=lookupDraft || state.lookupDraft;state.skipAutoOpenPhone='';
        state.draft={base:record.base,extraFields:{}};state.touched=new Set();state.mode='edit';state.loaded=true;state.preparing=false;state.busy=false;
        state.phoneNeedsCheck=false;state.phoneCheck='idle';state.checkedPhone='';state.duplicateMatches=[];state.autoReloadRequested=false;state.dependenciesChangedDuringLoad=false;state.dependenciesPending=false;state.dependenciesError=false;state.commentInferenceEdited=false;state.commentAutoWorkId='';state.commentAutoServiceId='';state.dependencyRefreshAfterComment=false;
        renderContextFacts(state.context);renderRecord();setBusy(false);showError('');notice('');void persist().catch(()=>{});
        return {ok:true,id,base:record.base};
      }catch(error){return {ok:false,error:signal?.aborted?'Поиск отменён.':errorText(error)};}
    }
    async function openExisting(match) {
      if (state.busy && !state.preparing || openingRecord || state.operation || state.record || !controller || !controller.getRequest || !checkedContext()) return;
      const id = text(match.id || match.number), generation = state.generation, revision = state.phoneRevision, key = state.key, phone = phoneInfo($('phone').value).canonical, base = BASES.includes(match.base) ? match.base : state.draft.base;
      if (!/^\d+$/.test(id) || !phone) return;
      const originalDraft = structuredCopy(readDraft()),openRevision=++recordReadRevision;openingRecord=openRevision;state.preparing=false;
      let baselineRecord=null,baselineDraft='',pendingRefresh=null;
      const applyRefresh=result=>{
        if(!baselineRecord){pendingRefresh=result;return;}
        if(!acceptedResult(result) || generation!==state.generation || key!==state.key || revision!==state.phoneRevision || openRevision!==recordReadRevision ||
          state.busy || state.operation || state.record!==baselineRecord || text(result.record.id)!==id || result.record.base!==base || JSON.stringify(readDraft())!==baselineDraft)return;
        const next=normalizeRecord({...result.record,verified:true},state.metadata);
        if(recordViewFingerprint(next)===recordViewFingerprint(state.record)){state.record=next;baselineRecord=next;return;}
        const local=structuredCopy(readDraft()),previous=draftFromRecord(state.record),fresh=draftFromRecord(next),merged=mergeRefreshedDraft(previous,local,fresh);
        if(['cityId','street','house','settlement'].some(name=>text(state.record[name])!==text(next[name])))invalidateAddress(true);
        state.record=next;renderRecord();state.draft=merged;writeDraft(merged);
        baselineRecord=state.record;baselineDraft=JSON.stringify(readDraft());void persist().catch(()=>{});
      };
      setBusy(true, 'Читаем найденную заявку №' + id + '…'); showError('');
      try {
        const result = await controller.getRequest({context: contextFor(base), base,id, expectedPhone: '7' + phone,fresh:false,onRefresh:applyRefresh});
        if (generation !== state.generation || key !== state.key || revision !== state.phoneRevision || phone !== phoneInfo($('phone').value).canonical || state.operation || state.record) return;
        if (!acceptedResult(result) || text(result.record.id ?? result.id) !== id || result.record.base && result.record.base !== base) throw new Error('CRM не подтвердила точную найденную карточку. Выберите её повторно.');
        const actualRecord = normalizeRecord({...result.record, id, verified: true}, state.metadata);
        const actualPhones = Array.isArray(actualRecord.phones) ? actualRecord.phones : [actualRecord.phone];
        if (!actualPhones.some(value => phoneInfo(value).valid && phoneInfo(value).canonical === phone)) throw new Error('Телефон найденной карточки не совпал с номером клиента. Карточка не открыта; повторите проверку номера.');
        state.lookupDraft = originalDraft; state.recordOrigin = 'lookup';
        state.record = actualRecord;state.draft.base=base;state.key=scopeKey(state.context,base);state.mode = 'created'; renderRecord();
        baselineRecord=state.record;baselineDraft=JSON.stringify(readDraft());
        notice('По номеру найдена заявка в ' + BASE_LABELS[base] + '. Можно редактировать её или выбрать новое обращение.'); void persist().catch(()=>{});
      } catch (error) { if (generation === state.generation && key === state.key) showError(errorText(error)); }
      finally {if(openingRecord===openRevision)openingRecord=0; if (generation === state.generation) { setBusy(false); renderMode();if(pendingRefresh){const pending=pendingRefresh;pendingRefresh=null;applyRefresh(pending);} } }
    }
    function showPhoneValidation() {
      const phone = phoneInfo($('phone').value);
      if (contextPhoneConflict() && !state.touched.has('phone')) { $('phone-status').textContent = ''; $('phone').setAttribute('aria-invalid', 'true'); return; }
      if (phone.valid) { $('phone').removeAttribute('aria-invalid'); return; }
      $('phone-status').textContent = '';
      if (phone.reason === 'too_long' || phone.reason === 'invalid') $('phone').setAttribute('aria-invalid', 'true');
      else $('phone').removeAttribute('aria-invalid');
    }
    function armPhoneCheck() {
      if (!state.phoneNeedsCheck || phoneTimer || state.busy && !state.preparing || !state.loaded && !state.preparing || state.operation || state.record || state.mode !== 'create' || !checkedContext()) return;
      phoneTimer = win.setTimeout(() => { phoneTimer = null; checkPhone(); }, 150);
    }
    function queuePhoneCheck() {
      ++state.phoneRevision; clearTimeout(phoneTimer); phoneTimer = null;
      autoOpenTarget='';
      if (!state.draft.existingRequestId) { state.draft.existingRequestId = ''; state.draft.allowDuplicate = false; } $('duplicates').replaceChildren(); $('duplicates').hidden = true; state.duplicateMatches = []; if (state.mode === 'matches') { state.mode = 'create'; renderMode(); } $('phone-status').textContent = ''; 
      state.phoneNeedsCheck = phoneInfo($('phone').value).valid;
      const phone = phoneInfo($('phone').value); state.phoneCheck = phone.valid ? 'waiting' : 'idle'; state.checkedPhone = ''; state.duplicateMatches = [];
      if (state.skipAutoOpenPhone !== phone.canonical) state.skipAutoOpenPhone = '';
      setBusy(state.busy); $('retry-phone').hidden = true;
      showPhoneValidation(); armPhoneCheck();
    }
    function syncContextPhone(allowBusy, schedule) {
      if(state.record)return syncIncomingExtraPhone(allowBusy);
      if (!state.draft || state.touched.has('phone') || state.record || state.operation || state.mode !== 'create' || state.busy && !allowBusy) return false;
      if (contextPhoneConflict()) {
        const changed = !!state.draft.phone;
        state.draft.phone = ''; $('phone').value = phoneInputDisplay(''); queuePhoneCheck();
        return changed;
      }
      const raw = text(state.context && (state.context.phone || state.context.client && state.context.client.phone)).trim();
      if (!raw) return false;
      const next = phoneInfo(raw), current = phoneInfo(state.draft.phone);
      if (next.valid && current.valid && next.canonical === current.canonical || !next.valid && !current.valid && raw === text(state.draft.phone).trim()) return false;
      state.draft.phone = next.valid ? next.formatted : raw; $('phone').value = phoneInputDisplay(state.draft.phone);
      if (schedule !== false) queuePhoneCheck();
      return true;
    }
    function syncIncomingExtraPhone(allowBusy){
      if(!state.draft || state.record?.verified!==true || recordLocked() || state.operation || state.busy && !allowBusy || !checkedContext() || scopeKey(state.context,state.draft.base)!==state.key || state.record.base!==state.draft.base)return false;
      const candidates=state.context.proposals?.candidates?.phones || [],messages=state.context.messages || [];
      let proposal,message;
      for(const item of [...messages].reverse()){
        if(item.direction!=='in' || item.isInternal || !['client','customer',''].includes(text(item.senderType || item.sender_type)))continue;
        const found=candidates.filter(candidate=>item.id && (candidate.messageId===item.id || candidate.messageIds?.includes(item.id)));
        if(found.length){if(found.length===1){proposal=found[0];message=item;}break;}
      }
      const next=phoneInfo(proposal?.value);if(!next.valid || !message)return false;
      const messageKey=JSON.stringify([message.id,message.body,next.canonical]);if(state.draft.extraPhoneMessageKey===messageKey)return false;
      state.draft=readDraft();state.draft.extraPhoneMessageKey=messageKey;
      const known=[state.draft.phone,...(state.record.phones || []),...Object.entries(state.draft.extraFields || {}).filter(([name])=>isAdditionalPhoneField(name) || name==='Customer[phone]').map(([,value])=>value)];
      if(known.some(value=>phoneInfo(value).canonical===next.canonical))return false;
      const fields=extraPhoneDescriptors(),index=fields.findIndex((field,index)=>{const name=field.name || field.key,input=$('phone-extra-'+(index+1));return name && !field.disabled && !field.readOnly && input && !input.disabled && !state.touched.has(input.id) && !phoneFieldValue(input.value);});
      if(index<0)return false;
      const field=fields[index],input=$('phone-extra-'+(index+1));state.draft.extraFields[field.name || field.key]=next.formatted;input.value=next.formatted;renderExtraPhoneIndicator();
      return true;
    }
    function contextPhoneConflict() { return !!(state.context && (state.context.phoneConflict || state.context.client && state.context.client.phoneConflict)); }
    async function checkPhone() {
      if (!controller || !controller.duplicates || !state.loaded && !state.preparing || state.busy && !state.preparing || state.operation || state.record || state.mode !== 'create' || !checkedContext()) return;
      state.phoneNeedsCheck = false;
      const phone = phoneInfo($('phone').value), generation = state.generation, revision = ++state.phoneRevision, key = state.key, base = state.draft.base;
      if (!state.draft.existingRequestId) { state.draft.existingRequestId = ''; state.draft.allowDuplicate = false; } $('duplicates').hidden = true;
      if (!phone.valid) { showPhoneValidation(); return; }
      state.phoneCheck = 'pending';state.checkedPhone=phone.canonical; $('retry-phone').hidden = true;
      $('phone-status').textContent = '';
      try {
        const current=()=>generation===state.generation && revision===state.phoneRevision && key===state.key && base===state.draft.base && phone.canonical===phoneInfo($('phone').value).canonical && !state.record && (!state.busy || state.preparing) && !state.operation;
        const result = await controller.duplicates({context: contextFor(), phone: phone.full, base,allBases:true,onProgress:partial=>{
          if(!current() || !partial || partial.ok===false)return;
          renderDuplicates(partial.matches || [],partial.complete!==true || !!partial.incomplete);
          setBusy(state.busy);
        }});
        if (generation !== state.generation || revision !== state.phoneRevision || key !== state.key || base !== state.draft.base || phone.canonical !== phoneInfo($('phone').value).canonical || state.record || state.busy && !state.preparing || state.operation || state.mode === 'matches' && state.context?.namedRequestId) return;
        if (result && result.ok === false) throw new Error(errorText(result));
        renderDuplicates(result && (result.matches || result.found) || result || [], !!(result && result.incomplete));
        setBusy(state.busy);
        if (state.phoneCheck === 'incomplete' && !state.duplicateMatches.length) $('retry-phone').hidden = true;

      } catch (error) { if (generation === state.generation && revision === state.phoneRevision && !state.busy && !state.operation) { state.phoneCheck = 'error'; setBusy(state.busy); $('phone-status').textContent = ''; $('retry-phone').hidden = true; } }
    }
    function quietFormValidity(form) {
      const invalid = [...form.querySelectorAll('input,select,textarea')].find(element => !element.disabled && !element.checkValidity());
      if (!invalid) return true;
      invalid.setAttribute('aria-invalid', 'true'); invalid.focus(); return false;
    }
    function validateDraft() {
      for (const element of $('request-form').querySelectorAll('[aria-invalid]')) element.removeAttribute('aria-invalid');
      state.draft = readDraft();
      for(const [name,limit,label]of [['entrance',3,'Подъезд'],['floor',2,'Этаж']])if(!$(name).disabled){$(name).value=state.draft[name];if([...text(state.draft[name])].length>limit){$(name).setAttribute('aria-invalid','true');$(name).focus();throw Error(label+': максимум '+limit+' символа без учёта пробелов.');}}
      if (state.mode === 'create' && !automaticSource().ready) throw new Error(automaticSource().reason);
      const required = [['cityId', 'Выберите город из справочника CRM.'], ['clientName', 'Укажите имя клиента.'], ['phone', 'Укажите телефон клиента.'], ['requestType', 'Выберите тип заявки из CRM.'], ['date', 'Выберите дату визита.'], ['time', 'Выберите время визита.']];
      for (const [name, message] of required) if (!text(state.draft[name]).trim()) { $(name).setAttribute('aria-invalid', 'true'); $(name).focus(); throw new Error(message); }
      const phone = phoneInfo(state.draft.phone);
      for(const [index,extra]of extraPhoneDescriptors().entries()){const extraInput=$('phone-extra-'+(index+1));if(extraInput && !extraInput.disabled && phoneFieldValue(extraInput.value) && !phoneInfo(extraInput.value).valid){
        state.draft.extraPhoneExpanded=true;setExtraPhoneExpanded(true);extraInput.focus();extraInput.setAttribute('aria-invalid','true');throw Error('Введите полный дополнительный телефон: 10 цифр номера или 11 с начальной 7/8.');
      }}
      if (!phone.valid) { $('phone').setAttribute('aria-invalid', 'true'); $('phone').focus(); throw new Error(phone.message || 'Укажите полный номер телефона клиента.'); }
      const minutes = timeToMinutes(state.draft.time);
      const timeUnchanged=state.record && state.draft.time===state.record.time && state.draft.date===state.record.date;
      if (!Number.isFinite(minutes)) { $('time').setAttribute('aria-invalid', 'true'); $('time').focus(); throw new Error('Укажите точное время визита в формате ЧЧ:ММ.'); }
      if(state.mode==='create' && state.draft.base==='kp' && supportedFlag('farRide') && typeof state.draft.farRide!=='boolean')throw Error('Выберите «Да» или «Нет» для дальнего выезда.');
      if (state.draft.age !== '' && (!Number.isInteger(Number(state.draft.age)) || state.draft.age < 1 || state.draft.age > 120)) { $('age').focus(); throw new Error('Возраст должен быть целым числом от 1 до 120.'); }
      for (const element of $('editable-fields').querySelectorAll('input,select,textarea')) if (!element.disabled && !element.checkValidity()) { element.setAttribute('aria-invalid', 'true'); element.focus(); throw new Error('Проверьте обязательные поля формы CRM.'); }
      if (state.mode === 'edit' && state.record && (state.draft.date !== state.record.date || state.draft.time !== state.record.time) && !['Клиент', 'Диспетчер', 'Директор'].includes(state.draft.reason)) { $('edit-time-reason').focus(); throw new Error('Выберите причину изменения времени визита.'); }
      if (!checkedContext()) throw new Error('Не подтверждена привязка к текущему диалогу и сотруднику. Откройте панель заново.');
    }
    function recoveryCrmUrl(id) {
      const base = state.draft?.base;
      if (!BASES.includes(base)) return '';
      const number = text(id).trim();
      // Only a real positive decimal ID may produce a direct record URL.
      // Without one, open CRM's existing request list instead of guessing.
      const direct = requestCardUrl(base, number);
      return direct || safeUrl('https://' + base + '-lead-centre.ru/admin/domain/customer-request/index', 'crm');
    }
    function recoveryLink(id, label) {
      const url = recoveryCrmUrl(id);
      if (!url) return null;
      const link = doc.createElement('a');
      link.className = 'button secondary';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      return link;
    }
    function recoveryTarget() { return state.operation && state.key + '|' + state.operation.operationId; }
    function queueRecovery() {
      const operation = state.operation, target = recoveryTarget();
      const attempts = recoveryAttempts.get(target) || 0, delay = nextRecoveryDelay(attempts);
      if (destroyed || recoveryTimer || recoveryInFlight || !target || operation.state === 'awaiting_reason'
        || !canAutoReconcile(operation) || typeof controller?.reconcile !== 'function' || delay === null) return;
      const generation = state.generation;
      recoveryTimer = win.setTimeout(() => {
        recoveryTimer = null;
        if (destroyed || generation !== state.generation || target !== recoveryTarget()) {queueRecovery();return;}
        if (state.busy) {queueRecovery();return;}
        recoveryAttempts.set(target, (recoveryAttempts.get(target) || 0) + 1);
        void recover(undefined, true);
      }, delay);
    }
    function restorableOperation(operation) {
      if(!operation || !/^[a-zA-Z0-9_-]{8,160}$/.test(text(operation.operationId)) || !['create','update','reschedule'].includes(operation.kind)
        || ['saved','rejected','not_sent','not_created','ready'].includes(operation.state))return null;
      return {...operation,state:operation.state==='awaiting_reason'?'awaiting_reason':'uncertain'};
    }
    function needsRecovery(result) {
      return result?.state==='uncertain' || result?.writeStarted===true && result.safeToRetry!==true
        || !['rejected','not_sent','not_created'].includes(result?.state);
    }
    async function operationFromStatus(snapshot, expectedId) {
      if(typeof controller?.getOperationStatus!=='function')return null;
      try {
        const known=await controller.getOperationStatus({context:snapshot.context,base:snapshot.draft.base,kind:snapshot.kind,id:snapshot.previousRecord?.id || snapshot.operation.id});
        const operation=known?.ok===true?known.operation:null,kind=snapshot.kind==='reschedule'?'update':snapshot.kind;
        if(operation?.operationId!==expectedId || !/^[a-zA-Z0-9_-]{8,160}$/.test(text(expectedId)) || (operation.kind==='reschedule'?'update':operation.kind)!==kind
          || kind==='update' && text(operation.recordId || operation.id)!==text(snapshot.previousRecord?.id || snapshot.operation.id))return null;
        return {...snapshot.operation,...operation,id:operation.recordId || operation.id || snapshot.operation.id,state:operation.state || 'uncertain'};
      }catch(_){return null;}
    }
    function showRecovery() {
      const operation=state.operation, awaitingReason=operation?.state==='awaiting_reason';
      $('recovery').hidden=!operation || awaitingReason;
      $('recovery-text').textContent=operation && !awaitingReason?'Результат сохранения пока не подтверждён. Повторная отправка отключена. Проверьте результат в CRM.':'';
      $('check-result').hidden=!operation || awaitingReason;
      $('check-result').disabled=state.busy || recoveryInFlight;
      if(awaitingReason)renderCancellation();
    }
    function nativeHistoryUrl(row){
      try{const url=new URL(row.url),origin='https://'+row.base+'-lead-centre.ru';return url.origin===origin && !url.username && !url.password && !url.hash && ['/admin/domain/customer-request/update','/admin/domain/customer-request/view'].includes(url.pathname) && url.searchParams.getAll('id').length===1 && url.searchParams.get('id')===text(row.id) && [...url.searchParams.keys()].every(key=>key==='id');}catch(_){return false;}
    }
    function historyKey(record){return state.key+'|history|'+text(record?.base)+'|'+text(record?.customerId)+'|'+text(record?.id);}
    function renderCustomerHistory(record){
      const section=$('record-history-section'),table=$('customer-history');if(!section || !table)return;
      const history=record?.customerHistory,valid=record?.verified===true && history?.base===record.base && text(history.customerId)===text(record.customerId) && /^\d+$/.test(text(record.customerId)) && Array.isArray(history.columns) && Array.isArray(history.rows);
      const rows=valid?history.rows.filter(row=>row.base===record.base && /^\d+$/.test(text(row.id)) && nativeHistoryUrl(row)):[];
      const count=$('customer-history-count');if(count)count.textContent=rows.length?'Показаны записи 1–'+rows.length+' из '+rows.length+'.':'';
      section.hidden=!rows.length;if(!rows.length){table.replaceChildren();historyFingerprint='';return;}
      const fingerprint=JSON.stringify([record.base,record.id,record.customerId,history.columns,rows,state.busy,!!state.operation,historyPending]);if(historyFingerprint===fingerprint)return;historyFingerprint=fingerprint;
      const columns=history.columns.filter(column=>text(column.label).trim()!=='Прозвон');
      const typeColumn=columns.find(column=>/^(?:тип|тип заявки)$/iu.test(text(column.label).trim()));
      table.replaceChildren();const head=doc.createElement('thead'),tr=doc.createElement('tr'),body=doc.createElement('tbody');
      for(const column of columns){const th=doc.createElement('th');th.scope='col';th.textContent=text(column.label);tr.append(th);}head.append(tr);
      for(const row of rows){const line=doc.createElement('tr');line.dataset.historyId=text(row.id);line.dataset.current=String(text(row.id)===text(record.id));
        const typeLabel=text(typeColumn && row.cells?.[typeColumn.key]),requestType=/гарант/iu.test(typeLabel)?'warranty':/повтор/iu.test(typeLabel)?'repeat':/вперв|первич/iu.test(typeLabel)?'first':'';
        columns.forEach(column=>{const cell=doc.createElement('td'),value=text(row.cells?.[column.key]);cell.title=value;
          if(column===history.columns[0]){const button=doc.createElement('button');button.type='button';button.className='history-request-link';button.classList.toggle('has-claim',row.hasClaim===true);if(row.hasClaim===true)button.title='Есть претензия';if(requestType)button.dataset.requestType=requestType;button.textContent=value || text(row.id);button.dataset.historyId=text(row.id);button.dataset.historyBase=row.base;button.disabled=state.busy || !!state.operation || text(row.id)===text(record.id);button.setAttribute('aria-current',text(row.id)===text(record.id)?'page':'false');button.addEventListener('click',event=>{if(event.isTrusted)void switchHistoryRequest(row,history);});cell.append(button);}
          else if(column===typeColumn){const badge=doc.createElement('span');badge.className='history-request-type';if(requestType)badge.dataset.requestType=requestType;badge.textContent=value;cell.append(badge);}
          else cell.textContent=value;line.append(cell);
        });body.append(line);
      }table.append(head,body);
    }
    async function switchHistoryRequest(row,history){
      if(!state.record || state.busy || state.operation || row.base!==state.record.base || text(history.customerId)!==text(state.record.customerId) || !history.rows.includes(row) || typeof controller?.getRequest!=='function')return;
      const generation=state.generation,key=state.key,base=row.base,customerId=text(history.customerId),id=text(row.id),revision=++historyRevision,readRevision=recordReadRevision;
      if(id===text(state.record.id))return;
      const remember=()=>historyDrafts.set(historyKey(state.record),{record:structuredCopy(state.record),draft:structuredCopy(readDraft()),touched:[...state.touched]});
      remember();const targetKey=state.key+'|history|'+base+'|'+customerId+'|'+id,cached=historyDrafts.get(targetKey);
      historyPending=id;showError('');renderCustomerHistory(state.record);
      const publish=(record,local)=>{
        clearTimeout(saveTimer);saveTimer=null;invalidateAddress(true);resetAudio();++recordReadRevision;state.record=normalizeRecord({...record,verified:true},state.metadata);state.recordOrigin='lookup';renderRecord();
        if(local){const merged=mergeRefreshedDraft(draftFromRecord(local.record),local.draft,draftFromRecord(state.record));merged.extraPhoneExpanded=false;state.draft=merged;state.touched=new Set(local.touched || []);writeDraft(merged);$('edit-time-reason').value=merged.reason || '';}
        else state.touched=new Set();
        setBusy(false);renderMode();void persist().catch(()=>{});
        post('leadchat-request-record',{base,id,contextKey:[state.context.scope?.key,state.context.conversationId || state.context.chatId,state.context.client?.id].join('|')});
      };
      if(cached?.record?.verified===true)publish(cached.record,cached);
      const expectedReadRevision=recordReadRevision;
      try{
        const result=await controller.getRequest({context:contextFor(base),base,id,expectedCustomerId:customerId,fresh:false});
        if(generation!==state.generation || key!==state.key || revision!==historyRevision || expectedReadRevision!==recordReadRevision || state.busy || state.operation)return;
        if(!acceptedResult(result) || result.record.base!==base || text(result.record.id)!==id || text(result.record.customerId)!==customerId)throw Error('CRM не подтвердила выбранную заявку этого клиента.');
        if(!cached)remember();
        const local=cached?{record:state.record,draft:readDraft(),touched:[...state.touched]}:historyDrafts.get(targetKey);
        publish(result.record,local);
      }catch(error){if(generation===state.generation && key===state.key && revision===historyRevision)showError(errorText(error));}
      finally{if(generation===state.generation && revision===historyRevision){historyPending='';historyFingerprint='';renderCustomerHistory(state.record);}}
    }
    function resetAudio() {
      for(const player of $('audio-records').querySelectorAll('audio')){player.pause();player.removeAttribute('src');player.load();}
      audioState={target:'',loaded:false,loading:false,error:false};
      $('audio-records').replaceChildren();$('audio-panel').hidden=true;$('audio-toggle').setAttribute('aria-expanded','false');
    }
    function audioTarget() {return state.loaded && checkedContext() && state.record && [state.generation,state.key,state.record.base,state.record.id,text(state.record.customerId)].join('|') || '';}
    function renderRecordDetails(record) {
      if(!state.loaded || !checkedContext())record=null;
      const paid=$('record-payment'),payment=record?.paymentSummary;
      paid.hidden=!(record && /^(?:готов)(?:\s|$)/iu.test(text(record.statusLabel || record.status).trim()) && text(payment?.value).trim());
      paid.textContent=paid.hidden?'':text(payment.label)+': '+text(payment.value);
      const audit=$('record-audit');audit.replaceChildren();
      $('record-audit-section').hidden=true;
      renderCustomerHistory(record);
      const target=audioTarget();if(audioState.target && audioState.target!==target)resetAudio();
      $('audio-section').hidden=!record || record.verified!==true;
      $('audio-toggle').disabled=!record || typeof controller?.getAudioRecords!=='function';
    }
    function renderAudioRecords(result) {
      const box=$('audio-records');box.replaceChildren();
      const records=Array.isArray(result.records)?result.records:[];
      if(!records.length){box.textContent=result.notice || 'Аудиозаписи не найдены.';return;}
      const columns=Array.isArray(result.columns) && result.columns.length?result.columns:[{key:'date',label:'Дата'},{key:'time',label:'Время'},{key:'caller',label:'Кто звонил'},{key:'recipient',label:'Кому звонил'},{key:'phone',label:'Телефон'},{key:'recording',label:'Аудиозапись'}];
      const table=doc.createElement('table'),head=doc.createElement('thead'),body=doc.createElement('tbody'),titles=doc.createElement('tr');
      const audioKey=columns.find(column=>/аудио|запис|audio|record/i.test(column.label+' '+column.key))?.key;
      for(const column of columns){const th=doc.createElement('th');th.scope='col';th.textContent=column.label;if(column.key===audioKey || !audioKey && column===columns[columns.length-1])th.className='audio-recording-cell';titles.append(th);}head.append(titles);
      for(const record of records){
        const tr=doc.createElement('tr');
        for(const column of columns){
          const td=doc.createElement('td');td.dataset.label=column.label;
          const url=safeUrl(record.url,'audio'),recordingCell=column.key===audioKey || !audioKey && column===columns[columns.length-1];
          const value=text(record.cells?.[column.key] ?? record[column.key]);
          td.textContent=url && recordingCell && /(?:браузер.{0,40}не поддерживает|browser.{0,40}(?:not support|doesn't support))/iu.test(value) ? '' : value;
          if(recordingCell)td.className='audio-recording-cell';else if(!value)td.className='audio-empty-cell';
          if(url && recordingCell){
            const player=doc.createElement('audio');player.controls=true;player.preload='none';player.src=url;player.setAttribute('aria-label','Аудиозапись звонка');td.append(player);
          }
          tr.append(td);
        }body.append(tr);
      }
      table.append(head,body);box.append(table);
      if(result.notice){const notice=doc.createElement('p');notice.textContent=result.notice;box.append(notice);}
    }
    $('audio-toggle').addEventListener('click',async event=>{
      if(!event.isTrusted || !state.loaded || !checkedContext() || !state.record || state.record.verified!==true || typeof controller?.getAudioRecords!=='function')return;
      const open=$('audio-panel').hidden;$('audio-panel').hidden=!open;$('audio-toggle').setAttribute('aria-expanded',String(open));
      if(!open){for(const player of $('audio-records').querySelectorAll('audio'))player.pause();return;}
      const target=audioTarget();
      if(audioState.target===target && (audioState.loaded || audioState.loading))return;
      audioState={target,loaded:false,loading:true,error:false};$('audio-records').textContent='Загружаем аудиозаписи…';
      try{
        const result=await controller.getAudioRecords({context:contextFor(),id:state.record.id,base:state.record.base});
        if(target!==audioTarget() || target!==audioState.target)return;
        if(!result || result.ok===false)throw new Error(errorText(result));
        audioState.loaded=true;renderAudioRecords(result);
      }catch(error){if(target===audioTarget() && target===audioState.target){audioState.error=true;$('audio-records').textContent='Не удалось загрузить аудиозаписи: '+errorText(error)+'. Нажмите ещё раз, чтобы повторить.';}}
      finally{if(target===audioTarget() && target===audioState.target)audioState.loading=false;}
    });
    function renderRecord() {
      cityRoutingTask.cancel();
      const record = normalizeRecord(state.record, state.metadata); state.record = record;
      if(record.verified===true)navigationRecord={scope:scopeKey(state.context,'kp'),record:{base:record.base,id:record.id,verified:true}};
      if(record.form)state.metadata={...state.metadata,...record,defaults:state.metadata?.defaults,sources:state.metadata?.sources || []};
      state.commentInferenceEdited=false;state.draft=draftFromRecord(record);state.mode='edit';state.loaded=true;
      renderMetadata(state.metadata);$('edit-time-reason').value='';
      const isCreated = state.recordOrigin === 'created';
      $('created-title').textContent = isCreated ? 'Заявка №' + record.id + ' создана' : 'Заявка №' + record.id;
      $('record-status').textContent = text(record.status || record.statusLabel || 'Статус не передан CRM');
      $('created-state').textContent = isCreated ? (record.sourceCommitted === false || record.fieldDifferences?.some(item => item.name === 'CustomerRequest[partner_comment]'))
          ? 'Заявка создана, но источник не сохранён.' : 'Заявка создана успешно.'
          : state.recordOrigin === 'lookup' ? 'Найдена по телефону · прочитана из CRM'
          : record.fieldDifferences?.length ? 'Заявка существует в CRM · проверьте отмеченные поля' : 'Сохранено и проверено в CRM';
      const open = $('open-crm');
      const recordUrl = requestCardUrl(record.base || state.draft?.base, record.id);
      if (recordUrl) open.href = recordUrl; else open.removeAttribute('href');
      open.hidden = !recordUrl;
      open.textContent = isCreated ? 'Перейти к заявке ↗' : 'Открыть в CRM ↗';
      const summary = $('record-summary'); summary.replaceChildren();
      const labelFor = (name, value) => optionsFor(name, {lists: record.lists}).find(option => option.id === text(value))?.label || optionsFor(name).find(option => option.id === text(value))?.label || text(value);
      const address = [record.street, record.house, record.apartment && 'кв. ' + record.apartment].filter(Boolean).join(', ');
      const rows = [['База', BASE_LABELS[record.base || state.draft.base]], ['Город', record.cityLabel || labelFor('cityId', record.cityId)], ['Адрес', address], ['Клиент', record.clientName], ['Возраст', record.age], ['Телефон', record.phone], ['Тип заявки', record.requestTypeLabel || labelFor('requestType', record.requestType)], ['Вид услуг', record.serviceLabel || labelFor('serviceId', record.serviceId)], ['Вид работ', record.workLabel || labelFor('workId', record.workId)], ['Визит', [record.date, record.time].filter(Boolean).join(' · ')], ['Комментарий', record.comments], ['Служебный', record.commentsService], ['Партнёр', record.partnerLabel || labelFor('partnerId', record.partnerId)], ['Источник', record.partnerComment], ['Сотрудник', record.authorLabel || record.authorName || (typeof record.author === 'string' ? record.author : record.author && record.author.name)]];
      for (const [label, value] of rows) {
        const dt = doc.createElement('dt'); dt.textContent = label; const dd = doc.createElement('dd'); dd.textContent = text(value) || 'Не передано CRM'; if (!text(value)) dd.className = 'empty-value'; summary.append(dt, dd);
      }
      const known = new Set(Object.values(EXACT).flat()); for (const value of Object.values(state.metadata && state.metadata.fieldNames || {})) known.add(value);
      for (const descriptor of fieldDescriptors(record.form ? record : state.metadata)) {
        const name = descriptor.name || descriptor.key;
        if (known.has(name) || !name || isAdditionalPhoneField(name) || descriptor.hidden || ['hidden', 'submit', 'button', 'password'].includes(descriptor.type) || !Object.prototype.hasOwnProperty.call(record.extraFields || {}, name)) continue;
        const dt = doc.createElement('dt'); dt.textContent = descriptor.label || name; const dd = doc.createElement('dd'); const value = record.extraFields[name];
        const showValue = item => normalizeOptions(descriptor.options).find(option => option.id === text(item))?.label || text(item);
        dd.textContent = descriptor.type === 'checkbox' ? value === true || value === 1 || value === '1' ? 'Да' : 'Нет' : Array.isArray(value) ? value.map(showValue).join(', ') || 'Не указано' : showValue(value) || 'Не указано'; summary.append(dt, dd);
      }
      for (const id of ['record-verification','telegram-state']) { $(id).hidden = true; $(id).textContent = ''; }
      renderPostSave();
      renderMode();endCardTransition();
    }
    function stopPostSave() { clearTimeout(postSaveTimer); postSaveTimer = null; postSaveTarget = ''; }
    function renderPostSave() {
      const detail = state.record && state.record.postSave;
      $('post-save-state').hidden = true; $('post-save-state').textContent = '';
      if (!detail) { stopPostSave(); return; }
      if (detail.state !== 'pending' || !controller || !controller.getPostSaveStatus || !checkedContext()) { stopPostSave(); return; }
      const generation = state.generation, id = state.record.id, key = state.key, target = generation + '|' + key + '|' + id;
      if (postSaveTarget !== target) { stopPostSave(); postSaveTarget = target; }
      if (postSaveTimer) return;
      postSaveTimer = win.setTimeout(async () => {
        postSaveTimer = null;
        if (generation !== state.generation || key !== state.key || !state.record || id !== state.record.id || postSaveTarget !== target) return;
        try {
          const result = await controller.getPostSaveStatus({context: contextFor(), id});
          if (generation !== state.generation || key !== state.key || !state.record || id !== state.record.id || postSaveTarget !== target) return;
          if (result && result.ok !== false && result.postSave) { state.record.postSave = result.postSave; await persist(); }
        } catch (_) { /* A status read never retries creation or changes its verified receipt. */ }
        if (generation === state.generation && key === state.key && state.record && id === state.record.id && postSaveTarget === target) renderPostSave();
      }, 2000);
    }
    function acceptedResult(result) {
      return !!(result && result.ok === true && result.verified === true && result.record && /^\d+$/.test(text(result.record.id ?? result.record.requestId ?? result.id)));
    }
    async function applyResult(result, snapshot) {
      const current = () => snapshot.generation === state.generation && snapshot.key === state.key;
      if (result?.state === 'awaiting_reason' && result.operationId === snapshot.operation.operationId && Array.isArray(result.reasons) && result.reasons.some(item => text(item.id))) {
        const operation = {...snapshot.operation, state: 'awaiting_reason', action: result.action || snapshot.operation.action, reasons: structuredCopy(result.reasons), commentRequired: result.commentRequired === undefined ? snapshot.operation.commentRequired === true : result.commentRequired === true, commentAvailable: result.commentAvailable === undefined ? snapshot.operation.commentAvailable === true : result.commentAvailable === true};
        void persist({key: snapshot.key, draft: snapshot.draft, record: snapshot.previousRecord, recordOrigin: snapshot.recordOrigin, lookupDraft: snapshot.lookupDraft, skipAutoOpenPhone: snapshot.skipAutoOpenPhone, operation, metadata:snapshot.metadata, touched: snapshot.touched}).catch(()=>{});
        if (current()) { state.operation = operation; $('recovery').hidden = true; showError(result.ok === false ? errorText(result.error || 'Выберите причину отмены.') : ''); notice(''); renderCancellation(); }
        return;
      }
      if (acceptedResult(result) && (snapshot.kind !== 'create' && text(result.record.id ?? result.id) !== text(snapshot.previousRecord?.id || snapshot.operation.id) || result.record.base && result.record.base !== snapshot.draft.base)) result = {...result, ok: false, verified: false, state: 'uncertain', error: 'CRM вернула другую карточку. Изменения этой заявки не подтверждены.'};
      if (acceptedResult(result)) {
        completedOperations.add(snapshot.operation.operationId);
        const postSave = result.postSave || result.record.postSave || snapshot.previousRecord && snapshot.previousRecord.postSave;
        const record = normalizeRecord({...result.record, id: result.record.id ?? result.id, verified: true,
          ...(snapshot.kind === 'create' ? {sourceCommitted:result.sourceCommitted === true} : {}),
          ...(result.fieldDifferences?.length ? {fieldDifferences:result.fieldDifferences} : {}), ...(postSave ? {postSave} : {})}, snapshot.metadata);
        const savedDraft = {...snapshot.draft, extraFields: {...record.extraFields}};
        for (const name of DRAFT_FIELDS) if (Object.prototype.hasOwnProperty.call(record, name)) savedDraft[name] = record[name];
        const recordOrigin = snapshot.kind === 'create' ? 'created' : snapshot.recordOrigin || '';
        const stored = {key: snapshot.key, draft: savedDraft, record, recordOrigin, lookupDraft: snapshot.lookupDraft, skipAutoOpenPhone: snapshot.skipAutoOpenPhone, operation: null, touched: snapshot.touched};
        void commitVerifiedReceipt({
          publish: () => {
            if (!current()) return;
            ++recordReadRevision;
            state.record = record; state.recordOrigin = recordOrigin; state.draft = savedDraft; state.operation = null; state.mode = 'created';
            $('recovery').hidden = true; renderRecord(); setBusy(false);
            const sourceIncomplete = snapshot.kind === 'create' && result.sourceCommitted === false;
            const message = sourceIncomplete ? text(result.notice) || 'Заявка №' + record.id + ' создана, но источник не сохранён.'
              : (snapshot.kind === 'create' ? 'Заявка №' + record.id + ' создана успешно.' : 'Изменения сохранены.') + (result.notice ? '\n' + text(result.notice) : '');
            notice(message, !!result.fieldDifferences?.length || sourceIncomplete); showError('');
            void refreshRecord({quiet:true, immediate:true});
          },
          persist: () => persist(stored),
          onError: error => {if(current())showError(errorText(error));}
        });
        post(snapshot.kind === 'create' ? 'leadchat-request-created' : 'leadchat-request-updated', {context: snapshot.context, record});
        return;
      }
      // A fresh CRM read can prove that this exact edit was not applied.
      // Only that bound proof permits a deliberate retry under a new operation.
      const unappliedEdit=snapshot.kind!=='create' && result?.state==='rejected' && result.code==='edit_not_applied'
        && result.retryable===true && result.retryDraft && result.record?.base===snapshot.draft.base
        && text(result.record?.id)===text(snapshot.previousRecord?.id || snapshot.operation.id)
        && result.operationId===snapshot.operation.operationId;
      if(unappliedEdit)result={...result,safeToRetry:true};
      if(needsRecovery(result)) {
        let operation={...snapshot.operation,state:'uncertain',...(snapshot.kind==='create' && /^[1-9]\d*$/.test(text(result?.id))?{id:text(result.id)}:{}),...(Array.isArray(result?.candidates)?{candidates:structuredCopy(result.candidates)}:{})};
        if(result?.operationId && result.operationId!==operation.operationId) {
          const known=await operationFromStatus(snapshot,result.operationId);
          if(known){
            if(acceptedResult(known.result))return applyResult(known.result,{...snapshot,operation:known});
            operation=restorableOperation(known) || {...operation,blockedOperationId:result.operationId};
          }else operation.blockedOperationId=text(result.operationId);
        }
        if(current()){state.operation=operation;showRecovery();showError(errorText(result?.error || 'Результат сохранения пока не подтверждён. Повторная отправка отключена.'));}
        await persist({key:snapshot.key,draft:snapshot.draft,record:snapshot.previousRecord,recordOrigin:snapshot.recordOrigin,lookupDraft:snapshot.lookupDraft,skipAutoOpenPhone:snapshot.skipAutoOpenPhone,metadata:snapshot.metadata,operation,touched:snapshot.touched}).catch(error=>{if(current())showError(errorText(error));});
        return;
      }
      completedOperations.add(snapshot.operation.operationId);
      if(current()){
        state.operation=null;showRecovery();
        if(result?.primarySaved===true && snapshot.kind!=='create' && result.record?.base===snapshot.draft.base && text(result.record.id)===text(snapshot.previousRecord?.id)){
          state.record=normalizeRecord({...result.record,verified:true},snapshot.metadata);
          state.recordOrigin=snapshot.recordOrigin;renderRecord();
        }
        if(unappliedEdit){
          state.record=normalizeRecord({...result.record,verified:true},state.metadata);
          state.draft={...snapshot.draft,...result.retryDraft};state.mode='edit';
          renderMetadata({...state.metadata,...state.record});writeDraft(state.draft);renderMode();
        }
        showError(errorText(result?.error || result?.message || 'Не получен ответ CRM. Данные формы сохранены.'));
      }
      void persist({key:snapshot.key,draft:current()?state.draft:snapshot.draft,record:current()?state.record:snapshot.previousRecord,recordOrigin:snapshot.recordOrigin,lookupDraft:snapshot.lookupDraft,skipAutoOpenPhone:snapshot.skipAutoOpenPhone,metadata:snapshot.metadata,operation:null,touched:snapshot.touched}).catch(()=>{});
    }
    async function mutation(kind, event, patch, actionKey) {
      if (!event || event.isTrusted !== true || !trustedAction || trustedAction.kind !== kind || Date.now() - trustedAction.at > 2000 || state.busy || state.dependenciesPending || state.dependenciesError || state.operation || !controller || !state.loaded || !checkedContext()) return;
      const submitAction=kind==='create' && trustedAction.submitAction==='clarify' ? 'clarify' : '';
      trustedAction = null;
      if(kind!=='create' && (!actionKey || ['save','precheck_to_await'].includes(actionKey)) && visitChanged() && !['Клиент','Диспетчер','Директор'].includes($('edit-time-reason').value)){openVisitReason();return;}
      if(kind!=='create' && (recordLocked() && !['create_claim','not_taken',...RESTORE_ACTIONS].includes(actionKey) || actionKey && !nativeAction(actionKey) || !actionKey && kind==='update' && !writableRecord('save')))return;
      showError('');
      try { if (kind !== 'reschedule' && !['cancel_kc','cancel_branch','not_taken',...RESTORE_ACTIONS].includes(actionKey) && (!actionKey || nativeAction(actionKey)?.type!=='link')) validateDraft();else state.draft=readDraft(); }
      catch (error) { showError(errorText(error)); return; }
      if (kind !== 'create' && !state.record) { showError('Сначала загрузите сохранённую карточку CRM.'); return; }
      if (kind === 'reschedule') state.draft = {...draftFromRecord(state.record),...(patch || {})};
      const operation = {id: kind === 'create' ? '' : state.record.id, operationId: uniqueOperation(), kind, state: 'prepared', createdAt: Date.now()};
      // The deliberate Create click authorizes these same-client field changes.
      // Native CRM still proves the phone/customer identity before any update.
      const snapshot = {generation: state.generation, key: state.key, context: structuredCopy(contextFor()), draft: structuredCopy(state.draft), previousRecord: structuredCopy(state.record), recordOrigin: state.recordOrigin, lookupDraft: state.lookupDraft, skipAutoOpenPhone: state.skipAutoOpenPhone, metadata: state.metadata, operation, kind, touched: [...state.touched], allowCustomerUpdate: kind === 'create'};
      state.operation = operation; setBusy(true, kind === 'create' ? 'Создаём заявку…' : 'Сохраняем изменения…');
      let dispatched = false;
      try {
        clearTimeout(saveTimer);
        void persist({key: snapshot.key, draft: snapshot.draft, record: snapshot.previousRecord, recordOrigin: snapshot.recordOrigin, lookupDraft: snapshot.lookupDraft, skipAutoOpenPhone: snapshot.skipAutoOpenPhone, metadata:snapshot.metadata, operation, touched: snapshot.touched}).catch(()=>{});
        if (snapshot.generation !== state.generation || snapshot.key !== state.key) { await persist({...snapshot, record:snapshot.previousRecord, operation:null}); return; }
        const args = {context: snapshot.context, operationId: operation.operationId, trustedUserAction: true, userGesture: true};
        let result;
        dispatched = true;
        if (kind === 'create') result = await controller.createRequest({...args, draft: {...snapshot.draft, allowCustomerUpdate: snapshot.allowCustomerUpdate}, allowCustomerUpdate: snapshot.allowCustomerUpdate,...(submitAction?{submitAction}:{})});
        else {
          const fullPatch = {...snapshot.draft, ...(patch || {}), expectedRevision: snapshot.previousRecord.revision};
          if(actionKey) {
            if(typeof controller.performAction!=='function')throw Error('Нативные действия CRM недоступны. Обновите расширение.');
            result=await controller.performAction({...args,id:snapshot.previousRecord.id,action:actionKey,fields:nativeAction(actionKey)?.type==='link'?{}:fullPatch,expectedRevision:snapshot.previousRecord.revision});
          } else result = await controller.updateRequest({...args, id: snapshot.previousRecord.id, patch: fullPatch, expectedRevision: snapshot.previousRecord.revision});
        }
        await applyResult(result, snapshot);
      } catch (error) {
        await applyResult({ok:false,state:dispatched?'uncertain':'rejected',writeStarted:dispatched,safeToRetry:!dispatched,error:errorText(error)},snapshot);
      } finally { if (snapshot.generation === state.generation) { setBusy(false); updateClock(); renderMode();showRecovery(); queueSave(); } }
    }
    async function recover(candidateId, quiet = false) {
      if (!state.operation || state.busy || recoveryInFlight || !controller) return;
      recoveryInFlight = true;
      const operation = structuredCopy(state.operation), generation = state.generation;
      const snapshot = {generation, key: state.key, context: structuredCopy(contextFor()), draft: structuredCopy(state.draft), previousRecord: state.record, recordOrigin: state.recordOrigin, lookupDraft: state.lookupDraft, skipAutoOpenPhone: state.skipAutoOpenPhone, metadata: state.metadata, operation, kind: operation.kind, touched: [...state.touched]};
      if (!quiet) setBusy(true, 'Выясняем результат предыдущей операции без повторной отправки…');
      showError('');
      try {
        let result;
        if(operation.blockedOperationId){
          const known=await operationFromStatus(snapshot,operation.blockedOperationId);
          if(!known)throw Error('Не удалось подтвердить текущую операцию сохранения. Повторная отправка отключена.');
          if(acceptedResult(known.result)){await applyResult(known.result,{...snapshot,operation:known});return;}
          const pending=restorableOperation(known);
          if(!pending)throw Error('Статус прежней операции требует повторной проверки CRM.');
          Object.assign(operation,pending);delete operation.blockedOperationId;
          if(generation===state.generation && snapshot.key===state.key)state.operation=structuredCopy(operation);
        }
        if (controller.reconcile) result = await controller.reconcile({context: snapshot.context, operationId: operation.operationId, id: operation.id, kind: operation.kind, ...(typeof candidateId === 'string' ? {candidateId} : {})});
        else throw new Error('Проверка сохранённых полей операции CRM недоступна. Повторная отправка остаётся заблокированной.');
        await applyResult(result, snapshot);
      } catch (error) {
        if (generation === state.generation && (!quiet || nextRecoveryDelay(recoveryAttempts.get(recoveryTarget()) || 0) === null)) showError(errorText(error));
      } finally {
        recoveryInFlight = false;
        if (generation === state.generation) {
          if (!quiet) {setBusy(false);renderMode();}
          updateClock();showRecovery();
        }
      }
    }
    async function refreshRecord(options = {}) {
      const quiet = options.quiet === true;
      if (destroyed || state.busy || state.operation || state.dependenciesPending || !state.record || !controller?.getRequest || !checkedContext() || doc.hidden) return;
      if (refreshInFlight) { refreshQueued = true; return; }
      if (quiet && !options.immediate && Date.now() - lastRefreshStarted < 1000) { refreshQueued = true; return; }
      refreshInFlight = true; lastRefreshStarted = Date.now();
      const generation = state.generation, key = state.key, id = state.record.id, base = state.record.base, readRevision = recordReadRevision;
      if (!quiet) showError('');
      try {
        const result = await controller.getRequest({context: contextFor(base), base, id, fresh: true});
        if (generation !== state.generation || readRevision !== recordReadRevision || key !== state.key || state.record?.id !== id || state.operation || state.busy || state.dependenciesPending) return;
        if (!acceptedResult(result) || text(result.record.id) !== text(id) || result.record.base !== base) throw new Error(errorText(result && result.error || 'CRM не подтвердила чтение точной карточки.'));
        const postSave = result.postSave || result.record.postSave || state.record.postSave;
        const next = normalizeRecord({...result.record, verified: true, id: result.record.id ?? result.id, ...(postSave ? {postSave} : {})}, state.metadata);
        if (next.base === state.draft?.base && !!next.cityNoticeCityId && text(next.cityNoticeCityId) === $('cityId').value) state.metadata = {...state.metadata, base: next.base, cityNoticeCityId: next.cityNoticeCityId, cityNotice: text(next.cityNotice)};
        // Yii rotates the masked CSRF token on GET. Keep its fresh private
        // snapshot without rebuilding controls or closing an open selector.
        if (recordViewFingerprint(next) === recordViewFingerprint(state.record)) { state.record = next; return; }
        const previous = draftFromRecord(state.record), local = readDraft(), fresh = draftFromRecord(next), merged = mergeRefreshedDraft(previous, local, fresh);
        if(['cityId','street','house','settlement'].some(name=>text(state.record[name])!==text(next[name])))invalidateAddress(true);
        const active = doc.activeElement, focusId = active?.id, selection = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        state.record = next; renderRecord(); state.draft = merged; writeDraft(merged); $('edit-time-reason').value = merged.reason || ''; renderMode();
        if (focusId && $(focusId) && !$(focusId).disabled) { $(focusId).focus({preventScroll: true}); if (selection) try { $(focusId).setSelectionRange(...selection); } catch (_) {} }
        await persist();
      } catch (error) { if (generation === state.generation && !quiet) showError(errorText(error)); }
      finally { refreshInFlight = false; if (generation === state.generation) updateClock(); if (refreshQueued && !destroyed) { refreshQueued = false; win.setTimeout(() => { if (!destroyed) void refreshRecord({quiet: true}); }, 1000); } }
    }
    function updateAddressState() { $('map-state').textContent = state.draft && state.draft.addressConfirmed ? 'Адрес подтверждён' : 'Адрес не подтверждён'; $('map-state').classList.toggle('confirmed', !!(state.draft && state.draft.addressConfirmed)); }
    function cancelAddressSuggestions() {
      pinnedTerritoryAbort?.abort();pinnedTerritoryAbort=null;pinnedTerritoryPending='';
      clearTimeout(addressSuggestTimer);addressSuggestTimer=null;
      addressChoiceAbort?.abort();addressChoiceAbort=null;++addressChoiceRevision;
      addressAbort?.abort();addressAbort=null;++state.addressRevision;
      $('address-results').replaceChildren();$('address-query').setAttribute('aria-expanded','false');$('address-search').disabled=false;
    }
    function invalidateAddress(resetPanel, keepMap, preservePin=false, preserveCity=false) {
      cancelAddressSuggestions();
      savedAddressAbort?.abort();savedAddressAbort=null;savedAddressPending='';savedAddressReady=null;
      clearBranchDistance();
      if(!keepMap){cityPreloadAbort?.abort();cityPreloadAbort=null;cityPreloadPending='';cityPreloadKey='';}
      if (state.draft) { if(preservePin){const pin=state.draft.addressProof || state.draft.mapPin;if(Array.isArray(pin?.coordinates))state.draft.mapPin={...pin,mapBoundary:null,serviceBoundary:preserveCity?pin.serviceBoundary:null};if(!preserveCity)state.draft.mapCityCenter=null;}else{state.draft.mapPin=null;state.draft.mapCityCenter=null;}state.draft.addressConfirmed = false; state.draft.addressProof = null; }
      $('address-results').replaceChildren();if(!keepMap){$('yandex-map').hidden = true; $('yandex-map').removeAttribute('src'); $('map-external').hidden = true;}$('address-search').disabled = false;
      $('map-help').textContent = 'Адрес изменён. Повторите поиск и проверьте улицу и дом.';
      if (resetPanel) { $('map-panel').hidden = true; $('map-toggle').setAttribute('aria-expanded', 'false'); $('address-query').value = ''; }
      updateAddressState();
      renderTerritory();$('address-query').setAttribute('aria-expanded','false');
      syncMapPreloadLayout();
    }
    function draftFromRecord(input) {
      const record = normalizeRecord(input, state.metadata), draft = {extraFields: {...record.extraFields}, addressConfirmed: false, ...(state.draft && state.draft.creationCycleId ? {creationCycleId: state.draft.creationCycleId} : {})};
      for (const name of DRAFT_FIELDS) draft[name] = name === 'base' ? record.base || state.draft && state.draft.base || '' : record[name] ?? '';
      for (const [flag, crmName] of Object.entries(FLAG_NAMES)) {
        const nativeCheckbox = (record.form?.fields || []).find(item => item.name === crmName && item.type === 'checkbox');
        const value = record[flag] ?? record.extraFields?.[crmName];
        // Prefer actual native checked state. The input's value attribute is not a boolean.
        draft[flag] = nativeCheckbox && typeof nativeCheckbox.checked === 'boolean'
          ? nativeCheckbox.checked
          : value === true || value === 1 || /^(?:1|true|on|yes|да)$/i.test(text(value).trim());
      }
      return draft;
    }
    function updateContext(context) {
      context = {...context, adUrl: typeof context.adUrl === 'string' ? context.adUrl : ''};
      renderAdvertisement(context);
      if(contextPending) {
        contextPending=false;doc.body.inert=false;
        if(state.context && state.key && scopeKey(context,state.draft?.base)===state.key && context.ok!==false && context.allowed!==false && context.routeSafe!==false) {
          setBusy(!!state.operation || !state.loaded);
        }
      }
      const incomingValid=contextFlagsValid(context),previousValid=contextFlagsValid(state.context);
      if(!incomingValid && state.context && (previousValid || suspendedContextScope!==null)){
        if(previousValid){
          suspendedContextScope=scopeKey(state.context,'kp');
          if(state.draft && !state.operation)state.draft=readDraft();
          if(state.key && state.draft)void persist().catch(()=>{});
          clearTimeout(saveTimer);
          ++state.generation;
        }
        // Suspend old callbacks without clearing a record, a typed draft or an
        // operation whose eventual receipt still belongs to its original scope.
        state.context=scopeKey(context,'kp')===suspendedContextScope
          ? {...state.context,...structuredCopy(context)}
          : {...state.context,ok:false,allowed:false,routeSafe:false};
        resolvingBaseKey='';failedBaseKey='';
        setBusy(false);$('editable-fields').disabled=true;endCardTransition();return;
      }
      if(incomingValid && suspendedContextScope!==null){
        const sameScope=scopeKey(context,'kp')===suspendedContextScope;suspendedContextScope=null;
        if(!sameScope){void loadContext(context);return;}
        if(manualBaseChoice || state.record || state.operation){void loadContext(context,state.draft?.base);return;}
        const nextBase=win.LeadPartnerRules?.resolveBase(context,context.baseCandidates?.length?context.baseCandidates:undefined)?.base;
        void loadAutomaticBase(context,BASES.includes(nextBase)?nextBase:'');return;
      }
      doc.body.classList.remove('route-waiting');
      const resolutionKey = baseEvidenceKey(context);
      if ((resolvingBaseKey === resolutionKey || failedBaseKey === resolutionKey) && state.draft && !state.draft.base) {
        state.context = {...state.context,...structuredCopy(context)}; renderContextFacts(state.context); return;
      }
      if (!state.context || !state.draft || !state.key || scopeKey(context, state.draft.base) !== state.key) {
        const sameScope=state.context && scopeKey(context,'kp')===scopeKey(state.context,'kp');
        const portable=sameScope && !state.draft?.base?automaticBaseTransfer(''):null;
        doc.body.classList.add('route-waiting');loadContext(context,undefined,null,portable?.draft || null,portable?.transfer || null);return;
      }
      const nextContext={...state.context,...structuredCopy(context)};
      if(!state.record && !state.operation && !manualBaseChoice && state.mode==='create' && advertIdentity(context)===advertIdentity(state.context) && context.ok!==false && context.allowed!==false && context.routeSafe!==false){
        const nextBase=win.LeadPartnerRules?.resolveBase(nextContext,nextContext.baseCandidates?.length?nextContext.baseCandidates:undefined)?.base;
        if(BASES.includes(nextBase) && nextBase!==state.draft.base){
          const needsNamedRead=!context.ignoreNamedRequest && /^[1-9]\d{3,11}$/.test(text(context.namedRequestId));
          void loadAutomaticBase(context,needsNamedRead?'':nextBase);return;
        }
      }
      if(!state.record && !state.operation && advertIdentity(context)!==advertIdentity(state.context)){void loadContext(context);return;}
      const previousCity=sourceHeaderCity();
      const previousProfile = text(state.context.profileComment), previousMaster = text(state.context.masterComment), previousNamedId = text(state.context.namedRequestId), previousMessages = messageFingerprint(state.context);
      const autoChanged = text(context.sourceCode || context.source) !== text(state.context.sourceCode || state.context.source) || text(context.partnerNumber || context.partner) !== text(state.context.partnerNumber || state.context.partner);
      state.context = {...state.context, ...structuredCopy(context)};
      if(previousCity!==sourceHeaderCity()){
        cityRoutingTask.cancel(true);automaticCityChoice=null;
        if(canChooseCity()){
          state.draft=readDraft();const previousId=state.draft.cityId;
          if(!state.touched.has('settlement') && automaticLocality && text(state.draft.settlement)===automaticLocality){state.draft.settlement='';$('settlement').value='';automaticLocality='';}
          syncAutomaticCity(state.metadata || {});$('cityId').value=state.draft.cityId;
          if(previousId!==state.draft.cityId){invalidateAddress(false,true,false);cityPreloadKey='';if(state.preparing)state.dependenciesChangedDuringLoad=true;else if(state.loaded&&!state.busy)void dependencies();}
          scheduleCityMapPreload();
        }
      }
      if(state.record)syncContextPhone();
      syncBranchDistance();
      if(!state.busy && !state.operation && state.draft && ['create','edit'].includes(state.mode)){state.draft.comments=win.LeadPartnerRules.withFreeVisit($('comments').value,state.context.messages);$('comments').value=state.draft.comments;}
      if (!state.busy && !state.operation) queueSave();
      if (state.record && messageFingerprint(state.context) !== previousMessages) void refreshRecord({quiet: true});
      renderContextFacts(state.context);baseResolution=win.LeadPartnerRules?.resolveBase(state.context,state.context.baseCandidates?.length?state.context.baseCandidates:undefined);renderBaseReason();
      if (autoChanged && !state.record && !state.operation && state.mode === 'create') {
        state.autoReloadRequested = true; setCreateDisabled(true); renderAutomaticSource();
        if (!state.busy) { clearTimeout(saveTimer); state.draft = readDraft(); state.metadata = null; state.loaded = false; loadContext(state.context, state.draft.base); }
        return;
      }
      if (!state.busy && !state.operation && !state.record && state.mode === 'create') {
        const proposed = initialDraft(context, state.draft.base);
        for (const name of ['clientName', 'street', 'house', 'apartment', 'settlement', 'entrance', 'floor', 'intercom', 'cityId', 'partnerId', 'partnerComment']) {
          if (!state.touched.has(name) && !text(state.draft[name]).trim() && text(proposed[name]).trim()) { state.draft[name] = proposed[name]; $(name).value = text(proposed[name]); }
        }
        if (!state.touched.has('comments') && state.context.profileComment && state.context.profileComment !== previousProfile) {
          const obsolete = new Set([previousProfile, previousMaster, text(state.context.masterComment)].map(value => value.trim()).filter(Boolean));
          state.draft.comments = appendUniqueLines(text(state.draft.comments).split(/\r?\n/).filter(line => !obsolete.has(line.trim())).join('\n'), [state.context.profileComment]); $('comments').value = state.draft.comments;
        }
        syncContextPhone();
        queueSave();
      }
      updateClock(); setBusy(state.busy);
      if (!state.busy && state.loaded && !state.record && !state.operation && !state.context.ignoreNamedRequest && context.namedRequestId && context.namedRequestId !== previousNamedId) void openNamedRequest();
    }
    function splitStreetHouse() {
      if(!$('house').value.trim() && !$('house').disabled && !$('street').disabled){
        const parsed=win.LeadChatAddress?.splitStreetAddress($('street').value);
        if(parsed?.ok && parsed.street && parsed.house){
          $('street').value=parsed.street;$('house').value=parsed.house;
          state.draft.street=parsed.street;state.draft.house=parsed.house;
          state.touched.add('street');state.touched.add('house');
          for(const name of ['apartment','entrance','floor'])if(parsed[name] && !$(name).value.trim() && !$(name).disabled){$(name).value=parsed[name];state.draft[name]=parsed[name];state.touched.add(name);}
        }
      }
    }
    function normalizedAddressQuery(value) {
      return win.LeadChatAddress?.mapQuery(cityLabel(),value) || value || cityLabel();
    }
    function mapCityKey(){return text(cityLabel()).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();}
    function territoryProofCurrent(proof){
      const territory=proof?.territory,version=win.LeadChatMapSearch?.TERRITORY_CLASSIFIER_VERSION;
      return territory?.source!=='constructor' || Number.isInteger(version) && territory.classifierVersion===version;
    }
    function adoptTerritoryCity(territory){
      if(territory?.state!=='inside' || territory.source!=='constructor' || territory.base!==state.draft?.base || $('cityId').disabled || state.record && recordLocked())return false;
      const id=win.LeadChatPriceUI?.territoryCityId(territory.territoryTitle,optionsFor('cityId')) || '';
      if(!id || id===$('cityId').value)return false;
      $('cityId').value=id;state.draft.cityId=id;state.touched.add('cityId');state.draft.mapCityCenter=null;
      void dependencies();updateClock();queueSave();return true;
    }
    function municipalProofMatches(value,boundary){
      if(value.source!=='yandex-city')return true;
      if(/^\d{1,24}$/.test(text(value.municipalityId)) && value.municipalityId===boundary?.municipalityId && !!text(value.municipalityUri) && value.municipalityUri===boundary?.municipalityUri)return true;
      const municipalities=boundary?.municipalities;
      return Array.isArray(municipalities)&&municipalities.length>0&&municipalities.every(item=>/^\d{1,24}$/.test(text(item.id))&&text(item.uri).startsWith('ymapsbm1://geo?data='))&&JSON.stringify(value.municipalityIds)===JSON.stringify(municipalities.map(item=>item.id))&&JSON.stringify(value.municipalityUris)===JSON.stringify(municipalities.map(item=>item.uri));
    }
    async function refreshPinnedTerritory(pin,{keepBranch=false}={}){
      if(!pin||typeof controller?.resolveAddress!=='function')return;
      if(optionsFor('cityId').filter(item=>!item.disabled && item.id===$('cityId').value).length!==1)return;
      const generation=state.generation,revision=state.addressRevision,base=state.draft.base,city=mapCityKey(),cityId=$('cityId').value,street=$('street').value,house=$('house').value,settlement=$('settlement').value;
      const pending=JSON.stringify([generation,revision,base,cityId,street,house,settlement,pin.id,pin.mapAddress,pin.coordinates]);
      if(pinnedTerritoryPending===pending)return;
      pinnedTerritoryAbort?.abort();const abort=new AbortController();pinnedTerritoryAbort=abort;pinnedTerritoryPending=pending;
      const current=()=>!abort.signal.aborted && !destroyed && generation===state.generation && revision===state.addressRevision && base===state.draft.base && city===mapCityKey() && cityId===$('cityId').value && street===$('street').value && house===$('house').value && settlement===$('settlement').value;
      renderTerritory({state:'unknown',label:'Проверяем территорию…'});
      try{
        const result=await controller.resolveAddress({context:contextFor(),query:pin.label || [cityLabel(),settlement,street,house].filter(Boolean).join(', '),signal:abort.signal,selectedOfficeOnly:keepBranch});
        if(!current())return;
        const id=text(pin.id||pin.mapAddress?.id),coordinates=pin.coordinates;
        const matches=(result?.candidates||[]).filter(item=>item.exact===true && (!id||text(item.id||item.mapAddress?.id)===id) && Array.isArray(coordinates) && Array.isArray(item.coordinates) && coordinates.length===2 && item.coordinates.length===2 && coordinates.every((n,i)=>n===item.coordinates[i]) && (!pin.mapAddress?.uri || item.mapAddress?.uri===pin.mapAddress.uri));
        if(matches.length!==1){state.draft.addressConfirmed=false;renderTerritory({state:'unknown',label:'Проверьте адрес'});updateAddressState();return;}
        const selected=matches[0];if(!keepBranch)adoptTerritoryCity(selected.territory);
        // Geometry belongs to this branch, while the original exact house ID,
        // URI, coordinates and operator-entered address remain unchanged.
        const currentCity=mapCityKey(),checked={...selected,id:pin.id||selected.id,label:pin.label||selected.label,coordinates:coordinates.slice(),mapAddress:pin.mapAddress||selected.mapAddress,addressLocality:pin.addressLocality||selected.addressLocality,street,house,base,cityId:$('cityId').value,cityKey:currentCity,needsTerritoryRefresh:false};
        state.draft.addressProof=checked;state.draft.addressConfirmed=true;
        showMap(checked);renderTerritory(selected.territory);$('map-help').textContent='';queueSave();updateAddressState();
      }catch(_){if(current())renderTerritory({state:'unknown',label:'Проверьте адрес'});}
      finally{if(pinnedTerritoryAbort===abort){pinnedTerritoryAbort=null;pinnedTerritoryPending='';}}
    }
    function retainAddressOnCityChange(){
      const previous=optionsFor('cityId').find(item=>item.id===text(state.draft.cityId))?.label || sourceHeaderCity(),previousCity=win.LeadChatAddress?.normalizeMapCity(previous) || previous;
      const pin=preservedCityPin(state.draft.addressProof || state.draft.mapPin,{base:state.draft.base,street:$('street').value,house:$('house').value}),query=$('address-query').value;
      state.draft.cityId=$('cityId').value;invalidateAddress(false,true,!!pin);cityPreloadKey='';
      if(pin){
        const retained={...pin,cityKey:mapCityKey(),base:state.draft.base};showMap(retained);$('address-query').value=query;
        $('map-help').textContent='Проверяем территорию выбранного филиала…';
        if(!$('map-panel').hidden)void refreshPinnedTerritory(retained,{keepBranch:true});
      }else $('address-query').value=cityChangeQuery(query,previousCity,win.LeadChatAddress?.normalizeMapCity(cityLabel()) || cityLabel());
      updateClock();scheduleCityMapPreload();
    }
    function renderTerritory(value) {
      const badge=$('map-territory'),hasVerdict=['inside','outside'].includes(value?.state);
      let proven=false;
      if(hasVerdict && ['constructor','yandex-city'].includes(value.source) && value.base===state.draft?.base && Array.isArray(value.coordinates) && value.coordinates.length===2 && value.coordinates.every(Number.isFinite)){
        try{
          const frame=new URL($('yandex-map').getAttribute('src')||''),point=(frame.searchParams.get('pt')||'').split(',').slice(0,2).map(Number),pin=state.draft.mapPin,boundary=pin?.serviceBoundary,selected=pin?.mapAddress;
          const expected='constructor:'+win.LeadChatMapSearch?.CONSTRUCTORS?.[state.draft.base];
          proven=value.constructorId===expected && frame.searchParams.get('um')===expected && frame.searchParams.get('source')==='constructorLink' && frame.searchParams.get('lp_request_base')===state.draft.base && boundary?.source===value.source && municipalProofMatches(value,boundary) && (!state.draft.addressConfirmed || state.draft.addressProof?.cityKey===mapCityKey()) && boundary.base===state.draft.base && boundary.constructorId===expected && Array.isArray(boundary.titles) && boundary.titles.length>0 && text(pin?.street)===text($('street').value) && text(pin?.house)===text($('house').value) && point.length===2 && point.every(Number.isFinite) && point.every((number,index)=>Math.abs(number-value.coordinates[index])<=0.000001) && (!selected || frame.searchParams.get('oid')===text(selected.id) && frame.searchParams.get('ouri')===text(selected.uri));
        }catch(_){/* A verdict must belong to the original service map and exact house currently displayed. */}
      }
      badge.dataset.state=proven?value.state:'unknown';
      badge.textContent=proven?value.label:hasVerdict?'Проверьте адрес':value?.label || 'Выберите дом';
      syncBranchDistance();
    }
    function selectedCityMapKey(){return state.draft && BASES.includes(state.draft.base) && cityLabel() ? [state.draft.base,$('cityId').value,mapCityKey()].join('|') : '';}
    function savedAddressSelection(){
      if(!state.record || state.record.verified!==true || !/^\d+$/.test(text(state.record.id)) || state.record.base!==state.draft?.base || !selectedCityMapKey())return null;
      const native=normalizeRecord(state.record,state.metadata),fields=['cityId','settlement','street','house'];
      if(!text(native.house).trim() || !text(native.street || native.settlement).trim() || fields.some(name=>text(native[name])!==text($(name).value)))return null;
      return {key:JSON.stringify([state.generation,state.key,state.record.base,state.record.id,...fields.map(name=>text(native[name]))]),id:text(state.record.id),base:state.record.base,cityId:text(native.cityId),street:text(native.street),house:text(native.house),settlement:text(native.settlement),query:[cityLabel(),native.settlement,native.street,native.house].filter(Boolean).join(', ')};
    }
    function addressComparable(value){return text(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/(?:^|\s)(?:улица|ул\.?)(?=\s|$)/gu,' ').replace(/[^\p{L}\p{N}]+/gu,'');}
    function publishSavedAddress(selected,candidate){
      if(savedAddressSelection()?.key!==selected.key)return false;
      adoptTerritoryCity(candidate.territory);
      const native={...candidate,street:selected.street,house:selected.house,cityKey:mapCityKey()};
      state.draft.addressConfirmed=true;state.draft.addressProof={...native,base:selected.base,cityId:$('cityId').value};
      showMap(native);renderTerritory(candidate.territory);updateAddressState();$('map-help').textContent='';
      return true;
    }
    async function preloadSavedAddress(){
      const selected=savedAddressSelection();if(!selected || typeof controller?.resolveAddress!=='function')return;
      if(state.draft.addressConfirmed && state.draft.mapPin?.base===selected.base && state.draft.addressProof?.cityKey===mapCityKey() && text(state.draft.addressProof.street)===selected.street && text(state.draft.addressProof.house)===selected.house && territoryProofCurrent(state.draft.addressProof))return;
      if(savedAddressReady?.key===selected.key){publishSavedAddress(selected,savedAddressReady.candidate);return;}
      if(savedAddressPending===selected.key)return;
      savedAddressAbort?.abort();const abort=new AbortController();savedAddressAbort=abort;savedAddressPending=selected.key;
      const revision=state.addressRevision,current=()=>!abort.signal.aborted && !destroyed && revision===state.addressRevision && savedAddressSelection()?.key===selected.key;
      const accept=result=>{
        if(!current() || result?.ok!==true)return;
        const matches=(result.candidates || []).filter(candidate=>candidate.exact===true && Array.isArray(candidate.coordinates) && candidate.coordinates.length===2 && candidate.coordinates.every(Number.isFinite) && Math.abs(candidate.coordinates[0])<=180 && Math.abs(candidate.coordinates[1])<=90 && addressComparable(candidate.house)===addressComparable(selected.house) && (!selected.street || addressComparable(candidate.street)===addressComparable(selected.street)) && (!selected.settlement || addressComparable(candidate.settlement)===addressComparable(selected.settlement) || addressComparable(candidate.label).includes(addressComparable(selected.settlement))));
        if(matches.length!==1)return;
        savedAddressReady={key:selected.key,candidate:matches[0]};publishSavedAddress(selected,matches[0]);
      };
      try{const result=await controller.resolveAddress({context:contextFor(),query:selected.query,signal:abort.signal,onAddressResult:accept});accept(result);}
      catch(_){/* The native editor remains available when background map lookup fails. */}
      finally{if(savedAddressAbort===abort){savedAddressAbort=null;savedAddressPending='';}}
    }
    function syncMapPreloadLayout(){
      const panel=$('map-panel'),hidden=panel.hidden;
      panel.classList.toggle('map-preloading',hidden && !!selectedCityMapKey());
      panel.inert=hidden;panel.setAttribute('aria-hidden',String(hidden));
      const width=Math.max(240,Math.min(900,$('request-form').getBoundingClientRect().width-20 || 580));
      panel.style.setProperty('--preload-map-width',width+'px');
    }
    function scheduleCityMapPreload(){
      syncMapPreloadLayout();
      if(!selectedCityMapKey()){cityPreloadAbort?.abort();cityPreloadAbort=null;cityPreloadKey='';cityPreloadPending='';$('yandex-map').hidden=true;$('yandex-map').removeAttribute('src');return;}
      void previewSelectedCity();
      void preloadSavedAddress();
    }
    async function previewSelectedCity(){
      const key=selectedCityMapKey();if(!key || destroyed)return;
      if(cityPreloadKey===key && $('yandex-map').getAttribute('src') || cityPreloadPending===key)return;
      cityPreloadAbort?.abort();const abort=new AbortController();cityPreloadAbort=abort;cityPreloadPending=key;
      const generation=state.generation,base=state.draft.base,city=cityLabel();
      syncMapPreloadLayout();
      const cached=win.LeadChatMapSearch?.cityPreview?.(base,city);
      if(cached){
        state.draft.mapCityCenter=cached.center;cityPreloadKey=key;cityPreloadPending='';showMap(win.LeadChatMapSearch.mapLinks(base,city,'',undefined,cached));$('map-help').textContent='';return;
      }
      $('yandex-map').hidden=true;$('yandex-map').removeAttribute('src');$('map-external').hidden=true;$('map-help').textContent='Открываем карту: '+city+'…';
      try{
        const result=await controller?.resolveAddress?.({context:contextFor(),query:'',cityOnly:true,signal:abort.signal});
        if(abort.signal.aborted || generation!==state.generation || key!==selectedCityMapKey())return;
        if(result?.ok && result.mapUrl && new URL(result.mapUrl).searchParams.get('ll')){
          if(Array.isArray(result.cityCenter))state.draft.mapCityCenter=result.cityCenter;
          cityPreloadKey=key;showMap(result);$('map-help').textContent='';
        }else $('map-help').textContent='Карта города ещё не загрузилась. Нажмите «Найти».';
      }catch(_){if(!abort.signal.aborted && generation===state.generation && key===selectedCityMapKey())$('map-help').textContent='Не удалось открыть карту выбранного города. Нажмите «Найти».';}
      finally{if(cityPreloadAbort===abort){cityPreloadAbort=null;cityPreloadPending='';}}
    }
    function clearBranchDistance(){
      distanceAbort?.abort();distanceAbort=null;distanceKey='';++distanceRevision;
      const node=$('map-distance');if(node){node.hidden=true;node.textContent='';node.removeAttribute('title');delete node.dataset.state;}
    }
    function distanceSelection(){
      if(!state.draft || state.draft.base!=='kp' || !state.draft.addressConfirmed || $('map-territory')?.dataset.state!=='outside' || win.LeadPartnerRules?.televisionService?.(state.context))return null;
      const work=optionsFor('workId').find(item=>item.id===$('workId').value),label=text(work?.label || $('workId').selectedOptions?.[0]?.textContent);
      if(!$('workId').value || !label || /телевиз|кинескоп|плазмен|(?:^|[\s/])(?:тв|tv)(?:$|[\s/])/iu.test(label))return null;
      if(!win.LeadChatMapRoute?.mainBranch?.({base:'kp',city:cityLabel(),cityId:$('cityId').value}))return null;
      const proof=state.draft.addressProof,pin=state.draft.mapPin,point=proof?.coordinates;
      if(proof?.base!=='kp' || proof.territory?.state!=='outside' || proof.territory.base!=='kp' || proof.cityKey!==mapCityKey() || pin?.cityKey!==mapCityKey() || proof.exact===false ||
        text(proof.street)!==text($('street').value) || text(proof.house)!==text($('house').value) ||
        !Array.isArray(point) || point.length!==2 || !point.every(Number.isFinite) || Math.abs(point[0])>180 || Math.abs(point[1])>90 ||
        !Array.isArray(pin?.coordinates) || !point.every((n,i)=>Math.abs(n-pin.coordinates[i])<0.000001))return null;
      const locality=proof.addressLocality,localityKey=win.LeadChatMapSearch?.addressLocalityKey?.(locality);
      if(!localityKey)return null;
      return {key:[selectedCityMapKey(),...point,text($('workId').value),text(proof.label),text(state.record?.id),localityKey].join('|'),locality:structuredCopy(locality),localityKey,label:text(locality.title)};
    }
    function syncBranchDistance(){
      const selected=distanceSelection(),node=$('map-distance');if(!node)return;
      if(!selected){if(distanceKey || !node.hidden)clearBranchDistance();return;}
      if(distanceKey===selected.key)return;
      clearBranchDistance();distanceKey=selected.key;
      const revision=distanceRevision,generation=state.generation,abort=new AbortController();distanceAbort=abort;
      node.hidden=false;node.dataset.state='loading';node.textContent='Считаем расстояние…';
      node.title='Кратчайший автомобильный маршрут от центра выбранного города до населённого пункта клиента';
      void (async()=>{
        try{
          const result=await controller?.routeFromCity?.({context:contextFor(),destinationLocality:selected.locality,signal:abort.signal});
          if(abort.signal.aborted || generation!==state.generation || revision!==distanceRevision || distanceSelection()?.key!==selected.key)return;
          const label=typeof result?.distanceText==='string' && result.distanceText.length<=80 && !!result.distanceText.trim() && !/[\u0000-\u001f\u007f]/u.test(result.distanceText);
          const locality=result?.destinationLocality,point=locality?.coordinates;
          const valid=result?.ok===true && result.mode==='auto' && result.direction==='from-city' && result.provider==='yandex' && Number.isFinite(result.distanceMeters) && result.distanceMeters>=0 && label && Number.isFinite(result.displayDistanceMeters) && result.displayDistanceMeters>=0 && ['near','far'].includes(result.classification) && win.LeadChatMapRoute.classify(result.displayDistanceMeters)===result.classification && locality?.source==='yandex-locality-point' && locality.addressIdentity===selected.localityKey && /^\d{1,24}$/.test(text(locality.id)) && Array.isArray(point) && point.length===2 && point.every(Number.isFinite) && Array.isArray(result.destination) && point.every((n,i)=>Math.abs(n-result.destination[i])<0.000001);
          if(!valid){node.dataset.state='unavailable';node.hidden=/locality/u.test(text(result?.reason));node.textContent=node.hidden?'':'Расстояние недоступно';return;}
          node.dataset.state=result.classification;node.textContent='От филиала '+result.distanceText;
          const checked=new Date(result.checkedAt),checkedAt=Number.isFinite(checked.getTime())?checked.toISOString():'';
          node.title=[text(result.originCity?.title || result.originName || cityLabel())+' → '+text(locality.title || selected.label),'Кратчайший автомобильный маршрут · '+result.distanceText,checkedAt?'Проверено: '+checkedAt:''].filter(Boolean).join('\n');
        }catch(_){if(!abort.signal.aborted && revision===distanceRevision){node.dataset.state='unavailable';node.textContent='Расстояние недоступно';}}
        finally{if(distanceAbort===abort)distanceAbort=null;}
      })();
    }
    async function recenterSelectedCity(){
      if(!state.draft || !$('cityId').value || $('map-panel').hidden)return;
      const pin=state.draft.mapPin || state.draft.addressProof, coordinates=pin?.coordinates;
      if(!Array.isArray(coordinates) || coordinates.length!==2 || !coordinates.every(Number.isFinite)){void previewSelectedCity();return;}
      const generation=state.generation,revision=state.addressRevision,base=state.draft.base,cityId=$('cityId').value;
      state.draft.mapCityCenter=null;showMap({...pin,exact:true,mapBoundary:null,serviceBoundary:null});
      try{const result=await controller?.resolveAddress?.({context:contextFor(),query:'',cityOnly:true});
        if(generation!==state.generation || revision!==state.addressRevision || cityId!==$('cityId').value || base!==state.draft.base || $('map-panel').hidden)return;
        if(result?.ok && Array.isArray(result.cityCenter) && result.cityCenter.length===2 && result.cityCenter.every(Number.isFinite)){state.draft.mapCityCenter=result.cityCenter;showMap({...pin,exact:true,cityCenter:result.cityCenter,mapBoundary:null,serviceBoundary:result.serviceBoundary || null});queueSave();}
      }catch(_){/* Keep the original marker when the city lookup is unavailable. */}
    }
    function showMap(links) {
      if(links?.exact===true && Array.isArray(links.coordinates)){cityPreloadAbort?.abort();cityPreloadAbort=null;cityPreloadPending='';cityPreloadKey=selectedCityMapKey();state.draft.mapPin={coordinates:links.coordinates,label:links.label,street:links.street,house:links.house,addressLocality:links.addressLocality || null,mapBoundary:null,serviceBoundary:links.serviceBoundary || null,mapAddress:links.mapAddress || null,needsTerritoryRefresh:links.needsTerritoryRefresh===true,cityKey:links.cityKey || mapCityKey(),base:state.draft.base};const center=links.cityCenter;links={...links,...win.LeadChatMapSearch?.mapLinks(state.draft.base,cityLabel(),links.label || $('address-query').value,links.coordinates,{...(center?{center,zoom:11}:{}),serviceBoundary:links.serviceBoundary,mapAddress:links.mapAddress})};}
      const mapUrl=safeUrl(links?.mapUrl,'map'),external=safeUrl(links?.externalUrl,'map');
      if(mapUrl)navigateMap(mapUrl);
      if(external){$('map-external').href=external;$('map-external').hidden=false;}
      syncMapPreloadLayout();
    }
    function applyAddressSelection(candidate,provider,{keepResolution=false,proofOnly=false,fallback=null}={}){
      const base=state.draft.base;if(!keepResolution)cancelAddressSuggestions();
      if(proofOnly && (text($('street').value)!==text(candidate.street) || text($('house').value)!==text(candidate.house)))return false;
            if((!candidate.street && candidate.addressMode!=='settlement-house') || !candidate.house || candidate.exact===false){
              state.draft.addressConfirmed=false;state.draft.addressProof=null;state.draft.mapPin=null;state.draft.mapCityCenter=null;updateAddressState();
              $('address-query').value=normalizedAddressQuery(candidate.label)+(!candidate.house?', ':'');$('address-query').focus();$('address-results').replaceChildren();$('address-query').setAttribute('aria-expanded','false');showMap(candidate);renderTerritory();return;
            }
            if($('street').disabled || $('house').disabled)return;
            if($('map-distance')?.dataset.state==='unavailable')clearBranchDistance();
            adoptTerritoryCity(candidate.territory);
            if(!proofOnly){$('street').value=candidate.street;$('house').value=candidate.house;
            if(candidate.apartment && !$('apartment').disabled)$('apartment').value=candidate.apartment;
            if(!$('settlement').disabled)$('settlement').value=candidate.settlement || '';
            for(const name of ['street','house','settlement',...(candidate.apartment?['apartment']:[])])state.touched.add(name);}
            state.draft.addressConfirmed=true;state.draft.addressProof={provider:candidate.provider || provider || 'yandex',id:candidate.id || '',label:candidate.label,street:candidate.street,house:candidate.house,exact:true,coordinates:candidate.coordinates,addressLocality:candidate.addressLocality || null,mapBoundary:null,serviceBoundary:candidate.serviceBoundary || null,mapAddress:candidate.mapAddress || null,territory:candidate.territory,base,cityId:$('cityId').value,cityKey:mapCityKey()};
            $('address-query').value=text(candidate.label) || [candidate.city,candidate.street,candidate.house].filter(Boolean).join(', ');$('address-results').replaceChildren();$('address-query').setAttribute('aria-expanded','false');showMap(candidate.mapUrl?candidate:fallback || candidate);renderTerritory(candidate.territory);
            queueSave();updateAddressState();$('map-help').textContent='';
      return true;
    }
    async function searchAddress(event, {suggestionsOnly=false}={}) {
      if(event && !event.isTrusted || state.busy || state.operation || !checkedContext() || $('map-panel').hidden)return;
      clearTimeout(addressSuggestTimer);addressSuggestTimer=null;
      addressChoiceAbort?.abort();addressChoiceAbort=null;++addressChoiceRevision;
      addressAbort?.abort();addressAbort=new AbortController();
      const queryText=normalizedAddressQuery($('address-query').value.trim());
      const generation=state.generation,revision=++state.addressRevision,cityId=$('cityId').value,base=state.draft.base,abort=addressAbort;
      if(!suggestionsOnly && !$('yandex-map').getAttribute('src') && win.LeadChatMapSearch?.mapLinks)showMap(win.LeadChatMapSearch.mapLinks(base,cityLabel(),queryText));
      $('address-search').disabled=!suggestionsOnly;$('address-results').replaceChildren();$('address-query').setAttribute('aria-expanded','false');$('map-help').textContent='Ищем адрес…';if(!suggestionsOnly)renderTerritory();
      try{
        if(!controller?.resolveAddress)throw Error('Поиск карты не загрузился. Обновите расширение.');
        let earlyPreview=null;
        const current=()=>!abort.signal.aborted && generation===state.generation && revision===state.addressRevision && cityId===$('cityId').value && base===state.draft.base && !$('map-panel').hidden;
        const result=await controller.resolveAddress({context:contextFor(),query:queryText,suggestionsOnly,signal:abort.signal,...(!suggestionsOnly?{onAddressResult:partial=>{
          if(!current())return;const selected=win.LeadChatAddress.pickAddressCandidate(partial?.candidates,{query:queryText},cityLabel());if(!selected)return;
          earlyPreview=selected;showMap(selected);renderTerritory({state:'unknown',label:'Проверяем территорию…'});$('address-search').disabled=false;$('map-help').textContent='';
        }}:{})});
        if(generation!==state.generation || revision!==state.addressRevision || cityId!==$('cityId').value || base!==state.draft.base || $('map-panel').hidden)return;
        if(!result || result.ok===false)throw Error(errorText(result));
        const candidates=result.candidates || [];const finalPreview=earlyPreview && candidates.find(item=>item.exact===true && text(item.id)===text(earlyPreview.id));
        if(!suggestionsOnly)showMap(finalPreview || (earlyPreview?earlyPreview:result));
        const comparable=value=>text(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/(?:^|\s)(?:улица|ул\.?)(?=\s|$)/gu,' ').replace(/[^\p{L}\p{N}]+/gu,'');
        const exactCurrent=candidates.length===1 && candidates[0].exact===true && comparable(candidates[0].house)===comparable($('house').value) && comparable(candidates[0].street)===comparable($('street').value) && comparable($('house').value) && comparable($('street').value);
        if(!suggestionsOnly && exactCurrent)applyAddressSelection(candidates[0],result.provider,{keepResolution:true,fallback:result});
        for(const resultCandidate of candidates){
          let candidate=resultCandidate;
          const button=doc.createElement('button');button.type='button';button.className='address-candidate';button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.textContent=candidate.label || [candidate.city,candidate.street,candidate.house].filter(Boolean).join(', ');
          button.addEventListener('click',async event=>{
            if(!event.isTrusted || state.busy || state.operation || recordLocked() || generation!==state.generation || revision!==state.addressRevision || cityId!==$('cityId').value || base!==state.draft.base)return;
            if(candidate.needsResolution){
              const choice=++addressChoiceRevision;addressChoiceAbort?.abort();
              const choiceAbort=new AbortController();addressChoiceAbort=choiceAbort;
              $('address-query').value=text(candidate.query || candidate.label);$('map-help').textContent='Уточняем выбранный адрес…';button.disabled=true;
              try{
                let earlySelection=null;
                const current=()=>choice===addressChoiceRevision && !choiceAbort.signal.aborted && generation===state.generation && revision===state.addressRevision && (earlySelection?.panelCityId || cityId)===$('cityId').value && base===state.draft.base && !$('map-panel').hidden;
                const resolved=await controller.resolveAddress({context:contextFor(),query:candidate.query || candidate.label,suggestionsOnly:false,signal:choiceAbort.signal,onAddressResult:partial=>{
                  if(!current())return;const selected=win.LeadChatAddress.pickAddressCandidate(partial?.candidates,candidate,cityLabel());
                  if(selected && applyAddressSelection(selected,partial.provider,{keepResolution:true,fallback:partial})){earlySelection={...selected,panelCityId:$('cityId').value};$('address-search').disabled=false;}
                }});
                if(!current())return;
                if(!resolved || resolved.ok===false)throw new Error(errorText(resolved));
                const selected=win.LeadChatAddress.pickAddressCandidate(resolved.candidates,candidate,cityLabel());
                if(!selected){if(!earlySelection)void searchAddress(event);return;}
                if(earlySelection){if(text(selected.id)===text(earlySelection.id))applyAddressSelection(selected,resolved.provider,{proofOnly:true,fallback:resolved});return;}
                candidate=selected;
              }catch(error){if(choice===addressChoiceRevision && generation===state.generation && revision===state.addressRevision && !choiceAbort.signal.aborted){$('map-help').textContent=errorText(error);button.disabled=false;}return;}
            }
            applyAddressSelection(candidate,result.provider,{fallback:result});
          });
          button.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelAddressSuggestions();$('address-query').focus();}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...$('address-results').children],index=buttons.indexOf(button);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
          $('address-results').appendChild(button);
        }
        $('address-query').setAttribute('aria-expanded',String(candidates.length>0));$('map-help').textContent=result.notice || '';
      }catch(error){if(generation===state.generation&&revision===state.addressRevision&&!abort.signal.aborted)$('map-help').textContent=errorText(error);}
      finally{if(generation===state.generation&&revision===state.addressRevision)$('address-search').disabled=false;}
    }
    $('close-panel').addEventListener('click', () => { if (permanent) return; cancelAddressSuggestions(); queueSave(); post('leadchat-request-close', {context: state.context}); });
    doc.addEventListener('keydown', event => {
      if(event.key==='Escape' && event.defaultPrevented)return;
      if (event.key === 'Escape' && !permanent) { event.preventDefault(); cancelAddressSuggestions(); queueSave(); post('leadchat-request-close', {context: state.context}); }
      if (event.isTrusted && event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA' && event.target.id !== 'address-query') {
        if (state.mode === 'create' && $('request-form').contains(event.target)) trustedAction = {kind: 'create', at: Date.now()};
        if (state.mode === 'reschedule' && $('reschedule-form').contains(event.target)) trustedAction = {kind: 'reschedule', at: Date.now()};
      }
    });
    $('request-form').addEventListener('input', event => {
      if (!state.draft || ['base','address-query'].includes(event.target.id)) return;
      if (event.target.id) state.touched.add(event.target.id);
      if(event.target.id==='cityId'){cityRoutingTask.cancel(true);automaticCityChoice=null;}
      if(/^phone-extra-[12]$/.test(event.target.id)){event.target.removeAttribute('aria-invalid');renderExtraPhoneIndicator();}
      if(event.target.id==='street'){clearTimeout(streetSplitTimer);streetSplitTimer=null;if(event.inputType==='insertFromPaste' || event.inputType==='insertReplacementText' || text(event.data).length>1)splitStreetHouse();else{const generation=state.generation;streetSplitTimer=win.setTimeout(()=>{streetSplitTimer=null;if(generation===state.generation && !state.busy && !state.operation){splitStreetHouse();queueSave();}},450);}}
      
      if(event.target.id==='cityId')invalidateAddress(false,true,true);else if (['street', 'house', 'settlement'].includes(event.target.id)) invalidateAddress(false,true,state.draft.mapPin?.needsTerritoryRefresh!==true,true);
      if (['time', 'date'].includes(event.target.id)) updateScale();
      if (event.target.id === 'requestType') syncTypeButtons();
      if (event.target.id === 'phone') queuePhoneCheck();
      if (event.target.id === 'comments') {
        state.commentInferenceEdited = true;
        clearTimeout(commentInferenceTimer);
        const generation = state.generation;
        commentInferenceTimer = win.setTimeout(() => {
          commentInferenceTimer = null;
          if (generation === state.generation && !state.busy) inferWorkFromComment(true);
        }, 220);
      }
      queueSave();
    });
    $('request-form').addEventListener('change', event => {
      if (!state.draft) return;
      if (event.target.id) state.touched.add(event.target.id);
      if(event.target.id==='cityId'){cityRoutingTask.cancel(true);automaticCityChoice=null;}
      
      if (event.target.id === 'base') {
        const base=$('base').value,context=structuredCopy(state.context);
        if(BASES.includes(base)){pinAdvertBase(base);if(base!==state.draft.base){const portable=!state.record && !state.operation && state.mode==='create'?portableDraftForBase(base):null;void loadContext({...context,ignoreNamedRequest:true},base,null,portable?.draft || null,portable?.transfer || null);}}
        return;
      }
      if (event.target.id === 'street') {clearTimeout(streetSplitTimer);streetSplitTimer=null;splitStreetHouse();}
      if (event.target.id === 'workId') { state.commentInferenceEdited = true; state.commentAutoWorkId = ''; state.commentAutoServiceId = ''; }
      if (event.target.id === 'serviceId') state.commentAutoServiceId = '';
      if(baseTransfer && ['cityId','workId','serviceId','requestType'].includes(event.target.id)){delete baseTransfer.labels[event.target.id];if(baseTransfer.own){delete baseTransfer.own.values[event.target.id];delete baseTransfer.own.labels[event.target.id];}}
      if (['cityId', 'workId', 'partnerId'].includes(event.target.id)) {
        if (state.preparing) state.dependenciesChangedDuringLoad = true;
        if (event.target.id === 'cityId') retainAddressOnCityChange();
        dependencies();
      }
      syncTypeButtons(); renderBaseReason(); syncBranchDistance(); queueSave();
    });
    $('time-scale').addEventListener('input', event => { const minutes = Math.max(540, Math.min(1350, Math.round(Number($('time-scale').value) / 30) * 30)); $('time').value = minutesToTime(minutes); if (event.isTrusted) state.touched.add('time'); updateScale(); queueSave(); });
    for(const button of $('visit-reason-dialog').querySelectorAll('[data-visit-reason]'))button.addEventListener('click',event=>{
      const target=visitReasonTarget;
      if(!event.isTrusted || !target || target.key!==state.key || target.id!==state.record?.id || target.generation!==state.generation || state.busy || !visitChanged())return;
      $('edit-time-reason').value=button.dataset.visitReason;state.draft.reason=button.dataset.visitReason;state.touched.add('reason');
      closeVisitReason(false);updateScale();queueSave();
    });
    $('visit-reason-dialog').addEventListener('cancel',event=>{event.preventDefault();closeVisitReason(true);});
    $('visit-reason-dialog').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeVisitReason(true);}});
    $('visit-reason-dialog').addEventListener('click',event=>{if(event.target!==$('visit-reason-dialog'))return;const rect=$('visit-reason-dialog').getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)closeVisitReason(true);});
    for (let minutes = 540; minutes <= 1350; minutes += 30) {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.time = minutesToTime(minutes); button.className = 'time-cell'; button.textContent = button.dataset.time; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', event => { if (!event.isTrusted || state.busy && !state.preparing || state.operation) return; $('time').value = button.dataset.time; state.touched.add('time'); updateScale(); $('time-grid').hidden = true; $('time-slots-toggle').setAttribute('aria-expanded','false');$('time').setAttribute('aria-expanded','false'); queueSave(); }); $('time-grid').appendChild(button);
    }
    function toggleTimeList(){
      if($('time').disabled)return;
      const grid=$('time-grid');grid.hidden=!grid.hidden;$('time-slots-toggle').setAttribute('aria-expanded',String(!grid.hidden));
      if(!grid.hidden){
        const input=$('time').getBoundingClientRect(),card=$('time').closest('.time-card').getBoundingClientRect();
        const footer=[...doc.querySelectorAll('.panel-footer:not([hidden])')].map(node=>node.getBoundingClientRect()).find(rect=>rect.height>0&&rect.top>0);
        const lower=Math.min(win.innerHeight-8,footer?.top || win.innerHeight-8),below=lower-input.bottom-6;
        const upwards=below<160 && input.top>180,height=Math.max(100,Math.min(265,upwards?input.top-10:below));
        grid.style.top=(upwards?input.top-card.top-height-4:input.bottom-card.top+4)+'px';
        grid.style.left=(input.left-card.left)+'px';grid.style.maxHeight=height+'px';grid.style.width=Math.max(100,Math.min(140,input.width))+'px';
        const row=grid.querySelector('.selected') || grid.querySelector('[data-time="12:00"]');
        if(row)grid.scrollTop=Math.max(0,row.offsetTop-grid.clientHeight/2+row.clientHeight/2);
      }
    }
    $('time-slots-toggle').addEventListener('click',toggleTimeList);
    $('time').closest('.exact-time').addEventListener('click',event=>{event.preventDefault();if($('time').disabled)return;$('time').focus();toggleTimeList();$('time').setAttribute('aria-expanded',String(!$('time-grid').hidden));});
    $('time').addEventListener('keydown',event=>{if(['Enter',' ','ArrowDown'].includes(event.key)){event.preventDefault();if($('time-grid').hidden)toggleTimeList();$('time').setAttribute('aria-expanded',String(!$('time-grid').hidden));}if(event.key==='Escape'&&!$('time-grid').hidden){event.preventDefault();$('time-grid').hidden=true;$('time').setAttribute('aria-expanded','false');}});
    doc.addEventListener('click',event=>{if(!event.target.closest('.time-card') || event.target.closest('.visit-date')){$('time-grid').hidden=true;$('time-slots-toggle').setAttribute('aria-expanded','false');$('time').setAttribute('aria-expanded','false');}});
    $('expand-panel').addEventListener('click', () => { expanded = !expanded; doc.body.classList.toggle('reference-expanded',expanded); $('expand-panel').textContent = expanded ? '⇥ Свернуть' : '⛶ Развернуть'; post('leadchat-request-expand', {expanded}); });
    for (const button of doc.querySelectorAll('[data-flag]')) button.addEventListener('click', event => {
      if (!event.isTrusted || button.disabled || !state.draft || state.operation || state.mode === 'created') return;
      const flag = button.dataset.flag, descriptor = flagDescriptor(flag);
      if (!descriptor || flag === 'feedback' && state.mode === 'create') return;
      state.draft[flag] = button.dataset.value!==undefined ? button.dataset.value==='1' : !state.draft[flag]; state.draft.extraFields ||= {};
      state.draft.extraFields[descriptor.name || descriptor.key] = flagValue(descriptor, state.draft[flag]);
      if(flag==='callBeforeVisit'){
        const before=$('comments').value,lines=before.replace(/\r\n?/g,'\n').split('\n'),phrase=/Позвонить\s+перед\s+выездом\.[ \t]*/giu;
        let body=lines.map(line=>line.replace(phrase,'')).filter((line,index)=>line.trim() || !/Позвонить\s+перед\s+выездом\./iu.test(lines[index])).join('\n').trim();
        if(state.draft[flag])body=appendUniqueLines(body,['Позвонить перед выездом.']);
        $('comments').value=body;state.draft.comments=body;state.touched.add('comments');
      }
      state.touched.add('flag:' + flag); renderFlags(); queueSave();
    });
    for (const button of doc.querySelectorAll('.base-option[data-base]')) button.addEventListener('click', event => { if (!event.isTrusted || button.disabled) return; $('base').value=button.dataset.base; $('base').dispatchEvent(new Event('change',{bubbles:true})); });
    for(const button of doc.querySelectorAll('[data-intercom]'))button.addEventListener('click',event=>{if(!event.isTrusted||button.disabled||$('intercom').disabled)return;const list=Array.from($('intercom').options).map(option=>({id:option.value,label:option.textContent,disabled:option.disabled}));const value=boolishOptionId(list,button.dataset.intercom);if(!value)return;$('intercom').value=value;state.touched.add('intercom');$('intercom').dispatchEvent(new Event('change',{bubbles:true}));renderFlags();});
    for (const button of doc.querySelectorAll('[data-type]')) button.addEventListener('click', event => { if (!event.isTrusted || button.disabled) return; const list=optionsFor('requestType'); const rx=button.dataset.type==='warranty'?/гарант/i:button.dataset.type==='repeat'?/повтор/i:/вперв|первич/i; const option=list.find(item=>rx.test(item.label)||item.id===button.dataset.type); if (!option) return; $('requestType').value=option.id; $('requestType').dispatchEvent(new Event('change',{bubbles:true})); syncTypeButtons(); });
    for (const [id, hours] of [['plus-one', 1], ['plus-two', 2]]) $(id).addEventListener('click', event => { const result = quickTime(state.clockZone, hours, undefined, state.draft?.urgent===true); if (!result.ok) { showError(result.error); return; } $('date').value = result.date; $('time').value = result.time; if (event.isTrusted) { state.touched.add('date'); state.touched.add('time'); } updateScale(); queueSave(); showError(''); });
    $('source-override').addEventListener('change',event=>{
      if(!event.isTrusted || !state.draft || state.busy || state.operation)return;
      state.draft.sourceOverride=$('source-override').checked;
      if(state.draft.sourceOverride){const current=state.mode==='create'?state.metadata?.defaults || {}:state.draft;state.draft.partnerId=text(current.partnerId);state.draft.sourceCode=text(current.sourceCode || current.partnerComment);$('partnerId').value=state.draft.partnerId;}
      else if(state.mode==='create'){state.draft.partnerId=text(state.metadata?.defaults?.partnerId);state.draft.sourceCode=text(state.metadata?.defaults?.sourceCode);}
      else {state.draft.partnerId=text(state.record?.partnerId);state.draft.partnerComment=text(state.record?.partnerComment);state.draft.sourceCode=state.draft.partnerComment;}
      renderAutomaticSource();setBusy(state.busy);queueSave();
    });
    $('source-choice').addEventListener('change',event=>{if(!state.draft?.sourceOverride)return;state.draft.sourceCode=$('source-choice').value;state.draft.partnerComment=$('source-choice').value;setBusy(state.busy);queueSave();});
    for(const [id,submitAction]of [['create-request',''],['create-clarification','clarify']])$(id).addEventListener('click',event=>{if(event.isTrusted && !$(id).disabled)trustedAction={kind:'create',submitAction,at:Date.now()};});
    $('request-form').addEventListener('submit', event => { event.preventDefault(); if (state.mode === 'create') {if(trustedAction?.kind==='create')trustedAction.submitAction=event.submitter?.id==='create-clarification'?'clarify':'';mutation('create', event);} });
    $('save-request').addEventListener('click', event => { if (event.isTrusted) trustedAction = {kind: 'update', at: Date.now()}; mutation('update', event,null,'save'); });
    $('set-waiting').addEventListener('click',event=>{if(!event.isTrusted || $('set-waiting').disabled || !clarificationRecord())return;trustedAction={kind:'update',at:Date.now()};void mutation('update',event,null,'precheck_to_await');});
    $('restore-request').addEventListener('click',event=>{if(!event.isTrusted||$('restore-request').disabled)return;const action=RESTORE_ACTIONS.map(nativeAction).find(Boolean);if(!action)return;trustedAction={kind:'update',at:Date.now()};void mutation('update',event,null,action.key);});
    $('check-result').addEventListener('click', () => recover());
    $('refresh-record').addEventListener('click', refreshRecord);
    async function openComplaint(event){
      if(!event.isTrusted || $('create-claim').disabled || !state.record || state.record.hasClaim || state.busy || state.operation)return;
      const generation=state.generation,record=state.record,base=record.base,context=contextFor(base);
      showError('');
      claimTarget=state.key+'|'+record.id;setBusy(true,'Открываем форму претензии…');
      try{
        const form=await controller.prepareClaim({context,base,id:record.id});
        if(generation!==state.generation)return;
        if(!form?.ok)throw Error(form?.error || 'Не удалось открыть форму претензии.');
        if(form.already){await refreshRecord();return;}
        const select=$('claim-type');select.replaceChildren(new Option('Выберите тип',''));
        for(const item of form.types || [])select.add(new Option(item.text || item.label,item.id));
        $('claim-comment').value='';$('claim-comment').required=form.commentRequired===true;
        $('claim-form').hidden=false;select.focus();
      }catch(error){if(generation===state.generation)showError(errorText(error));}
      finally{if(generation===state.generation)setBusy(false);}
    }
    $('create-claim').addEventListener('click',openComplaint);
    $('cancel-claim').addEventListener('click',()=>{$('claim-form').hidden=true;claimTarget='';});
    $('cancel-form').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!event.isTrusted || state.busy || state.operation?.state!=='awaiting_reason' || !state.record || !quietFormValidity($('cancel-form')))return;
      if(typeof controller?.saveCancellation!=='function'){showError('Сохранение причины отмены недоступно. Обновите расширение.');return;}
      const operation=structuredCopy(state.operation),snapshot=cancellationSnapshot(operation),reasonId=$('cancel-reason').value,comment=$('cancel-comment').value;
      setBusy(true);showError('');
      try{
        void persist().catch(()=>{});
        if (snapshot.generation !== state.generation || snapshot.key !== state.key) { await persist({...snapshot, record:snapshot.previousRecord, operation:null}); return; }
        const result=await controller.saveCancellation({context:snapshot.context,base:snapshot.previousRecord.base,id:operation.id,operationId:operation.operationId,reasonId,comment});
        await applyResult(result,snapshot);
      }catch(error){await applyResult({ok:false,state:'uncertain',writeStarted:true,error:errorText(error)},snapshot);}
      finally{if(snapshot.generation===state.generation){setBusy(false);renderMode();showRecovery();}}
    });
    $('claim-form').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!event.isTrusted || state.busy || state.operation || !state.record || claimTarget!==state.key+'|'+state.record.id || !quietFormValidity($('claim-form')))return;
      const operation={id:state.record.id,operationId:uniqueOperation(),kind:'update',state:'prepared',createdAt:Date.now()};
      const snapshot={generation:state.generation,key:state.key,context:structuredCopy(contextFor()),draft:structuredCopy(state.draft),previousRecord:structuredCopy(state.record),recordOrigin:state.recordOrigin,lookupDraft:state.lookupDraft,skipAutoOpenPhone:state.skipAutoOpenPhone,metadata:state.metadata,operation,kind:'update',touched:[...state.touched]};
      state.operation=operation;setBusy(true,'Сохраняем претензию…');showError('');
      $('save-claim').disabled=true;$('cancel-claim').disabled=true;
      try{
        void persist().catch(()=>{});
        if (snapshot.generation !== state.generation || snapshot.key !== state.key) { await persist({...snapshot, record:snapshot.previousRecord, operation:null}); return; }
        const result=await controller.createClaim({context:snapshot.context,base:snapshot.previousRecord.base,id:operation.id,operationId:operation.operationId,claimType:$('claim-type').value,comment:$('claim-comment').value});
        await applyResult(result,snapshot);
        if(snapshot.generation===state.generation && acceptedResult(result)){$('claim-form').hidden=true;claimTarget='';notice('Претензия создана.');}
      }catch(error){await applyResult({ok:false,state:'uncertain',writeStarted:true,error:errorText(error)},snapshot);}
      finally{if(snapshot.generation===state.generation){$('save-claim').disabled=false;$('cancel-claim').disabled=false;setBusy(false);renderNativeActions();showRecovery();}}
    });
    $('retry-load').addEventListener('click', () => { if (state.context && !state.busy) {failedBaseKey='';if(state.draft?.base)loadContext(state.context,state.draft.base);else loadAutomaticBase(state.context,'',{refresh:true});} });
    for(const name of ['entrance','floor'])$(name).addEventListener('blur',()=>{if(!state.draft || $(name).disabled)return;$(name).value=text($(name).value).replace(/[\p{White_Space}\uFEFF]/gu,'');queueSave();});
    $('extra-phone-toggle')?.addEventListener('click',event=>{
      if(!event.isTrusted || !state.draft || !extraPhoneDescriptors().length || $('extra-phone-toggle').disabled)return;
      const open=$('extra-phone-toggle').getAttribute('aria-expanded')!=='true';state.draft.extraPhoneExpanded=open;setExtraPhoneExpanded(open,open);queueSave();
    });
    for(const id of ['phone-extra-1','phone-extra-2'])$(id)?.addEventListener('blur',()=>{
      const input=$(id);if(!state.draft || input.disabled)return;
      const info=phoneInfo(input.value);if(info.valid)input.value=info.formatted;queueSave();
    });
    $('retry-phone').addEventListener('click', () => { if (!state.busy && !state.operation && !state.record) { queuePhoneCheck(); clearTimeout(phoneTimer); phoneTimer = null; checkPhone(); } });
    $('native-record-status').addEventListener('click',copyDeliveryStatus);
    $('native-record-status').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ') && deliveryCopyText()){event.preventDefault();void copyDeliveryStatus(event);}});
    $('copy-number').addEventListener('click', async () => { if (!state.record) return; try { await win.navigator.clipboard.writeText(state.record.id); notice('Номер заявки скопирован.'); } catch (_) { showError('Не удалось скопировать номер. Выделите его в заголовке карточки.'); } });
    $('edit-request').addEventListener('click', async () => {
      if (!state.record || state.operation || state.busy) return;
      const generation = state.generation, id = state.record.id;
      setBusy(true, 'Загружаем актуальные поля сохранённой карточки CRM…'); showError('');
      try {
        const metadata = await controller.getMetadata({context: contextFor(), draft: draftFromRecord(state.record), id});
        if (generation !== state.generation) return;
        if (!metadata || metadata.ok === false) throw new Error(errorText(metadata));
        if (metadata.record && text(metadata.record.id) === text(id)) state.record = normalizeRecord({...metadata.record, verified: true, ...(metadata.postSave || state.record.postSave ? {postSave: metadata.postSave || state.record.postSave} : {})}, metadata);
        state.commentInferenceEdited = false; state.touched.delete('workId'); state.touched.delete('serviceId');
        state.mode = 'edit'; state.draft = draftFromRecord(state.record); renderMetadata(metadata); state.loaded = true;
        $('edit-time-reason').value = ''; writeDraft(state.draft); renderMode(); notice('Редактирование сохранённой заявки №' + id + '. Все изменения будут сохранены в CRM.'); $('cityId').focus();
      } catch (error) { if (generation === state.generation) showError(errorText(error)); }
      finally { if (generation === state.generation) { setBusy(false); updateClock(); } }
    });
    $('cancel-edit').addEventListener('click', () => { state.draft = draftFromRecord(state.record); state.mode = 'created'; renderRecord(); notice('Изменения формы не отправлены в CRM.'); persist().catch(error => showError(errorText(error))); });
    $('new-request').addEventListener('click', event => { if (!event.isTrusted || !state.record || state.busy) return; $('followup-choices').hidden = !$('followup-choices').hidden; });
    async function beginFollowup(event,selectedType) {
      if (!event.isTrusted || !state.record || state.operation || state.busy || !checkedContext()) return;
      const selected = selectedType || event.currentTarget.dataset.followup; if (!['repeat','warranty'].includes(selected)) return;
      $('followup-choices').hidden = true;
      const generation = state.generation, originalContext = {...contextFor(state.record.base), base:state.record.base, ignoreNamedRequest:true, clientName: state.record.clientName || state.context.clientName, phone: state.record.phone || state.context.phone}, recordId = state.record.id;
      const previous = draftFromRecord(state.record);
      const sourceCardDraft = {base:previous.base,cityId:previous.cityId,street:previous.street,house:previous.house,apartment:previous.apartment,settlement:previous.settlement,entrance:previous.entrance,floor:previous.floor,intercom:previous.intercom,clientName:previous.clientName,age:previous.age,phone:previous.phone,serviceId:previous.serviceId,workId:previous.workId,comments:appendUniqueLines('',[originalContext.profileComment || originalContext.masterComment]),commentsService:win.LeadPartnerRules.serviceComment('',originalContext.dialogUrl || originalContext.conversationUrl),extraFields:Object.fromEntries(Object.entries(previous.extraFields || {}).filter(([name])=>isAdditionalPhoneField(name))) };
      setBusy(true, 'Готовим новое обращение в этом диалоге…'); showError('');
      try {
        if (!controller?.newRequest) throw Error('CRM не поддерживает новый цикл обращения.');
        const result = await controller.newRequest({context: originalContext, id: recordId});
        if (!result?.ok || !text(result.cycleId)) throw Error(result?.error || 'CRM не закрепила новый цикл обращения. Сохранённая карточка оставлена открытой.');
        if (generation !== state.generation) return;
        state.record = null; state.recordOrigin = ''; state.lookupDraft = null; state.operation = null; state.mode = 'create'; state.touched = new Set();
        state.draft = {...initialDraft(originalContext, originalContext.base), ...sourceCardDraft, base: originalContext.base, creationCycleId: result.cycleId, existingRequestId:recordId, allowDuplicate:true, needsDefaults:true};
        state.skipAutoOpenPhone = phoneInfo(state.draft.phone).canonical;
        void persist().catch(()=>{}); await loadContext(originalContext, originalContext.base, null, structuredCopy(state.draft));
        if(generation+1!==state.generation || scopeKey(originalContext,originalContext.base)!==state.key || state.record || !state.loaded)return;
        applyFollowupType(selected,recordId);
        if (generation + 1 === state.generation) notice('Новая карточка с данными клиента и адресом из заявки №'+recordId+'. Тип: '+(selected==='repeat'?'Повтор':'Гарантия')+'.');
      } catch (error) { if (generation === state.generation) { if (!state.record) { state.loaded = false; renderMode(); $('retry-load').hidden = true; } showError(errorText(error)); } }
      finally { if (generation === state.generation) setBusy(false); }
    }
    function applyFollowupType(selected,recordId) {
      if (state.record || state.operation || !state.draft) return;
      const rx = selected==='repeat'?/повтор/i:/гарант/i;
      const option = optionsFor('requestType').find(item=>rx.test(item.label) || item.id===selected);
      if (!option) { showError('CRM не вернула тип «'+(selected==='repeat'?'Повтор':'Гарантия')+'». Выберите его вручную после загрузки.'); return; }
      state.draft.requestType = option.id;state.draft.existingRequestId=recordId;state.draft.allowDuplicate=true;
      $('requestType').value=option.id; syncTypeButtons();queueSave();
    }
    for (const button of doc.querySelectorAll('[data-followup]')) button.addEventListener('click',beginFollowup);
    $('record-followup').addEventListener('change',event=>{const selected=event.currentTarget.value;event.currentTarget.value='';if(event.isTrusted)beginFollowup(event,selected);});
    $('reschedule-request').addEventListener('click', () => { if (!state.record || state.operation) return; state.mode = 'reschedule'; $('reschedule-date').value = state.record.date || ''; $('reschedule-time').value = state.record.time || ''; $('reschedule-reason').value = ''; renderMode(); $('reschedule-date').focus(); });
    $('cancel-reschedule').addEventListener('click', () => { state.mode = 'created'; renderMode(); });
    $('save-reschedule').addEventListener('click', event => { if (event.isTrusted) trustedAction = {kind: 'reschedule', at: Date.now()}; });
    $('reschedule-form').addEventListener('submit', event => {
      event.preventDefault(); if (!event.isTrusted) return;
      if (!quietFormValidity($('reschedule-form'))) return;
      const minutes = timeToMinutes($('reschedule-time').value); if (!Number.isFinite(minutes)) { showError('Укажите точное время визита в формате ЧЧ:ММ.'); return; }
      mutation('reschedule', event, {date: $('reschedule-date').value, time: $('reschedule-time').value, reason: $('reschedule-reason').value});
    });
    $('price-open').addEventListener('click', event => {
      if(!event.isTrusted || !priceSelectionReady())return;
      const editable=!state.busy&&!state.operation&&!recordLocked()&&!$('comments').disabled;
      const work = optionsFor('workId').find(item => item.id === $('workId').value)?.label || 'выбранные работы';
      const service = optionsFor('serviceId').find(item => item.id === $('serviceId').value)?.label || 'выбранную услугу';
      $('price-modal-title').textContent='Прайс · '+(BASE_LABELS[state.draft.base] || '')+' · '+(state.draft.base==='mnc' && win.LeadChatPriceUI.isMoscowCity(cityLabel())?'(МСК) · ':'')+work;
      const rows=priceRowsForSelection(),isMoscow=win.LeadChatPriceUI.isMoscowCity(cityLabel());
      $('price-modal-help').textContent=rows.length ? (editable?'Нажмите на услугу: сумма добавится в комментарий, окно закроется.':'Прайс выбранных работ и услуг.') : 'Для «'+service+'» нет подтверждённого прайса из подключённого справочника. Цены не подставляются наугад.';
      const list=$('price-list');list.replaceChildren();
      if(!rows.length){const empty=doc.createElement('div');empty.className='price-empty';empty.textContent='Прайс для этого сочетания базы, вида работ и услуги не предоставлен.';list.appendChild(empty);}
      let group='';
      for(const row of rows){
        if(!$('serviceId').value && row.serviceGroup!==group){group=row.serviceGroup;const title=doc.createElement('div');title.className='price-group-title';title.textContent=group;list.append(title);}
        const amount=row.amount;
        if(!amount)continue;
        const button=doc.createElement('button');button.type='button';button.className='price-item';button.disabled=!editable;
        const label=doc.createElement('span');label.textContent=text(row.service)+(row.unit?' · '+text(row.unit):'');
        const value=doc.createElement('span');value.className='price-value';value.textContent=amount;
        if(row.note)button.title=text(row.note);
        button.append(label,value);
        button.addEventListener('click', click => {
          if(!click.isTrusted || recordLocked() || state.busy || state.operation)return;
          const line=win.LeadChatPriceUI?.priceCommentLine(row.service,amount,row.unit) || '';
          if(!line)return;
          $('comments').value=win.LeadChatPriceUI.appendPriceComment($('comments').value,line);
          state.draft.comments=$('comments').value;state.touched.add('comments');
          $('price-modal').close();queueSave();setBusy(false);
        });
        list.appendChild(button);
      }
      $('price-modal').showModal();
    });
    $('price-close').addEventListener('click',()=>{$('price-modal').close();});
    let priceBackdropPointer=false;
    const priceOutside=event=>{const r=$('price-modal').getBoundingClientRect();return event.clientX<r.left || event.clientX>=r.right || event.clientY<r.top || event.clientY>=r.bottom;};
    $('price-modal').addEventListener('pointerdown',event=>{priceBackdropPointer=event.target===$('price-modal') && priceOutside(event);});
    $('price-modal').addEventListener('click',event=>{const dismiss=priceBackdropPointer && event.target===$('price-modal') && priceOutside(event);priceBackdropPointer=false;if(dismiss)$('price-modal').close();});
    for(const type of ['close','cancel','pointercancel'])$('price-modal').addEventListener(type,()=>{priceBackdropPointer=false;});
    for(const name of ['workId','serviceId'])$(name).addEventListener('change',renderPriceAvailability);
    $('map-toggle').addEventListener('click', () => {
      const open = $('map-panel').hidden; $('map-panel').hidden = !open; $('map-toggle').setAttribute('aria-expanded', String(open)); syncMapPreloadLayout();
      if (open) {
        if(!$('address-query').value.trim())$('address-query').value=(win.LeadChatAddress?.normalizeMapCity(cityLabel()) || cityLabel())+' ';
        $('address-query').focus();$('address-query').setSelectionRange($('address-query').value.length,$('address-query').value.length);
        const proof=state.draft.addressProof, pin=state.draft.mapPin;
        if(pin?.base===state.draft.base && pin.cityKey===mapCityKey() && Array.isArray(pin.coordinates) && pin.coordinates.length===2 && pin.coordinates.every(Number.isFinite)){ showMap({...pin,exact:true});if(pin.needsTerritoryRefresh)void refreshPinnedTerritory(pin,{keepBranch:true});else if(state.draft.addressConfirmed && proof?.cityKey===mapCityKey() && territoryProofCurrent(proof))renderTerritory(proof.territory);else if(state.draft.addressConfirmed)void refreshPinnedTerritory(proof||pin);else void recenterSelectedCity();return; }
        if(state.draft.addressConfirmed && proof?.base===state.draft.base && text(proof.cityId)===text($('cityId').value) && Array.isArray(proof.coordinates) && proof.coordinates.length===2 && proof.coordinates.every(Number.isFinite) && Math.abs(proof.coordinates[0])<=180 && Math.abs(proof.coordinates[1])<=90){
          showMap({...proof,exact:true});if(proof.cityKey===mapCityKey() && territoryProofCurrent(proof))renderTerritory(proof.territory);else void refreshPinnedTerritory(proof);$('map-help').textContent='';return;
        }
        $('address-query').focus();
        void previewSelectedCity();
        if(state.draft.manualAddress && !$('street').value && !$('house').value)$('map-help').textContent='Сложный адрес: укажите улицу и дом вручную и проверьте карту.';
        // Never fill or search street/house without explicit operator input.
      }else{cancelAddressSuggestions();}
      syncBranchDistance();
    });
    $('address-search').addEventListener('click', searchAddress);
    $('address-query').addEventListener('input',event=>{
      if(!event.isTrusted)return;cancelAddressSuggestions();
      if($('map-panel').hidden || $('address-query').value.trim().length<3)return;
      const generation=state.generation,revision=state.addressRevision;
      addressSuggestTimer=win.setTimeout(()=>{
        addressSuggestTimer=null;
        if(generation===state.generation && revision===state.addressRevision)void searchAddress(event,{suggestionsOnly:true});
      },350);
    });
    $('address-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchAddress(event);}if(event.key==='ArrowDown'&&$('address-results').firstElementChild){event.preventDefault();$('address-results').firstElementChild.focus();}if(event.key==='Escape'){event.preventDefault();cancelAddressSuggestions();}});
    doc.addEventListener('dblclick',event=>{const link=event.target.closest?.('#record-heading-link');if(!event.isTrusted || !link)return;clearTimeout(headingOpenTimer);headingOpenTimer=null;event.preventDefault();const number=doc.getElementById('record-heading-id');if(number){const range=doc.createRange();range.selectNodeContents(number);const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);}});
    doc.addEventListener('click', async event => {
      const link=event.target.closest?.('a[href]');if(!event.isTrusted || !link)return;const crmUrl=safeUrl(link.href,'crm');if(!crmUrl)return;event.preventDefault();
      const open=async()=>{
      try {
        const response = await chrome.runtime.sendMessage({type:'LP_REQUEST_OPEN_CRM_UPPER',url:crmUrl});
        if (!response?.ok) showError(response?.error || 'Не удалось открыть заявку в этом браузере.');
        else showError('');
      } catch (error) { showError('Не удалось открыть CRM в этом браузере: ' + errorText(error)); }
      };
      if(link.id==='record-heading-link' && event.detail!==0){clearTimeout(headingOpenTimer);headingOpenTimer=null;if(event.detail>1)return;const generation=state.generation,id=state.record?.id;headingOpenTimer=win.setTimeout(()=>{headingOpenTimer=null;const selected=win.getSelection();if(generation!==state.generation || id!==state.record?.id || selected && !selected.isCollapsed && (link.contains(selected.anchorNode)||link.contains(selected.focusNode)))return;void open();},550);return;}
      await open();
    });
    function receiveHostMessage(event) {
      const data = event.data;
      if (!hostOrigin || !channel || event.source !== win.parent || event.origin !== hostOrigin || !data || data.channel !== channel) return;
      if (data.type === 'leadchat-request-context' && data.context && typeof data.context === 'object') updateContext(data.context);
      if(data.type==='leadchat-request-context-pending' && state.context && state.key
        && data.contextKey===[state.context.scope?.key,state.context.conversationId || state.context.chatId,state.context.client?.id].join('|')) {
        clearTimeout(saveTimer);clearTimeout(headingOpenTimer);headingOpenTimer=null;cancelAddressSuggestions();datePicker?.close();closeVisitReason(false);
        contextPending=true;renderAdvertisement(null);setBusy(true);doc.body.inert=true;
      }
      if (data.type === 'leadchat-request-refresh' && data.contextKey === [state.context?.scope?.key,state.context?.conversationId || state.context?.chatId,state.context?.client?.id].join('|')) void refreshRecord({quiet:true});
      if(data.type==='leadchat-request-open-current' && state.context){const record=state.record?.verified===true?state.record:navigationRecord?.scope===scopeKey(state.context,'kp')?navigationRecord.record:null;const url=record&&requestCardUrl(record.base,record.id);if(url)void chrome.runtime.sendMessage({type:'LP_REQUEST_OPEN_CRM_UPPER',url}).then(result=>{if(result?.ok===false)showError(result.error || 'Не удалось открыть заявку.');}).catch(error=>showError(errorText(error)));}
      if (data.type === 'leadchat-request-context-invalid') { cityRoutingTask.cancel(true);automaticCityChoice=null;cityRoutingReady=false;renderAdvertisement(null);contextPending=false;beginCardTransition();clearTimeout(saveTimer); stopPostSave(); if (state.key && state.draft) persist().catch(() => {}); ++state.generation; state.context = null; state.loaded = false; resetAudio(); renderRecordDetails(null); cancelAddressSuggestions(); setBusy(false); $('editable-fields').disabled = true; notice('Подключаем текущий диалог…', false); }
    }
    win.addEventListener('message',receiveHostMessage);
    clockTimer = win.setInterval(updateClock, 15000);
    const refreshVisible = () => {
      if (doc.hidden || state.busy || !contextFlagsValid(state.context)) return;
      if(!state.draft?.base && [resolvingBaseKey,failedBaseKey].includes(baseEvidenceKey(state.context)))return;
      if (state.operation) { const target=recoveryTarget();recoveryAttempts.delete(target);queueRecovery(); }
      else if (!state.loaded) void loadContext(state.context,state.draft?.base);
      else if (state.dependenciesError && !state.dependenciesPending) void dependencies();
      else if (!state.record && state.mode==='create') { if (['error','incomplete'].includes(state.phoneCheck)) queuePhoneCheck(); else armPhoneCheck(); }
      else void refreshRecord({quiet:true});
    };
    refreshTimer = win.setInterval(() => { if (!state.operation && state.loaded) void refreshRecord({quiet:true}); }, 5000);
    win.addEventListener('focus', refreshVisible); doc.addEventListener('visibilitychange', refreshVisible);
    function stopRefresh() { if(!destroyed){destroyed=true;++state.generation;++recordReadRevision;}clearTimeout(commentInferenceTimer);commentInferenceTimer=null;win.removeEventListener('message',receiveHostMessage);cityRoutingTask.cancel(true);cityPreloadAbort?.abort();savedAddressAbort?.abort();clearBranchDistance(); clearInterval(refreshTimer); win.removeEventListener('focus',refreshVisible); doc.removeEventListener('visibilitychange',refreshVisible); }
    win.addEventListener('pagehide', () => { cityCombobox?.destroy();closeVisitReason(false);datePicker?.destroy();clearTimeout(headingOpenTimer);clearTimeout(streetSplitTimer);clearTimeout(saveTimer); clearTimeout(phoneTimer); clearTimeout(recoveryTimer);clearTimeout(streetSplitTimer);cancelAddressSuggestions();clearInterval(clockTimer); stopRefresh(); stopPostSave(); if (state.key && state.draft) persist().catch(() => {}); });
    setBusy(false);
    if (!hostOrigin || !channel || win.parent === win) notice('Панель заявки открывается рядом с текущим диалогом LeadChat.', true);
    else post('leadchat-request-ready', {});
    return {findRequestById,destroy() { cityCombobox?.destroy();closeVisitReason(false);datePicker?.destroy();clearTimeout(headingOpenTimer);clearTimeout(streetSplitTimer);clearTimeout(saveTimer); clearTimeout(phoneTimer); clearTimeout(recoveryTimer);clearTimeout(streetSplitTimer);cancelAddressSuggestions();clearInterval(clockTimer); stopRefresh(); stopPostSave(); }};
  }
  return {cityChangeQuery, preservedCityPin, createCityRoutingTask, bindRussianPhoneInput, phoneFieldValue, latestMatch, mount, normalizeOptions, appendUniqueLines, scopeKey, clockParts, quickTime, cityTimeZone, matchCity, recommendedTime, timeToMinutes, minutesToTime, overdueMinutes, latenessText, phoneInfo, clientFirstName, safeUrl, requestCardUrl, normalizeRecord, mergeRefreshedDraft, commitVerifiedReceipt, recordViewFingerprint, nextRecoveryDelay, canAutoReconcile, shouldSurfaceSaveError};
});

