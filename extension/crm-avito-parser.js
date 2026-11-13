/* Runs only in the extension offscreen document; never executes CRM HTML. */
(() => {
  'use strict';
  const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  const person = value => String(value || '').normalize('NFKC').replace(/ё/gi,'е').replace(/,/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const safeField = name => typeof name === 'string' && name.length <= 160 && /^CRSearch\[[a-zA-Z_][a-zA-Z0-9_]*(?:\]\[[a-zA-Z0-9_]*)*\](?:\[\])?$/.test(name);
  function values(input) {
    if (input.tagName === 'SELECT') {
      const options = [...input.querySelectorAll('option')], selected = options.filter(option => option.selected || option.hasAttribute('selected'));
      return (selected.length || input.hasAttribute('multiple') ? selected : options.slice(0,1)).map(option => String(option.value || ''));
    }
    if (['checkbox','radio'].includes(input.getAttribute('type')) && !input.hasAttribute('checked')) return [];
    return [String(input.value || '')];
  }
  const allLabels = new Set(['все','любой','все заявки','не выбрано','выбрать','-']);
  function selectedOptions(input) {
    if (input.tagName !== 'SELECT') return [];
    const options = [...input.querySelectorAll('option')], selected = options.filter(option => option.selected || option.hasAttribute('selected'));
    return selected.length || input.hasAttribute('multiple') ? selected : options.slice(0,1);
  }
  const inputType = input => String(input.getAttribute('type') || 'text').toLowerCase();
  const unchecked = input => !input.checked && !input.hasAttribute('checked');
  const valueClass = values => !values.length || values.every(value => value === '') ? 'empty' : values.every(value => value === '0') ? 'zero' : values.every(value => value === '1') ? 'one' : 'other';
  function safeControlMetadata(input, configuredValue = false) {
    const rawType = inputType(input);
    const type = input.tagName === 'SELECT' ? 'select' : input.tagName === 'TEXTAREA' ? 'textarea' : /^(?:hidden|text|search|number|tel|email|date|datetime-local|month|time|week|range|checkbox|radio|color|password|url)$/.test(rawType) ? rawType : 'other';
    const optionLabels = selectedOptions(input).map(option => person(text(option)));
    const selectLabelClass = !optionLabels.length ? undefined : optionLabels.every(label => allLabels.has(label)) ? 'all' : optionLabels.every(label => label === 'да') ? 'yes' : optionLabels.every(label => label === 'нет') ? 'no' : 'other';
    return {type,isDisabled:!!input.disabled || input.hasAttribute('disabled'),valueClass:valueClass(configuredValue && input.tagName !== 'SELECT' ? [String(input.value || '')] : values(input)),
      ...(['checkbox','radio'].includes(type) ? {checked:!unchecked(input)} : {}),...(selectLabelClass ? {selectLabelClass} : {})};
  }
  function inactiveFarRide(input,meta,payload) {
    const name = input.getAttribute('name');
    if (payload.base !== 'kp' || name !== 'CRSearch[is_far_ride]' || !payload.scope) return false;
    try {
      const url = new URL(payload.url);
      if (url.origin !== 'https://kp-lead-centre.ru' || !/^\/admin\/domain\/customer-request\/index\/?$/.test(url.pathname) || url.searchParams.getAll(name).length !== 1 || url.searchParams.get(name) !== '') return false;
    } catch (_) { return false; }
    const sameName = meta.controls.filter(control => control.getAttribute('name') === name);
    if (input.tagName === 'INPUT' && inputType(input) === 'hidden' && String(input.value) === '0') {
      const others = sameName.filter(control => control !== input);
      const checkbox = others.find(control => control.tagName === 'INPUT' && inputType(control) === 'checkbox' && String(control.value) === '1' && unchecked(control));
      if (sameName.length === 2 && checkbox) return true;
      if (sameName.length === 3) {
        if (others.every(control => control.tagName === 'INPUT' && inputType(control) === 'radio' && unchecked(control)) &&
          others.map(control => String(control.value)).sort().join('|') === '0|1') return true;
        const emptyHidden = others.find(control => control.tagName === 'INPUT' && inputType(control) === 'hidden' && String(control.value || '') === '');
        if (checkbox && emptyHidden) return true;
      }
    }
    if (input.tagName === 'SELECT' && sameName.length === 1 && !input.hasAttribute('multiple')) {
      const selected = selectedOptions(input);
      return selected.length === 1 && String(selected[0].value) === '0' && allLabels.has(person(text(selected[0])));
    }
    return false;
  }
  function invalidFilterDiagnostics(meta, payload) {
    const scope = payload.scope;
    const counts = new Map();
    for (const input of meta.controls) {
      const name = input.getAttribute('name');
      if (safeField(name)) counts.set(name,(counts.get(name) || 0) + 1);
    }
    const controls = [];
    for (const input of meta.controls) {
      const name = input.getAttribute('name');
      if (!safeField(name) || (scope && (name === scope.authorField || name === scope.sortName || (scope.requestId && name === 'CRSearch[id]') || (name === scope.pageName && /^CRSearch\[page\]$/.test(name)))) || inactiveFarRide(input,meta,payload)) continue;
      const selectedValues = values(input), nonBlank = selectedValues.filter(value => value.trim() !== ''), nonBlankCount = nonBlank.length;
      if (!nonBlankCount) continue;
      const metadata = safeControlMetadata(input);
      const siblings = payload.base === 'kp' && name === 'CRSearch[is_far_ride]' && metadata.type === 'hidden' ?
        meta.controls.filter(control => control.getAttribute('name') === name).slice(0,12).map(control => safeControlMetadata(control,true)) : undefined;
      controls.push({name,...metadata,duplicateCount:counts.get(name),nonBlankCount,...(siblings ? {siblings} : {})});
    }
    return {activeFilterNames:[...new Set(controls.map(control => control.name))],controls};
  }
  function inspect(doc, table, payload) {
    const controls = [...doc.querySelectorAll('input[name], select[name], textarea[name]')].filter(input => /^CRSearch\[/.test(input.getAttribute('name') || '') && !['submit','button'].includes(input.getAttribute('type')));
    const author = doc.querySelector('#crsearch-author_id, select[name="CRSearch[author_id]"]');
    const sorts = [];
    [...table.querySelectorAll('thead th')].forEach((header, index) => {
      const title = text(header);
      const kind = /создан/i.test(title) && !/создал|автор/i.test(title) ? 'created' : index === 0 || /^(?:ID|№|номер)/i.test(title) ? 'id' : '';
      if (!kind) return;
      for (const link of header.querySelectorAll('a[href]')) {
        let url;
        try { url = new URL(link.getAttribute('href'), payload.url || 'https://' + payload.base + '-lead-centre.ru/admin/domain/customer-request/index'); } catch (_) { continue; }
        const parameter = [...url.searchParams.keys()].find(name => /^(?:sort|[A-Za-z_][\w-]*_sort|[A-Za-z_][\w-]*\[sort\])$/.test(name) && /^-?[A-Za-z_][\w.]*$/.test(url.searchParams.get(name) || ''));
        const value = String(link.getAttribute('data-sort') || (parameter ? url.searchParams.get(parameter) : '') || '').replace(/^-/, '');
        if (parameter && /^[A-Za-z_][\w.]*$/.test(value)) sorts.push({ kind, name: parameter, value, href: url.toString() });
      }
    });
    let nextHref = '';
    for (const node of doc.querySelectorAll('.pagination .next, a[rel="next"]')) {
      if (node.classList.contains('disabled') || node.parentElement?.classList.contains('disabled') || node.getAttribute('aria-disabled') === 'true') continue;
      const link = node.getAttribute('href') ? node : node.querySelector('a[href]');
      if (link) { nextHref = link.getAttribute('href'); break; }
    }
    if (!nextHref) {
      const currentNode = doc.querySelector('.pagination .active, .pagination .selected, .pagination .current');
      let current = /^\d+$/.test(text(currentNode)) ? Number(text(currentNode)) : 1;
      if (!currentNode && payload.url) {
        const url = new URL(payload.url);
        for (const [name,value] of url.searchParams) if (/^(?:page|p|\w+_page|CRSearch\[page\])$/.test(name) && /^[1-9]\d*$/.test(value)) current = Number(value);
      }
      const numeric = [...doc.querySelectorAll('.pagination a[href]')].filter(link => /^\d+$/.test(text(link)) && Number(text(link)) > current && !link.parentElement?.classList.contains('disabled')).sort((a,b) => Number(text(a)) - Number(text(b)));
      if (numeric.length) nextHref = numeric[0].getAttribute('href');
    }
    return { authorField: author?.getAttribute('name') || '', authorOptions: author ? [...author.querySelectorAll('option')].map(option => ({ id: String(option.value || ''), label: text(option),disabled:!!option.disabled || option.hasAttribute('disabled') })) : [],
      fields: [...new Set(controls.map(input => input.getAttribute('name')))], sorts, nextHref, controls,
      columns:[...table.querySelectorAll('thead th')].slice(0,12).map(header => text(header.querySelector('a[href]') || header).slice(0,80)) };
  }
  function selectedFieldValue(node) {
    if (!node) return '';
    if (node.tagName === 'SELECT') {
      const selected = [...node.querySelectorAll('option')].filter(option => option.selected || option.hasAttribute('selected'));
      return selected.length === 1 && selected[0].value ? text(selected[0]) : '';
    }
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return String(node.value || '').trim();
    return text(node);
  }
  function creatorField(doc) {
    // Created-by is NOT the dispatcher/assignee/partner. Confirm the actual
    // creator using a specifically named field or an adjacent labelled value.
    const controls = [
      ['#customerrequest-author_id, [name="CustomerRequest[author_id]"]', 'id'],
      ['#customerrequest-created_by, [name="CustomerRequest[created_by]"]', 'id'],
      ['#customerrequest-created_by_id, [name="CustomerRequest[created_by_id]"]', 'id'],
    ];
    const ids = new Set(), names = new Set();
    for (const node of [...new Set(controls.flatMap(([selector]) => [...doc.querySelectorAll(selector)]))]) {
      if (!node) continue;
      const raw = String(node.value || '').trim();
      const name = selectedFieldValue(node);
      if (/^[1-9]\d+$/.test(raw)) ids.add(raw);
      if (name && name !== raw) names.add(name);
      else if (name && !/^[1-9]\d+$/.test(name)) names.add(name);
    }
    // Yii detail pages may present read-only creator metadata in a field row.
    for (const node of doc.querySelectorAll('th, dt, label')) {
      if (!/^(автор создания|создал|создано пользователем)\s*:?$/iu.test(text(node))) continue;
      const neighbour = node.nextElementSibling || (node.parentElement?.querySelector('td, dd, .form-control-static'));
      const name = text(neighbour);
      if (name) names.add(name);
    }
    const compactName = name => person(name).replace(/\.(?=\s|$)/g,'').replace(/\s+/g,' ');
    const abbreviations = [...new Set([...names].map(compactName).filter(name => /^биктимиров з(?: [а-я])?$/u.test(name)))];
    // A single consistent abbreviation can accompany the full name. Different
    // patronymic initials remain contradictory; saved creator IDs are checked
    // independently before the request can count or send.
    const creatorIdentity = name => {
      const normalized = compactName(name);
      return normalized === 'биктимиров захар' || (abbreviations.length === 1 && normalized === abbreviations[0]) ? 'биктимиров захар' : normalized;
    };
    return {creatorId:[...ids][0] || '',creatorName:[...names][0] || '',creatorConflict:ids.size > 1 || new Set([...names].map(creatorIdentity)).size > 1};
  }
  function parse(payload) {
    let filterDiagnostics;
    try {
      if (!['kp','mnc','bt'].includes(payload?.base) || typeof payload.html !== 'string' || payload.html.length > 5000000) throw Error('Некорректный ответ CRM.');
      const doc = new DOMParser().parseFromString(payload.html, 'text/html');
      if (doc.querySelector('#login-form, form[action*="login"]')) throw Error('Нужен вход в базу CRM.');
      if (payload.kind === 'index' || payload.kind === 'index-meta') {
        const tables = doc.querySelectorAll('#cr-grid-table');
        if (tables.length !== 1) throw Error('Таблица заявок не найдена.');
        const table = tables[0], headers = [...table.querySelectorAll('thead th')].map(text);
        const meta = inspect(doc,table,payload);
        if (payload.kind === 'index-meta') { const { controls, ...metadata } = meta; return { ok:true, meta:metadata }; }
        filterDiagnostics = invalidFilterDiagnostics(meta,payload);
        const filters = [];
        let authorConfirmed = !payload.scope, requestConfirmed = !payload.scope?.requestId;
        for (const input of meta.controls) {
          const name = input.getAttribute('name');
          if (!/^CRSearch\[/.test(name || '') || ['submit','button'].includes(input.getAttribute('type'))) continue;
          const selected = values(input);
          if (payload.scope && name === payload.scope.authorField) {
            authorConfirmed = selected.length === 1 && selected[0] === payload.scope.authorId;
            const expectedLabel = person(payload.scope.authorLabel);
            const matches = meta.authorOptions.filter(option => option.id === selected[0] && expectedLabel === 'биктимиров захар' && person(option.label) === expectedLabel);
            if (!authorConfirmed || matches.length !== 1) throw Error('CRM не применила фильтр «Биктимиров Захар».');
          } else if (payload.scope?.requestId && name === 'CRSearch[id]') {
            requestConfirmed = selected.length === 1 && selected[0] === String(payload.scope.requestId);
            if (!requestConfirmed) throw Error('CRM не подтвердила фильтр ID отдельной заявки.');
          } else if (payload.scope && name === payload.scope.pageName && /^CRSearch\[page\]$/.test(name)) {
            if (selected.some(value => !/^[1-9]\d*$/.test(value))) throw Error('CRM не подтвердила номер страницы.');
          } else if (payload.scope && name === payload.scope.sortName) {
            if (selected.some(value => value !== '-' + payload.scope.sortValue)) throw Error('CRM изменила сортировку списка.');
          } else if (selected.some(value => value.trim() !== '') && !inactiveFarRide(input,meta,payload)) throw Error('CRM не сбросила посторонние фильтры списка' + (filterDiagnostics.activeFilterNames.length ? ': ' + filterDiagnostics.activeFilterNames.join(', ') : '') + '.');
          filters.push(name);
        }
        if (!authorConfirmed) throw Error('В ответе CRM не подтверждён фильтр вашего автора.');
        if (!requestConfirmed) throw Error('В ответе CRM не подтверждён запрошенный ID заявки.');
        const filterSignature = [...new Set(filters)].sort().join('|') + (payload.scope ? '|' + payload.scope.signature : '');
        const createdColumn = headers.findIndex(h => /создан/i.test(h) && !/создал|автор/i.test(h));
        const creatorColumns = headers.map((header,index) => ({header,index})).filter(value => /^(?:автор создания|создал)\s*:?$/i.test(value.header));
        const authorColumn = creatorColumns.length === 1 ? creatorColumns[0].index : creatorColumns.length > 1 ? -1 : headers.findIndex(h => /^автор\s*:?$/i.test(h));
        if (authorColumn < 0) throw Error('Столбец автора создания не подтверждён.');
        const idSortSupported = payload.scope ? meta.sorts.some(sort => sort.name === payload.scope.sortName && sort.value === payload.scope.sortValue && sort.kind === (payload.scope.ordering === 'created-desc' ? 'created' : 'id')) : [...table.querySelectorAll('thead a[href]')].some(link => {
          try { return /^-?id$/.test(new URL(link.getAttribute('href'), 'https://' + payload.base + '-lead-centre.ru').searchParams.get('sort')); } catch (_) { return false; }
        });
        const rows = [];
        if (payload.scope?.ordering === 'created-desc' && createdColumn < 0) throw Error('Не подтверждена колонка «Дата создания» для сортировки.');
        let empty = false;
        for (const row of table.querySelectorAll('tbody tr')) {
          const cells = [...row.querySelectorAll('td')];
          if (cells.length === 1 && (cells[0].classList.contains('empty') || /ничего не найдено|нет результатов|нет заявок/i.test(text(cells[0])))) { empty = true; continue; }
          const link = cells[0]?.querySelector('a[href]');
          if (!link) throw Error('Не распознан ID заявки.');
          const url = new URL(link.getAttribute('href'), 'https://' + payload.base + '-lead-centre.ru');
          const id = url.searchParams.get('id');
          if (url.hostname !== payload.base + '-lead-centre.ru' || !/^\/admin\/domain\/customer-request\/(?:update|view)$/.test(url.pathname) || !/^[1-9]\d{0,14}$/.test(id || '')) throw Error('Некорректная ссылка заявки.');
          const created = text(cells[createdColumn >= 0 ? createdColumn : (cells.length >= 10 ? 7 : -1)]);
          const authorCell = cells[authorColumn >= 0 ? authorColumn : (cells.length >= 10 ? 9 : -1)];
          const authorLink = authorCell?.querySelector('a[href]');
          const author = text(authorLink) || text(authorCell);
          let authorId = String(authorCell?.getAttribute('data-author-id') || authorLink?.getAttribute('data-author-id') || '');
          if (!authorId && authorLink) {
            try {
              const ownerUrl = new URL(authorLink.getAttribute('href'),'https://' + payload.base + '-lead-centre.ru');
              if (ownerUrl.origin === 'https://' + payload.base + '-lead-centre.ru' && /^\/admin\/domain\/(?:user|employee|dispatcher|staff)\/(?:view|update)$/.test(ownerUrl.pathname)) authorId = ownerUrl.searchParams.get('id') || '';
            } catch (_) {}
          }
          if (authorId && !/^[1-9]\d*$/.test(authorId)) throw Error('CRM дала неверный ID автора создания.');
          if (!/\b\d{2}\.\d{2}\.\d{2}(?:\d{2})?\b/.test(created) || !author) throw Error('Не прочитаны дата создания и автор.');
          // CRM may echo the correct author selector but still return an unfiltered table.
          // Preserve all rows (and pagination/date integrity); the monitor and manual test
          // filter by the verified creator before opening cards or sending anything.
          // Never trust the selector alone to establish an individual row's ownership.
          rows.push({ id, created, author,...(authorId ? {authorId} : {}) });
        }
        const contract = filterSignature + (payload.scope ? '|columns:' + JSON.stringify([createdColumn,authorColumn,meta.columns]) : '');
        return { ok: true, rows, next: !!meta.nextHref, nextHref: meta.nextHref, empty, idSortSupported, filterSignature:contract,
          ordering: payload.scope?.ordering || 'id-desc' };
      }
      if (payload.kind === 'detail') {
        const identity = doc.querySelector('#actCopyCrIdInput');
        if (!identity || String(identity.value || '').trim() !== String(payload.id)) throw Error('Не подтверждён номер карточки заявки.');
        const partner = doc.querySelector('#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"]');
        const selections = partner ? [...partner.querySelectorAll('option')].filter(option => option.hasAttribute('selected')) : [];
        const selected = selections.length === 1 ? selections[0] : null;
        const partnerComment = doc.querySelector('#customerrequest-partner_comment, [name="CustomerRequest[partner_comment]"]');
        const sourceField = doc.querySelector('#customerrequest-source, [name="CustomerRequest[source]"], #customerrequest-source_id, [name="CustomerRequest[source_id]"], #customerrequest-advert_id, [name="CustomerRequest[advert_id]"]');
        const externalField = doc.querySelector('[name="CustomerRequest[source_external_id]"], [name="CustomerRequest[external_source_id]"]');
        const comment = doc.querySelector('#customerrequest-comments, [name="CustomerRequest[comments]"]');
        // A partner is optional; it is NOT synonymous with a source. The exact
        // source code still must match the locally configured Avito catalog.
        const creator = creatorField(doc);
        return { ok:true,base:payload.base, partner:selected ? text(selected) : '',
          partnerComment:partnerComment ? String(partnerComment.value || '') : '',
          source:selectedFieldValue(sourceField),sourceExternalId:externalField && /^\d{3,12}$/.test(String(externalField.value || '')) ? String(externalField.value) : '', comment:comment ? String(comment.value || '') : '', ...creator };
      }
      throw Error('Неизвестный ответ CRM.');
    } catch (error) { return { ok: false, error: error.message,...(filterDiagnostics || {}) }; }
  }
  globalThis.CRMAvitoParser = Object.freeze({ parse });
})();
