/* Conservative Avito recognition. No network or Telegram calls. */
(() => {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKC').replace(/ё/gi, 'е').replace(/,/g,' ').replace(/\s+/g, ' ').trim().toLowerCase();
  // Only the recipient's exact full name is authoritative. An abbreviated row
  // is consistent evidence only when the saved request also confirms its ID.
  const authorMatches = value => {
    const name = normalize(value).replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ');
    return name === 'биктимиров захар' || /^биктимиров з(?: [а-я])?$/u.test(name);
  };
  const MIGRATION_SINCE_KEY = Date.UTC(2026,9,1); // Only for importing the former schema; never a polling boundary.
  const OWNER_IDS = Object.freeze({});
  const validId = value => /^[1-9]\d{0,14}$/.test(String(value)) && Number.isSafeInteger(Number(value));
  function sourceEmptyDeadline(record) {
    if (record?.status !== 'waiting_source' || record.reasonCode !== 'source-empty') return 0;
    const since = Number.isFinite(record.sourceEmptySince) && record.sourceEmptySince > 0 ? record.sourceEmptySince : record.discoveredAt;
    return Number.isFinite(since) && since > 0 ? since + 60000 : 0;
  }
  function isVisibleRecord(record, now = Date.now()) {
    const deadline=sourceEmptyDeadline(record);
    // Missing timestamps must never conceal an actual error.
    return !deadline || !Number.isFinite(now) || now < deadline;
  }
  function createdKey(value) {
    const m = String(value || '').match(/\b(\d{2})\.(\d{2})\.(\d{4}|\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?\b/);
    if (!m) return null;
    const year = Number(m[3]) + (m[3].length === 2 ? 2000 : 0), month = Number(m[2]), day = Number(m[1]);
    const hour = Number(m[4] || 0), minute = Number(m[5] || 0), second = Number(m[6] || 0);
    const key = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(key);
    if (year < 2000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || date.getUTCDate() !== day) return null;
    return key; // A comparable CRM wall-clock value; no client/server timezone assumptions.
  }
  function codes(value) {
    const text = String(value || '').normalize('NFKC').toUpperCase().replace(/[\u00a0\u202f]/g,' ');
    const found = [];
    for (const m of text.matchAll(/(?<![A-ZА-ЯЁ0-9_.])([A-ZА-ЯЁ]{1,3})\s*(\d{1,6}(?:\.\d{1,3})?)(?![A-ZА-ЯЁ0-9_.]|\s*\.\s*\d)/g)) {
      found.push(m[1] + m[2]);
    }
    return [...new Set(found)];
  }
  const namedPatterns = () => [
    {code:'748 Авито ДБ',pattern:/(?<![А-ЯЁA-Z0-9_.])748\s+(?:ПАРТН[ЕЁ]Р\s*[-:]?\s*)?АВИТО(?:\s+ДБ)?(?![А-ЯЁA-Z0-9_.])/gu},
    {code:'748 Источник №3',pattern:/(?<![А-ЯЁA-Z0-9_.])748\s+(?:ПАРТН[ЕЁ]Р\s*[-:]?\s*)?ИСТОЧНИК\s*(?:№|NO)\s*3(?![А-ЯЁA-Z0-9_.])/gu}
  ];
  function sourceCodes(value) {
    let text=String(value || '').normalize('NFKC').toUpperCase();const found=[];
    for(const named of namedPatterns())text=text.replace(named.pattern,()=>{found.push(named.code);return ' ';});
    text=text.replace(/ИСТОЧНИК\s*(?:№|NO)\s*\d+/gu,' ');
    return [...new Set([...codes(text),...found])];
  }
  function canonicalSourceCode(value) {
    const text=String(value || '').normalize('NFKC').toUpperCase().replace(/\s+/g,' ').trim();
    const special=globalThis.LeadPartnerRules?.specialSource(value,'748');
    if(special)return special.code;
    if(text==='748 АВИТО'||text==='748 АВИТО ДБ')return '748 Авито ДБ';
    if(/^748 ИСТОЧНИК (?:№|NO)\s*3$/.test(text))return '748 Источник №3';
    return /^(?:[A-ZА-ЯЁ]{1,3}\d{1,6}(?:\.\d{1,3})?|\d{1,20})$/.test(text)&&text!=='748'?text:'';
  }
  const partner748Matches=value=>/^(?:(?:парт|партнер|партнёр)\s+)?748(?:\s+(?:парт|партнер|партнёр))?$/iu.test(String(value || '').normalize('NFKC').replace(/\s*\(\d+\)\s*$/,'').trim());
  function canonicalUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.toString().replace(/\/$/, '');
    } catch (_) { return ''; }
  }
  function catalog(sources,base) {
    const result = new Map(), entries = [], owners = new Map(), blocked = new Set(), ambiguousIds = new Set();
    for (const entry of Array.isArray(sources) ? sources : []) {
      if (entry.confirmed === false || ['missing','review','conflict'].includes(entry.status) || entry.manualDeleted) continue;
      const url = canonicalUrl(entry?.url);
      if (!url) continue;
      const primary = sourceCodes(entry.code || entry.label);
      // A saved entry must have one unambiguous actual source code in its label.
      const numericCode = /^\d{1,20}$/.test(String(entry.code || '')) ? String(entry.code) : String(entry.externalId || '');
      if (primary.length > 1 || (!primary.length && !/^\d{1,20}$/.test(numericCode))) continue;
      const code = primary[0] || numericCode;
      const externalIds = [...new Set([entry.externalId,...(entry.externalIds || [])].filter(value => typeof value==='string'&&/^\d{1,20}$/.test(value)))].filter(id=>{
        if(!['kp','mnc','bt'].includes(base))return true;
        const refs=(entry.externalRefs||[]).filter(ref=>String(ref.id)===id),sourceBases=entry.sourceBases||[];
        return (refs.length?refs:[{base:''}]).some(ref=>ref.base?ref.base===base:!sourceBases.length||sourceBases.includes(base));
      });
      const aliases = [...new Set([code, ...(Array.isArray(entry.aliases) ? entry.aliases.flatMap(value => canonicalSourceCode(value) ? [canonicalSourceCode(value)] : sourceCodes(value)) : []),...externalIds].filter(value=>value!=='748'&&(!/^\d{1,20}$/.test(value)||externalIds.includes(value))))];
      const candidate = { source:code,url,externalId:String(entry.externalId || ''),externalIds,aliases,signature:code+'|'+url };entries.push(candidate);
      for (const alias of aliases) {
        const old = owners.get(alias);
        if (old && old.signature !== candidate.signature) {
          if(/^\d{1,20}$/.test(alias))ambiguousIds.add(alias);
          else {blocked.add(old.signature);blocked.add(candidate.signature);}
        }
        else if (!old) owners.set(alias,candidate);
      }
    }
    for (const entry of entries) for (const alias of entry.aliases) {
      if (blocked.has(entry.signature) || ambiguousIds.has(alias)) result.set(alias,{ambiguous:true});
      else if (!result.has(alias)) result.set(alias,entry);
    }
    return result;
  }
  function partnerMatches(value) {
    // CRM foreign keys are NOT partner codes. Only the selected option label counts.
    return /^(?:(?:партнер|партнёр)\s+)?(?:007|7|723|748)(?:\s+(?:партнер|партнёр))?$/i.test(String(value || '').trim());
  }
  // Ownership is checked independently of the source. A selected CRM list filter
  // alone does not establish ownership: some installations return foreign rows.
  function verifiedOwner(row, detail, expectedAuthorId) {
    // The author column belongs to this particular CRM request. A filter
    // selection or a field in another part of the page never overrides a
    // different creator in that column. Fail closed on contradictory evidence.
    if (!/^[1-9]\d*$/.test(String(expectedAuthorId || '')) || !authorMatches(row?.author)) return false;
    if (detail?.creatorConflict) return false;
    if (row.authorId && (!expectedAuthorId || String(row.authorId) !== String(expectedAuthorId))) return false;
    const detailName = String(detail?.creatorName || '');
    const detailId = String(detail?.creatorId || '');
    if (detailName && !authorMatches(detailName)) return false;
    if (detailId && (!expectedAuthorId || detailId !== String(expectedAuthorId))) return false;
    // Names alone cannot distinguish duplicate native author options. Require
    // the creator ID of this saved row or card to match the pinned account.
    if (!row.authorId && !detailId) return false;
    return true;
  }
  function classify(detail, sources,base = detail?.base) {
    if (!detail?.ok) return { ok: false, retryable: true, reason: 'Карточка заявки не прочитана.' };
    // Read only a real CRM source field, never arbitrary mentions of Avito from
    // the customer's message, phone, address or other user-entered prose.
    // On the actual saved CRM edit page the Avito source code is entered in
    // 'Комментарий партнёра'. Treat this field as authoritative when filled;
    // other advertising campaign metadata must not override it.
    const sourceText = String(detail.partnerComment || '').trim() || String(detail.source || '').trim();
    if (!sourceText) return { ok:false, retryable:true, reasonCode:'source-empty',reason:'В поле источника заявки пока нет значения.' };
    const namedText=sourceText.normalize('NFKC').toUpperCase().replace(/\s+/g,' ').trim();
    const selected748=partner748Matches(detail.partner),knownNames=namedPatterns();
    const explicitNumbered=[...namedText.matchAll(/(?<![А-ЯЁA-Z0-9_.])748\s+(?:ПАРТН[ЕЁ]Р\s*[-:]?\s*)?ИСТОЧНИК\s*(?:№|NO)\s*(\d+(?:\.\d+)*)?/gu)];
    const confirmedNumbered=[...namedText.matchAll(knownNames[1].pattern)];
    // Never discard an unsupported explicit 748 identity and then accept a
    // different remaining code from the same dedicated CRM field.
    if(explicitNumbered.some(match=>match[1]!=='3')||explicitNumbered.length!==confirmedNumbered.length)
      return {ok:false,retryable:true,reasonCode:'source-conflict',reason:'В поле источника указан неподтверждённый именованный источник 748.'};
    if(selected748){
      let remainder=namedText;for(const named of knownNames)remainder=remainder.replace(named.pattern,' ');
      const possibilities=new Set(sourceCodes(sourceText));
      if(/(?<![А-ЯЁA-Z0-9_.])АВИТО(?![А-ЯЁA-Z0-9_.])/u.test(remainder))possibilities.add('748 Авито ДБ');
      const bareNumbered=[...remainder.matchAll(/ИСТОЧНИК\s*(?:№|NO)\s*(\d+(?:\.\d+)*)/gu)];
      if(bareNumbered.some(match=>match[1]!=='3'))return {ok:false,retryable:true,reasonCode:'source-conflict',reason:'В поле источника указан неподтверждённый именованный источник 748.'};
      if(bareNumbered.length)possibilities.add('748 Источник №3');
      if(possibilities.size>1)return {ok:false,retryable:true,reasonCode:'source-conflict',reason:'В поле источника указано несколько разных источников.'};
    }
    const gatedNamed=selected748?/^АВИТО(?:\s+ДБ)?$/.test(namedText)?'748 Авито ДБ':/^ИСТОЧНИК\s*(?:№|NO)\s*3$/.test(namedText)?'748 Источник №3':'':'';
    const numeric = sourceText.match(/^(?:источник\s*:?\s*)?(\d{1,20})$/iu), values = gatedNamed?[gatedNamed]:numeric ? (numeric[1]==='748'?[]:[numeric[1]]) : sourceCodes(sourceText);
    if (values.length !== 1) return { ok:false, retryable:true,reasonCode:'source-conflict', reason:'Нет одного однозначного кода источника.' };
    const candidates = catalog(sources,base), annotated = sourceText.match(/^(?:источник\s*:?\s*)?(\d{1,20})\s*(?:(МНЧ|КП|БТ)\s*)?-\s*/iu);
    const external = String(detail.sourceExternalId || annotated?.[1] || '');
    const fromCode=candidates.get(values[0]),fromId=external?candidates.get(external):null;
    const source = external ? fromId?.ambiguous&&!numeric&&fromCode&&!fromCode.ambiguous&&fromCode.externalIds.includes(external)?fromCode:fromId : fromCode;
    if (!source || source.ambiguous) return { ok:false, retryable:true,reasonCode:source?.ambiguous ? 'source-conflict' : 'source-unknown', reason:'Код источника не подтверждён общим справочником Авито.' };
    if (external && !numeric && candidates.get(values[0]) !== source && candidates.get(values[0])?.source !== source.source) return {ok:false,retryable:true,reasonCode:'source-conflict',reason:'Код и числовой ID источника не совпадают.'};
    if (external && source.externalIds.length && !source.externalIds.includes(external)) return {ok:false,retryable:true,reasonCode:'source-conflict',reason:'Числовой ID источника противоречит справочнику.'};
    // Neither partner ID nor a duplicate URL in the general comment is required:
    // the creator enters the source in its dedicated field. A missing comment
    // is not evidence of a non-Avito request.
    return { ok:true, source:source.source, sourceUrl:source.url };
  }
  function validateIndex(page) {
    if (!page?.ok || !Array.isArray(page.rows) || page.idSortSupported !== true || typeof page.next !== 'boolean') throw Error(page?.error || 'CRM не подтвердила выбранную сортировку списка.');
    if (!page.rows.length && (!page.empty || page.next)) throw Error('Пустой ответ CRM не подтверждён.');
    let previous = null, previousCreated = null;
    const ordering = page.ordering || 'id-desc';
    if (!['id-desc','created-desc'].includes(ordering)) throw Error('Неизвестная сортировка CRM.');
    const seen = new Set();
    for (const row of page.rows) {
      if (!validId(row.id) || !String(row.author || '').trim() || createdKey(row.created) === null) throw Error('CRM вернула неполные данные заявки.');
      const id = BigInt(row.id);
      if (seen.has(row.id)) throw Error('CRM повторила ID заявки.');
      seen.add(row.id);
      const created = createdKey(row.created);
      if (ordering === 'id-desc' && previous !== null && id >= previous) throw Error('CRM не подтвердила убывающую сортировку ID.');
      if (ordering === 'created-desc' && previousCreated !== null && created > previousCreated) throw Error('CRM не подтвердила сортировку по дате создания.');
      previous = id;
      previousCreated = created;
    }
    return page;
  }
  const api = Object.freeze({ MIGRATION_SINCE_KEY, OWNER_IDS, normalize, authorMatches, verifiedOwner, validId, sourceEmptyDeadline, isVisibleRecord, createdKey, codes, sourceCodes, canonicalSourceCode, partner748Matches, canonicalUrl, catalog, partnerMatches, classify, validateIndex });
  globalThis.CRMAvitoCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
