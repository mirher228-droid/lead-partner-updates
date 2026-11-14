/* LeadChat request context. No authentication, storage, network requests or writes.
 * The page-world bridge returns a whitelist from the app's already loaded cache. */
(function (root, factory) {
  'use strict';
  const api = factory(root.LeadPartnerRules || (typeof module === 'object' && module.exports ? require('./leadpartner-rules.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.LeadChatRequestContext) root.LeadChatRequestContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rules) {
  'use strict';
  const VERSION = '1.0.0', CHANNEL = 'leadpartner-request-context-v1';
  const HOSTS = new Set(['188-225-34-82.sslip.io', '72-56-68-159.sslip.io', 'chat.partner-lead-centre.ru']);
  const ID = /^[A-Za-z0-9_-]{1,100}$/;
  const PHONE_GROUPS = new Set(['3,3,2,2', '3,3,3,1', '3,3,3,2', '3,7', '6,2,2', '3,3,4', '4,3,2,2', '4,7', '4,3,4']);
  const names = new Set(('Александр Алексей Анатолий Андрей Антон Аркадий Арсен Арсений Артур Ахмед Богдан Борис Вадим Валентин Валерий Василий Виктор Виталий Владимир Владислав Вячеслав Геннадий Георгий Герман Глеб Григорий Даниил Данил Данила Денис Дмитрий Евгений Егор Евдоким Ефим Захар Иван Игорь Илья Ильдар Ислам Камиль Карим Кирилл Константин Лев Леонид Макар Максим Марат Марк Матвей Михаил Мурад Назар Никита Николай Олег Павел Пётр Петр Платон Прохор Равиль Рамиль Ринат Роман Ростислав Руслан Рустам Савелий Семён Семен Сергей Станислав Степан Тимофей Тимур Тихон Фёдор Федор Филипп Эдуард Эльдар Эмиль Юрий Яков Ярослав Александра Алёна Алена Алина Алла Анастасия Ангелина Анна Валентина Валерия Варвара Вера Вероника Виктория Галина Дарья Диана Евгения Екатерина Елена Елизавета Жанна Зоя Инна Ирина Карина Кира Кристина Ксения Лариса Лидия Лилия Любовь Людмила Майя Маргарита Марина Мария Милана Надежда Наталья Наталия Нелли Нина Оксана Олеся Ольга Полина Раиса Регина Римма Светлана София Софья Таисия Тамара Татьяна Ульяна Элина Эльвира Юлия Яна').toLocaleLowerCase('ru').split(' '));
  const clean = (value, max = 1000) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g, '').trim().slice(0, max) : '';
  const validId = value => typeof value === 'string' && ID.test(value) ? value : '';
  const itemId = value => validId(value) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '');
  const clientName = value => typeof value === 'string' && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
  // Native LeadChat renders item.url; never substitute a profile or source link.
  function advertisementUrl(value) {
    try {
      const raw = typeof value === 'string' ? value : '';
      if (!raw || raw.length > 4096 || /[\u0000-\u0020\u007f]/.test(raw)) return '';
      const url = new URL(raw);
      return url.protocol === 'https:' && ['avito.ru', 'www.avito.ru'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : '';
    } catch (_) { return ''; }
  }
  function clientFirstName(value) {
    // The CRM form needs the first name, while the real LeadChat name must stay
    // intact for identity checks and for appending an exact created request ID.
    const name = clientName(value).normalize('NFKC');
    const first = /^([\p{L}]+(?:[-\u2010-\u2011'’][\p{L}]+)*)/u.exec(name)?.[1] || '';
    return first.length <= 60 ? first : '';
  }
  function namedRequestId(value) {
    // The newest confirmed request leads the trailing ID chain. The name is
    // still a navigation hint; native CRM data decides the exact card/base.
    const name=clientName(value),trailing=name.match(/(?:^|\s)(?:№\s*)?([1-9]\d{4,8})(?:(?:\s*\/\s*|\s+)(?:№\s*)?[1-9]\d{4,8})*\s*$/u);
    // A native edit may add notes after an ID. Keep the confirmed trailing
    // chain first, then inspect standalone chains before those notes.
    const matches=[trailing,...name.matchAll(/(?<![\p{L}\p{N}_+.\-\u2010-\u2015])(?:№\s*)?([1-9]\d{4,8})(?:(?:\s*\/\s*|\s+)(?:№\s*)?[1-9]\d{4,8})*(?![\p{L}\p{N}_+]|[.\-\u2010-\u2015]\d)/gu)];
    // Check complete phones at whole digit-group boundaries. Separate phones
    // in the same numeric run must not turn each other's groups into IDs.
    const phones=[];
    for(const run of name.matchAll(/[+(\d][\d\s().\-\u2010-\u2015]*/gu)){
      const groups=[...run[0].matchAll(/\d+/g)];
      for(let start=0;start<groups.length;start++){
        const first=groups[start],previous=start?groups[start-1].index+groups[start-1][0].length:0;
        const opening=run[0].slice(previous,first.index).match(/[+(][\s(]*$/u)?.[0] || '';
        let digits=0,lastPhone=-1;
        for(let end=start;end<groups.length;end++){
          digits+=groups[end][0].length;if(digits>11)break;if(digits<10)continue;
          const last=groups[end].index+groups[end][0].length,closing=run[0].slice(last).match(/^[\s)]*/u)[0];
          if(normalizePhone(run[0].slice(first.index-opening.length,last+closing.length)))lastPhone=end;
        }
        if(lastPhone>=start){const last=groups[lastPhone];phones.push([run.index+first.index,run.index+last.index+last[0].length]);start=lastPhone;}
      }
    }
    for(const match of matches){
      if(!match)continue;
      for(const token of match[0].matchAll(/[1-9]\d{4,8}/gu)){
        const start=match.index+token.index,end=start+token[0].length;
        if(!phones.some(phone=>start>=phone[0] && end<=phone[1]))return token[0];
      }
    }
    return '';
  }
  const copy = value => JSON.parse(JSON.stringify(value));

  function currentDialog(raw) {
    try {
      const url = new URL(raw === undefined ? globalThis.location.href : raw);
      const match = /^\/chats\/([A-Za-z0-9_-]{1,100})\/?$/.exec(url.pathname);
      if (!HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !match) return null;
      return { conversationId: match[1], conversationUrl: url.origin + '/chats/' + match[1] };
    } catch (_) { return null; }
  }

  function profileInfo(raw, workTitle = '') {
    const profileFullTitle = clean(raw);
    const profileTitle = profileFullTitle.split(/[·•|]/, 1)[0].replace(/\s+/g, ' ').trim();
    const matches = [...profileTitle.toUpperCase().matchAll(/(^|[^\p{L}\p{N}])(КП|МНЧ|БТ)(?=$|[^\p{L}\p{N}])/gu)];
    const map = { КП: 'kp', МНЧ: 'mnc', БТ: 'bt' };
    // Native header tags describe the candidate set. Use the same deterministic
    // decision as the panel for the chosen base and the manual-choice warning.
    const baseCandidates = rules?.baseCandidates?.({profileFullTitle}) || [...new Set(matches.map(match => map[match[2]]))];
    const resolution = rules?.resolveBase?.({profileFullTitle,profileTitle,workTitle:clean(workTitle,400),baseCandidates},baseCandidates);
    const base = resolution ? resolution.base : baseCandidates.length === 1 ? baseCandidates[0] : '';
    let label = profileTitle.replace(/(?:\s+|\s*[-–—]\s*)(?:КП|МНЧ|БТ)(?:\s*[-–—/]\s*(?:КП|МНЧ|БТ))*\s*$/iu, '').trim();
    if (/[<>]/.test(label) || label.length > 100) label = '';
    const first = label.replace(/^(?:Мс|Мастер)\s+/iu, '').split(/\s+/)[0];
    const masterComment = label && names.has(first.toLocaleLowerCase('ru')) ? 'Мс ' + first : label;
    return { profileTitle, profileComment: profileTitle, masterComment, base, baseCandidates, requiresBaseChoice: resolution ? resolution.requiresManual : baseCandidates.length !== 1 };
  }

  function normalizePhone(value) {
    // CRM uses the national ten digits, not E.164. This validates one complete
    // value; it never removes arbitrary letters or takes a suffix of a long ID.
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return '';
    let text = String(value).normalize('NFKC').trim();
    if (!text || text.length > 120 || /[^\d+().\-\u2010-\u2015 \t]/u.test(text)) return '';
    const calendar = text.replace(/[ \t]*([.-])[ \t]*/g, '$1');
    if (/^(?:0?[1-9]|[12]\d|3[01])[.-](?:0?[1-9]|1[0-2])[.-](?:(?:19|20)\d{2}|\d{2})(?=$|[^\d])/u.test(calendar)) return '';
    text = text.replace(/[\u2010-\u2015]/g, '-').replace(/[ \t]/g, '');
    if (/^\(\d{10,11}\)$/.test(text)) text = text.slice(1, -1);
    if (!/^\+?[\d(][\d().-]*\d$/.test(text) || /[.-]{2}/.test(text) || text.startsWith('+') && !text.startsWith('+7')) return '';
    if (/[()]/.test(text) && (!/^([^()]*)\(\d{3}\)([^()]*)$/.test(text))) return '';
    const digits = text.replace(/\D/g, '');
    const national = /^[78]\d{10}$/.test(digits) ? digits.slice(1) : /^\d{10}$/.test(digits) && !text.startsWith('+') ? digits : '';
    // Russian national prefixes: geographic 3/4/8 and mobile 9. An allocated
    // subscriber or an active line cannot be established from syntax alone.
    return /^[3489]\d{9}$/.test(national) ? national : '';
  }

  function phonesInText(value) {
    // Line breaks inside one incoming message are phone separators too. The
    // existing whole-run validation still rejects leftover digits and dates;
    // this does not combine separate messages or broaden their time window.
    const text = value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, match => ' '.repeat(match.length)).replace(/\r?\n/g, ' ');
    const out = [];
    function candidate(raw, multiple = false) {
      const phone = normalizePhone(raw);
      if (!phone) return '';
      const groups = raw.match(/\d+/g) || [], shape = groups.map(group => group.length).join(',');
      const countrySeparated = groups[0]?.length === 1 && /^[78]$/.test(groups[0]) && groups.join('').length === 11;
      const individual = groups.every(group => group.length === 1);
      return groups.length === 1 || PHONE_GROUPS.has(shape) || countrySeparated && (!multiple || !individual) || !multiple && individual ? phone : '';
    }
    for (const match of text.matchAll(/[+(\d][\d().\-\u2010-\u2015 \t\u00a0\u202f]*/gu)) {
      const raw = match[0].replace(/[.\-\u2010-\u2015 \t\u00a0\u202f]+$/u, '');
      const before = text[match.index - 1] || '', after = text[match.index + raw.length] || '';
      if (/[\p{L}\p{N}_+.\-\u2010-\u2015\u2212]/u.test(before) || /[\p{L}\p{N}_+]/u.test(after)) continue;
      const single = candidate(raw);
      if (single) { out.push(single); continue; }
      // A run containing several complete phones can be split only at whole
      // digit-group boundaries. Every part must be a full phone; leftover dates,
      // apartment numbers, or an extra digit invalidate the run as a whole.
      const groups = [...raw.matchAll(/\d+/g)];
      if (groups.length < 2 || groups.length > 24 || raw.length > 240) continue;
      const solutions = [];
      function split(start, parts) {
        if (solutions.length > 1 || parts.length >= 4) return;
        let digits = 0;
        for (let end = start; end < groups.length; end++) {
          digits += groups[end][0].length;
          if (digits > 11) break;
          if (digits < 10) continue;
          const last = end === groups.length - 1;
          const boundary = last ? raw.length : groups[end].index + groups[end][0].length;
          const gap = last ? '' : raw.slice(boundary, groups[end + 1].index);
          if (!last && !/^[ \t\u00a0\u202f]+$/u.test(gap)) continue;
          const part = candidate(raw.slice(start ? groups[start].index : 0, boundary), true);
          if (!part) continue;
          if (last) { if (parts.length) solutions.push([...parts, part]); }
          else split(end + 1, [...parts, part]);
        }
      }
      split(0, []);
      if (solutions.length === 1) out.push(...solutions[0]);
    }
    return out;
  }

  function normalizeMessages(messages) {
    const unique = new Map();
    for (const raw of (Array.isArray(messages) ? messages : []).slice(-500)) {
      if (!raw || typeof raw !== 'object') continue;
      const body = clean(raw.body, 8000);
      const transcript = /^(ready|done|completed|success|succeeded)$/i.test(raw.voice_transcript_status || '') ? clean(raw.voice_transcript, 8000) : '';
      const message = { id: validId(raw.id), direction: clean(raw.direction, 16), senderType: clean(raw.sender_type || raw.senderType, 24), body: body && transcript && body !== transcript ? body + '\n' + transcript : body || transcript,
        authorId: validId(raw.sender?.id) || validId(raw.author?.id) || validId(raw.author_id) || validId(raw.authorId) || validId(raw.sender_user_id) || validId(raw.sender_id), isInternal: raw.is_internal === true || raw.isInternal === true,
        createdAt: clean(raw.created_at || raw.createdAt, 40) };
      const key = message.id || JSON.stringify([message.createdAt, message.direction, message.senderType, message.body]);
      unique.set(key, message);
    }
    // UUID ordering is not message ordering. Preserve the native cache order
    // when two messages share the same timestamp.
    return [...unique.values()].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  }

  function fragmentedPhones(messages) {
    const out = [];
    let block = [];
    function flush() {
      if (block.length < 2 || block.length > 11) { block = []; return; }
      const digits = block.map(message => message.body.replace(/\D/g, ''));
      const joined = digits.join(''), groups = digits.map(part => part.length).join(',');
      // A full, recognisable mobile number block only. Arbitrary 4+7 splits,
      // extra digits, dates, and overlapping suffixes are not guessed.
      const normalized = normalizePhone(block.map(message => message.body).join(' '));
      const national = /^(?:[78])?9\d{9}$/.test(joined) && /^9\d{9}$/.test(normalized) ? normalized : '';
      const shape = digits.every(part => part.length === 1) || ['3,3,2,2', '3,3,3,1', '3,3,4', '1,3,3,2,2', '1,3,3,3,1', '1,3,3,4'].includes(groups);
      if (national && shape) out.push({ value: national, messageId: block.at(-1).id, messageIds: block.map(message => message.id), source: 'fragments' });
      block = [];
    }
    for (const message of messages) {
      const body = message.body.trim(), stamp = Date.parse(message.createdAt);
      const piece = message.direction === 'in' && ['client', 'customer', ''].includes(message.senderType) &&
        /^\+?[\d().\-\u2010-\u2015 \t\u00a0\u202f]+$/u.test(body) &&
        body.replace(/\D/g, '').length > 0 && body.replace(/\D/g, '').length < 10 && Number.isFinite(stamp);
      if (!piece) { flush(); continue; }
      if (block.length && (stamp - Date.parse(block.at(-1).createdAt) > 90_000 || stamp - Date.parse(block[0].createdAt) > 180_000 || body.startsWith('+'))) flush();
      block.push(message);
    }
    flush();
    return out;
  }

  function extractProposals(input) {
    const messages = normalizeMessages(input), phones = [], apartments = [], addresses = [], entrances = [], floors = [], settlements = [], microdistricts = [];
    for (const message of messages) {
      if (message.direction !== 'in' || !['client', 'customer', ''].includes(message.senderType)) continue;
      const text = message.body;
      for (const value of phonesInText(text)) phones.push({ value, messageId: message.id });
      const parsed=globalThis.LeadChatAddress?.parseSimpleAddress(text);
      if(!parsed||parsed.manual)continue;
      for(const [name,list]of [['address',addresses],['apartment',apartments],['entrance',entrances],['floor',floors]])if(parsed[name])list.push({value:parsed[name],messageId:message.id});
    }
    phones.push(...fragmentedPhones(messages));
    const distinct = list => [...new Map(list.map(item => [item.value, item])).values()];
    const p = distinct(phones), a = distinct(apartments), d = distinct(addresses), e = distinct(entrances), f = distinct(floors), s = distinct(settlements), m = distinct(microdistricts);
    return { phone: p.length === 1 ? p[0].value : '', apartment: a.length === 1 ? a[0].value : '', address: d.length === 1 ? d[0].value : '',
      entrance: e.length === 1 ? e[0].value : '', floor: f.length === 1 ? f[0].value : '', settlement: s.length === 1 ? s[0].value : '', microdistrict: m.length === 1 ? m[0].value : '',
      candidates: { phones: p, apartments: a, addresses: d, entrances: e, floors: f, settlements: s, microdistricts: m },
      ambiguous: { phone: p.length > 1, apartment: a.length > 1, address: d.length > 1, entrance: e.length > 1, floor: f.length > 1, settlement: s.length > 1, microdistrict: m.length > 1 } };
  }

  function derive(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const dialog = currentDialog(raw.conversationUrl);
    if (!dialog || dialog.conversationId !== raw.conversationId) return { ok: false, code: 'route', error: 'Диалог изменился. Откройте создание ещё раз.' };
    const client = raw.client || {}, account = raw.account || {}, item = raw.item || {}, adId = itemId(item.id);
    const operatorId = validId(raw.operatorId), accountId = validId(account.id), clientId = validId(client.id);
    const operatorName = operatorId && typeof raw.operatorName === 'string' && raw.operatorName.trim().length <= 120 && !/[\u0000-\u001f\u007f]/.test(raw.operatorName) && !/[\ud800-\udfff]/u.test(raw.operatorName) ? raw.operatorName.trim() : '';
    if (!clientId) return { ok: false, code: 'loading', ...dialog, error: 'Карточка клиента LeadChat ещё не загружена. Дождитесь её появления и повторите.' };
    const messages = normalizeMessages(raw.messages), proposals = extractProposals(messages), warnings = [];
    const cardPhone = normalizePhone(client.phone);
    const phoneConflict = client.link_phone_conflict === true || !!(cardPhone && proposals.phone && cardPhone !== proposals.phone) || proposals.ambiguous.phone;
    if (!operatorId || !accountId) warnings.push('Не удалось определить сотрудника или канал. Сохранение недоступно до загрузки контекста.');
    if (phoneConflict) warnings.push('Номера телефона расходятся. Выберите или введите номер клиента.');
    if (raw.messagesIncomplete) warnings.push('Загружена только часть переписки. Предложения основаны на видимых приложению сообщениях.');
    const profile = profileInfo(account.title, item.title);
    if (profile.requiresBaseChoice) warnings.push('Выберите базу заявки.');
    const scope = { operatorId, accountId, key: operatorId && accountId ? new URL(dialog.conversationUrl).origin + '|' + operatorId + '|' + accountId + '|' + dialog.conversationId : '' };
    return { ok: true, ...dialog, scope, operatorName, clientFirstName: clientFirstName(client.name), client: { id: clientId, name: clientName(client.name), phone: phoneConflict ? '' : (proposals.phone || cardPhone), phoneConflict }, ...profile,
      adUrl: advertisementUrl(item.url), ...(adId ? {adId} : {}),profileFullTitle:clean(account.title,1000),workTitle: clean(item.title, 400), namedRequestId: namedRequestId(client.name), partner: clean(String(account.lead_partner_number || ''), 30), source: clean(account.lead_origin, 200), city: clean(item.city_name, 120) || clean(item.city_slug, 120), cityTimezone: clean(item.city_tz, 80),
      messages, proposals, warnings, revision: Number(raw.revision) || 0, observedAt: Date.now() };
  }

  function createDraft(context) {
    let key = '', values = {}, edited = new Set();
    const fields = ctx => ({ name: ctx.clientFirstName || clientFirstName(ctx.client.name), phone: ctx.client.phone, base: ctx.base, partner: ctx.partner, source: ctx.source, city: ctx.city,
      masterComment: ctx.masterComment, profileComment: ctx.profileComment, conversationUrl: ctx.conversationUrl, address: ctx.proposals.address, apartment: ctx.proposals.apartment,
      entrance: ctx.proposals.entrance || '', floor: ctx.proposals.floor || '', settlement: ctx.proposals.settlement || '', microdistrict: ctx.proposals.microdistrict || '', age: 31 });
    function apply(ctx) {
      if (!ctx || !ctx.ok) return copy(values);
      const nextKey = (ctx.scope.key || ctx.conversationUrl + '|unknown') + '|' + (ctx.client?.id || '');
      if (key !== nextKey) { key = nextKey; edited = new Set(); values = {}; }
      for (const [field, value] of Object.entries(fields(ctx))) if (!edited.has(field)) values[field] = value;
      return copy(values);
    }
    if (context) apply(context);
    return Object.freeze({ get: () => copy(values), apply, setManual(field, value) {
      if (!Object.prototype.hasOwnProperty.call(values, field)) throw new Error('Неизвестное поле черновика');
      edited.add(field); values[field] = typeof value === 'string' ? clean(value, 8000) : value; return copy(values);
    } });
  }

  function planAppendCreatedId(context, requestId) {
    const id = typeof requestId === 'number' && Number.isSafeInteger(requestId) ? String(requestId) : requestId;
    if (!context?.ok || !context.scope?.key || !validId(context.client?.id) || typeof id !== 'string' || !/^[1-9]\d{0,11}$/.test(id)) return { ok: false, code: 'context', error: 'Нет подтверждённого номера заявки или контекста клиента.' };
    const name = clientName(context.client.name);
    if (!name) return { ok: false, code: 'name', error: 'Имя клиента ещё не загружено.' };
    const present = new RegExp('(?:^|\\s)(?:№\\s*)?' + id + '(?=$|\\s)').test(name);
    // Preserve previous names and request numbers; append only the exact saved ID.
    return { ok: true, changed: !present, method: 'PUT', path: '/api/v1/clients/' + encodeURIComponent(context.client.id) + '/name', body: { name: present ? name : name + ' ' + id },
      expected: { conversationId: context.conversationId, clientId: context.client.id, clientName: name, operatorId: context.scope.operatorId, accountId: context.scope.accountId, requestId: id } };
  }

  function createAdapter(options = {}) {
    const win = options.window || globalThis.window;
    const pending = new Map(), listeners = new Set(), identityListeners = new Set();
    let destroyed = false, sequence = 0, identitySequence = 0, route = win.location.href, refreshTimer = null, identityTimer = null, counter = 0;
    const timeoutMs = Number(options.timeoutMs) || 5000;
    function receive(event) {
      const message = event.data;
      if (event.source !== win || event.origin !== win.location.origin || message?.channel !== CHANNEL) return;
      if (message.kind === 'changed') { schedule(); return; }
      if (message.kind === 'identity-changed') { identitySequence++; scheduleIdentity(); return; }
      if (message.kind !== 'response' || !pending.has(message.id)) return;
      const entry = pending.get(message.id); pending.delete(message.id); win.clearTimeout(entry.timer); entry.resolve(message.result);
    }
    function request(conversationId, action = 'read') {
      if (action === 'read' && options.request) return options.request(conversationId);
      return new Promise(resolve => {
        const id = 'context-' + (win.crypto?.randomUUID?.() || Date.now() + '-' + (++counter));
        const timer = win.setTimeout(() => { pending.delete(id); resolve({ ok: false, code: 'timeout', error: 'Контекст LeadChat ещё не загружен. Повторите через несколько секунд.' }); }, timeoutMs);
        pending.set(id, { resolve, timer, action });
        win.postMessage({ channel: CHANNEL, kind: 'request', action, id, ...(action === 'read' ? { conversationId } : {}) }, win.location.origin);
      });
    }
    async function read() {
      const ownSequence = ++sequence, dialog = currentDialog(win.location.href);
      if (destroyed || !dialog) return { ok: false, code: 'route', error: 'Откройте диалог LeadChat.' };
      let raw;
      try { raw = await request(dialog.conversationId); } catch (_) { raw = { ok: false, code: 'unavailable', error: 'Не удалось прочитать контекст LeadChat.' }; }
      if (destroyed || ownSequence !== sequence || currentDialog(win.location.href)?.conversationUrl !== dialog.conversationUrl) return { ok: false, code: 'stale', error: 'Диалог изменился.' };
      if (raw?.ok !== true) return raw || { ok: false, code: 'unavailable' };
      return derive({ ...raw, conversationUrl: dialog.conversationUrl });
    }
    async function readIdentity() {
      const ownSequence = ++identitySequence;
      if (destroyed) return { ok: false, code: 'destroyed' };
      let raw;
      try { raw = await request('', 'read-identity'); } catch (_) { return { ok: false, code: 'unavailable' }; }
      if (destroyed || ownSequence !== identitySequence) return { ok: false, code: 'stale' };
      if (raw?.ok !== true) return { ok: false, code: raw?.code === 'timeout' ? 'timeout' : 'unavailable' };
      const { operatorId, displayName, presence } = raw;
      const signedOut = operatorId === '' && displayName === '' && presence === '';
      if ((!signedOut && !validId(operatorId)) || typeof displayName !== 'string' || displayName !== displayName.trim() || displayName.length > 120
        || /[\u0000-\u001f\u007f]/.test(displayName) || /[\ud800-\udfff]/u.test(displayName) || !['','online','away'].includes(presence)) return { ok: false, code: 'unavailable' };
      return { ok: true, operatorId, displayName, presence };
    }
    function scheduleIdentity() {
      if (destroyed || !identityListeners.size || identityTimer !== null) return;
      identityTimer = win.setTimeout(async () => {
        identityTimer = null;
        const value = await readIdentity();
        if (destroyed || value.code === 'stale') return;
        for (const listener of identityListeners) { try { listener(value); } catch (_) {} }
      }, 60);
    }
    function schedule() {
      if (destroyed || !listeners.size || refreshTimer !== null) return;
      refreshTimer = win.setTimeout(async () => {
        refreshTimer = null;
        const value = await read();
        if (destroyed || value.code === 'stale') return;
        for (const listener of listeners) { try { listener(value); } catch (_) { /* One panel must not stop another. */ } }
      }, 60);
    }
    const checkRoute = () => { if (route !== win.location.href) {
      route = win.location.href; sequence++;
      // Do not hold the host's serial refresh queue until the old route's RPC
      // timeout. Its later response is ignored after removal from this map.
      for (const [id, entry] of pending) { if (entry.action !== 'read') continue; win.clearTimeout(entry.timer); entry.resolve({ ok: false, code: 'stale', error: 'Диалог изменился.' }); pending.delete(id); }
      schedule();
    } };
    win.addEventListener('message', receive); win.addEventListener('popstate', checkRoute); win.addEventListener('hashchange', checkRoute);
    const routeTimer = win.setInterval(checkRoute, 300);
    return Object.freeze({ read, readIdentity,
      subscribeIdentity(listener) { if (typeof listener !== 'function') throw new TypeError('Нужен обработчик'); identityListeners.add(listener); return () => identityListeners.delete(listener); },
      subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('Нужен обработчик'); listeners.add(listener); schedule(); return () => listeners.delete(listener); },
      destroy() { destroyed = true; sequence++; identitySequence++; listeners.clear(); identityListeners.clear(); win.clearInterval(routeTimer); win.clearTimeout(refreshTimer); win.clearTimeout(identityTimer); win.removeEventListener('message', receive); win.removeEventListener('popstate', checkRoute); win.removeEventListener('hashchange', checkRoute);
        for (const entry of pending.values()) { win.clearTimeout(entry.timer); entry.resolve({ ok: false, code: 'destroyed' }); } pending.clear(); } });
  }
  return Object.freeze({ VERSION, CHANNEL, currentDialog, profileInfo, clientFirstName, namedRequestId, normalizePhone, normalizeMessages, extractProposals, derive, createDraft, createAdapter, planAppendCreatedId });
});
