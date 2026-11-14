/* Inert CRM HTML adapter. No HTML is inserted into a live document and no CRM scripts execute. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.LeadChatCrmHtml = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const optionList = element => Array.from(element ? element.options || [] : []).map(option => ({
        id: String(option.value), text: clean(option.textContent), disabled: !!option.disabled || !!option.parentElement?.disabled
    }));

    const AUDIT_LABEL = /^(?:Автор|Создал(?:а)?|Кем создан[ао]?|Создан[ао]?|Дата создания|Время создания|Изменил(?:а)?|Кем изменен[ао]?|Кем изменён[ао]?|Изменен[ао]?|Изменён[ао]?|Дата изменения|Время изменения|Обновил(?:а)?|Обновлен[ао]?|Обновлён[ао]?|Дата обновления)$/iu;
    function textAfterLabel(label) {
        let value = '';
        for (let node = label.nextSibling; node; node = node.nextSibling) {
            if (node.nodeType === 1 && (/^(?:BR|HR|LABEL|B|STRONG)$/.test(node.tagName) || AUDIT_LABEL.test(clean(node.textContent).replace(/:$/, '')))) break;
            value += node.textContent || '';
        }
        return clean(value).replace(/^:\s*/, '');
    }
    function nativeRequestTarget(value,page) {
        let target; try {target=new URL(value,page);} catch (_) {return null;}
        if (target.origin!==page.origin || target.username || target.password || target.hash
            || !/^\/admin\/domain\/customer-request\/(?:update|view)$/.test(target.pathname)
            || target.searchParams.getAll('id').length!==1 || !/^[1-9]\d*$/.test(target.searchParams.get('id') || '')
            || Array.from(target.searchParams.keys()).some(key=>key!=='id')) return null;
        return target;
    }
    function nativeCellText(cell) {
        const copy=cell.cloneNode(true);
        copy.querySelectorAll('script,style,template,noscript').forEach(node=>node.remove());
        copy.querySelectorAll('br').forEach(node=>node.replaceWith(' '));
        return clean(copy.textContent);
    }
    function nativeHistoryClaim(idCell,page,id,customerId) {
        // A history claim belongs to this validated ID cell. Status text, row
        // colors and the open card's claim state never prove another row's claim.
        const owns=node=>!node.closest('script,style,template,noscript,a[href*="create-claim"],button[name="create_claim"]')
            && (!node.closest('[data-request-id]') || node.closest('[data-request-id]').getAttribute('data-request-id')===id)
            && (!node.closest('[data-customer-id]') || node.closest('[data-customer-id]').getAttribute('data-customer-id')===customerId);
        const nodes=[idCell,...idCell.querySelectorAll('[data-has-claim],[data-is-claim],[data-crm-existing-claim],.bg-has_claim,.has-claim,.request-has-claim,[title],[aria-label]')];
        const claimLabel=/^(?:Претензия|Есть претензия|Имеется претензия|Заявка с претензией|Claim|Has claim|Existing claim)[.!]?$/iu;
        for(const node of nodes) {
            if(!owns(node))continue;
            const link=node.closest('a[href]'),target=link && nativeRequestTarget(link.getAttribute('href'),page);
            if(link && (!target || target.searchParams.get('id')!==id))continue;
            if(['data-has-claim','data-is-claim','data-crm-existing-claim'].some(name=>/^(?:1|true)$/i.test(node.getAttribute(name) || ''))
                || ['bg-has_claim','has-claim','request-has-claim'].some(name=>node.classList.contains(name))
                || ['title','aria-label'].some(name=>claimLabel.test(clean(node.getAttribute(name)))))return true;
        }
        for(const link of idCell.querySelectorAll('a[href]')) {
            if(!owns(link))continue;
            let target;try{target=new URL(link.getAttribute('href'),page);}catch(_){continue;}
            if(target.origin===page.origin && !target.username && !target.password && !target.hash
                && /^\/admin\/domain\/(?:cr-claim|customer-request-claim)\/(?:update|view)\/?$/.test(target.pathname)
                && target.searchParams.getAll('id').length===1 && /^[1-9]\d*$/.test(target.searchParams.get('id') || '')
                && !Array.from(target.searchParams.keys()).some(key=>key!=='id'))return true;
        }
        if(!owns(idCell))return false;
        if(['bg-danger','table-danger','danger'].some(name=>idCell.classList.contains(name)))return true;
        // CSSOM reads only the cell's literal inline declaration; the detached
        // document is never rendered and no stylesheet or page code is run.
        const color=clean(idCell.style.backgroundColor).toLowerCase();
        if(['red','darkred','firebrick','crimson','indianred','lightcoral'].includes(color))return true;
        const rgb=color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/);
        if(!rgb)return false;
        const [red,green,blue]=rgb.slice(1,4).map(Number),alpha=rgb[4]===undefined?1:Number(rgb[4]);
        return alpha>0 && red>=128 && red-green>=15 && red-blue>=10 && Math.abs(green-blue)<=64;
    }
    function nativeCustomerTarget(page) {
        return /^\/admin\/domain\/customer\/(?:update|view)$/.test(page.pathname) && !page.username && !page.password && !page.hash
            && page.searchParams.getAll('id').length===1 && /^[1-9]\d*$/.test(page.searchParams.get('id') || '')
            && !Array.from(page.searchParams.keys()).some(key=>key!=='id');
    }
    function nativeCustomerPhones(doc,page,customerId) {
        const phone10=value=>{const digits=String(value || '').replace(/\D/g,'');return /^\d{10}$/.test(digits)?digits:/^[78]\d{10}$/.test(digits)?digits.slice(1):'';};
        const empty={customerPhone:'',customerPhones:[]};
        if (!/^[1-9]\d*$/.test(customerId) || !nativeRequestTarget(page.href,page) && !nativeCustomerTarget(page)) return empty;
        const scopes=Array.from(doc.querySelectorAll('#customerInfo'));
        if (scopes.length!==1) return empty;
        const scope=scopes[0],owner=scope.closest('[data-customer-id]')?.getAttribute('data-customer-id');
        if (owner!==undefined && owner!==null && owner!==customerId) return empty;
        const primary=new Set(),phones=new Set();
        for (const label of scope.querySelectorAll('span,th,dt,label')) {
            if (!/^(?:Тел|Телефон):?$/iu.test(clean(label.textContent))) continue;
            const copy=label.parentElement.cloneNode(true);copy.querySelectorAll('a,script,style,template,noscript').forEach(node=>node.remove());
            const phone=phone10(copy.textContent);if(phone){primary.add(phone);phones.add(phone);}
        }
        for (const anchor of scope.querySelectorAll('a[href]')) {
            const match=(anchor.getAttribute('href') || '').match(/^(?:sip|sips|tel|callto):([+0-9(). -]+)(?:;sip_id=\d+)?$/iu);
            const phone=match?phone10(match[1]):'';if(phone)phones.add(phone);
        }
        return {customerPhone:primary.size===1?[...primary][0]:'',customerPhones:[...phones]};
    }
    function nativeCustomerHistory(doc,page,customerId) {
        const current=nativeRequestTarget(page.href,page);
        const customerPage=nativeCustomerTarget(page) && page.searchParams.get('id')===customerId;
        const base=({'https://kp-lead-centre.ru':'kp','https://mnc-lead-centre.ru':'mnc','https://bt-lead-centre.ru':'bt'})[page.origin];
        if (!current && !customerPage || !base || !/^[1-9]\d*$/.test(customerId)) return null;
        const requestId=current?.searchParams.get('id') || '',candidates=[];
        const required=['ID','Тип','Прозвон','Дата принятия заявки','Дата исполнения','Статус','Мастер','Кем создана','РК','Партнер'];
        for (const table of doc.querySelectorAll('table')) {
            const heading=table.querySelector('thead tr');
            const labels=Array.from(heading?.cells || []).map(nativeCellText);
            if (!required.every(label=>labels.includes(label)) || new Set(labels).size!==labels.length) continue;
            const owner=table.closest('[data-customer-id]')?.getAttribute('data-customer-id');
            if (owner!==undefined && owner!==null && owner!==customerId) continue;
            const columns=labels.map((label,index)=>({key:'c'+index,label})),rows=[],seen=new Set();
            for (const row of table.querySelectorAll('tbody tr')) {
                if (row.closest('table')!==table || row.cells.length!==columns.length
                    || Array.from(row.cells).some(cell=>cell.colSpan!==1 || cell.rowSpan!==1)) continue;
                const rowOwner=row.closest('[data-customer-id]')?.getAttribute('data-customer-id');
                if (rowOwner!==undefined && rowOwner!==null && rowOwner!==customerId) continue;
                const idCell=row.cells[labels.indexOf('ID')],targets=new Map();
                for (const anchor of idCell.querySelectorAll('a[href]')) {
                    const target=nativeRequestTarget(anchor.getAttribute('href'),page);
                    if (target) targets.set(target.searchParams.get('id'),target);
                }
                if (targets.size!==1) continue;
                const [id,target]=[...targets][0],key=row.getAttribute('data-key');
                if (seen.has(id) || key!==null && key!==id) continue;
                seen.add(id);
                const cells={};for (let index=0;index<columns.length;index++)cells[columns[index].key]=nativeCellText(row.cells[index]);
                rows.push({id,base,url:target.href,cells,current:!!requestId && id===requestId,hasClaim:nativeHistoryClaim(idCell,page,id,customerId)});
            }
            // The current native row binds the table to this exact card. An
            // explicit native customer scope also permits an older-only table.
            if (customerPage || owner===customerId || rows.some(row=>row.current)) candidates.push({customerId,requestId,base,columns,rows});
        }
        return candidates.length===1?candidates[0]:null;
    }
    function nativeFacts(doc,page,customerHistory) {
        const paymentLabel = Array.from(doc.querySelectorAll('b,strong,label,span')).find(node => /^Сумма, оплаченная клиентом:?$/u.test(clean(node.textContent)));
        const paymentSummary = paymentLabel && textAfterLabel(paymentLabel) ? {label:clean(paymentLabel.textContent).replace(/:$/, ''),value:textAfterLabel(paymentLabel)} : null;
        const auditInfo = [], seen = new Set();
        const add = (label,value) => {
            label = clean(label).replace(/:$/, ''); value = clean(value);
            if (AUDIT_LABEL.test(label) && value && !seen.has(label)) {seen.add(label);auditInfo.push({label,value});}
        };
        // Footer facts are presentation data. They never prove the current operator.
        const scopes = Array.from(doc.querySelectorAll('.card-footer,.---author,.request-audit,[data-request-audit]'));
        for (const scope of scopes) {
            for (const label of scope.querySelectorAll('b,strong,label,span,th,dt')) {
                if (!AUDIT_LABEL.test(clean(label.textContent).replace(/:$/, ''))) continue;
                const paired = /^(?:TH|DT)$/.test(label.tagName) ? label.nextElementSibling?.textContent : '';
                add(label.textContent,paired || textAfterLabel(label));
            }
            const copy = scope.cloneNode(true);
            copy.querySelectorAll('script,style,input,select,textarea,button').forEach(node=>node.remove());
            copy.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
            for (const node of copy.querySelectorAll('div,p,li,tr')) node.append('\n');
            for (const line of (copy.textContent || '').split(/\r?\n/)) {
                const match = clean(line).match(/^([^:]{2,40}):\s*(.+)$/u);
                if (match) add(match[1],match[2]);
            }
        }

        // Native customer history already includes this exact card in some
        // CRM layouts. Its provenance column is useful without an extra read.
        // Keep the native date labels; acceptance is not a creation timestamp.
        if (!auditInfo.length) {
            const row=customerHistory?.rows.find(row=>row.current);
            if (row) {
                for (const label of ['Кем создана','Дата принятия заявки','Дата исполнения']) {
                    const column=customerHistory.columns.find(column=>column.label===label),value=column?row.cells[column.key]:'';
                    if(value)auditInfo.push({label,value});
                }
            }
        }
        return {paymentSummary,auditInfo};
    }
    function nativeAudioRoute(doc,scripts,page) {
        if (!/^\/admin\/domain\/customer-request\/update$/.test(page.pathname) || !/^\d+$/.test(page.searchParams.get('id') || '')) return null;
        const trigger = Array.from(doc.querySelectorAll('#cr-customer-audio [onclick]')).some(node =>
            /^\s*checkCustomerAudioRecords\(\s*\)\s*;?\s*$/.test(node.getAttribute('onclick') || '') && !node.disabled && !node.classList.contains('disabled'));
        if (!trigger) return null;
        const routes = new Set();
        for (const script of scripts) {
            const start = script.search(/\bfunction\s+checkCustomerAudioRecords\s*\(\s*\)\s*\{/);
            if (start < 0) continue;
            // Read only the literal load vocabulary used by the native button.
            const block = script.slice(start,start+3000);
            for (const match of block.matchAll(/\$\(\s*['"]#cr-customer-audio['"]\s*\)\.load\(\s*(['"])([^'"\r\n]+)\1\s*\)/g)) {
                let target; try { target = new URL(match[2].replace(/\\\//g,'/'),page); } catch (_) { continue; }
                if (target.origin !== page.origin || target.username || target.password || target.hash || target.pathname !== page.pathname
                    || target.searchParams.get('id') !== page.searchParams.get('id') || target.searchParams.get('_get-customer-audio') !== '1'
                    || target.searchParams.getAll('id').length !== 1 || target.searchParams.getAll('_get-customer-audio').length !== 1
                    || Array.from(target.searchParams.keys()).some(key=>!['id','_get-customer-audio'].includes(key))) continue;
                routes.add(target.href);
            }
        }
        return routes.size === 1 ? {url:[...routes][0],method:'GET'} : null;
    }
    function parseAudioRecords(html,url,options = {}) {
        if (typeof DOMParser === 'undefined') throw new Error('Для разбора CRM нужна внутренняя страница расширения.');
        const doc = new DOMParser().parseFromString(String(html || ''),'text/html'),page = new URL(url);
        const scope = doc.getElementById('cr-customer-audio') || doc.body;
        const blockedOrigins = new Set();
        function media(value,nativeMedia) {
            if (!value) return '';
            let target; try { target = new URL(value,page); } catch (_) { return ''; }
            if (target.protocol !== 'https:' || target.username || target.password || target.hash) return '';
            const host=target.hostname.toLowerCase(),v4=host.split('.').map(Number);
            if (host==='localhost' || host.endsWith('.localhost') || /^\[(?:::|::1|::ffff:|fe80:)/i.test(host)
                || v4.length===4 && v4.every(part=>Number.isInteger(part)&&part>=0&&part<=255)
                    && (v4[0]===0 || v4[0]===127 || v4[0]===169 && v4[1]===254)) return '';
            if (target.origin !== page.origin) { if (options.nativeResponse === true && nativeMedia) return target.href; blockedOrigins.add(target.origin); return ''; }
            // Only a server-rendered media target can reach this function. An
            // update form or action URL must never become an audio source.
            if (/^\/admin\/domain\/customer-request\//.test(target.pathname) || /\/(?:logout|login)(?:\/|$)/.test(target.pathname)) return '';
            return target.href;
        }
        const tables = Array.from(scope.querySelectorAll('table')).filter(table=>table.querySelector('audio,source') || /Дата|Время|Телефон|Запись|звонил/iu.test(clean(table.querySelector('thead,tr')?.textContent)));
        if (!tables.length) return {columns:[],records:[],blockedOrigins:[]};
        const table=tables[0],heading=table.querySelector('thead tr') || Array.from(table.rows).find(row=>row.querySelector('th'));
        const labels=Array.from(heading?.cells || []).map(cell=>clean(cell.textContent));
        const columns=labels.map((label,index)=>({key:'c'+index,label}));
        const records=[];
        for (const row of table.rows) {
            if (row===heading || row.closest('thead') || row.querySelector('th') || !row.cells.length || row.cells.length===1 && row.cells[0].colSpan>1) continue;
            const cells={},values=Array.from(row.cells).map(cell=>clean(cell.textContent));
            for (let index=0;index<values.length;index++) cells['c'+index]=values[index];
            const source=row.querySelector('audio[src],audio source[src],source[src]');
            const anchor=Array.from(row.querySelectorAll('a[href]')).find(node=>/\.(?:mp3|wav|ogg|oga|m4a|mp4|webm|aac|flac)(?:[?#]|$)/i.test(node.getAttribute('href') || '') || node.hasAttribute('download'));
            const raw=source?.getAttribute('src') || anchor?.getAttribute('href') || '';
            const value=pattern=>values[labels.findIndex(label=>pattern.test(label))] || '';
            const mime=source?.getAttribute('type') || source?.querySelector('source')?.getAttribute('type') || '';
            records.push({cells,date:value(/^Дата/iu),time:value(/^Время/iu),caller:value(/^(?:Кто звонил|Звонивший|Отправитель|От кого)/iu),
                recipient:value(/^(?:Кто\s+принял\s+(?:вызов|звонок)|Кому звонили|Получатель|Кому|Куда)/iu),phone:value(/Телефон|Номер/iu),url:media(raw,!!source),
                ...(/^audio\/[a-z0-9.+-]+$/i.test(mime)?{mime}:{})});
        }
        return {columns,records,blockedOrigins:[...blockedOrigins]};
    }

    function parse(html, url) {
        if (typeof DOMParser === 'undefined') throw new Error('Для разбора CRM нужна внутренняя страница расширения.');
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const page = new URL(url);
        // A loose option response is different from a whole page containing an
        // unrelated select. Keep this evidence inert and serializable for the
        // strict base comparison reader; ordinary form consumers ignore it.
        const spacing = node => node.nodeType === 8 || node.nodeType === 3 && !node.textContent.trim();
        const option = node => node.nodeType === 1 && node.tagName === 'OPTION'
            && Array.from(node.childNodes).every(child => child.nodeType === 3 || child.nodeType === 8);
        const optionNode = node => option(node) || node.nodeType === 1 && node.tagName === 'OPTGROUP'
            && Array.from(node.childNodes).every(child => spacing(child) || option(child));
        const bodyNodes = Array.from(doc.body.childNodes);
        const optionFragment = bodyNodes.some(optionNode) && bodyNodes.every(node => spacing(node) || optionNode(node))
            && Array.from(doc.head.childNodes).every(spacing);
        const standaloneSelects = Array.from(doc.querySelectorAll('select')).filter(element => !element.closest('form'))
            .map(element => ({name:element.name,tag:'select',disabled:!!element.disabled || element.matches(':disabled'),options:optionList(element)}));
        const scripts = Array.from(doc.querySelectorAll('script')).map(node => node.textContent || '');
        const csrfParam = doc.querySelector('meta[name="csrf-param"]')?.content || '_csrf-frontend';
        const csrfToken = doc.querySelector('meta[name="csrf-token"]')?.content || '';
        // The native timetable endpoint returns the contents of #cityTimeTable,
        // without its container. Broaden the selector only for that exact route.
        let timetableFragment = false;
        try { timetableFragment = new URL(url).pathname === '/admin/domain/customer-request/city-timetable'; } catch (_) {}
        const noticeNodes = doc.querySelectorAll(timetableFragment ? 'p.blockquote-small' : '#cityTimeTable > p.blockquote-small');
        const cityNotice = Array.from(noticeNodes).map(node => {
            const copy = node.cloneNode(true);
            for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
            return (copy.textContent || '').split(/\r?\n/).map(clean).filter(Boolean).join('\n');
        }).filter(Boolean).join('\n');
        const errors = Array.from(doc.querySelectorAll('.invalid-feedback,.help-block-error,.alert-danger,.alert-error'))
            .map(node => clean(node.textContent)).filter(Boolean);
        const forms = Array.from(doc.forms).map(form => {
            const fields = Array.from(form.elements).filter(element => !!element.name).map(element => {
                const label = Array.from(form.querySelectorAll('label')).find(node => node.htmlFor && node.htmlFor === element.id);
                const type = String(element.type || element.tagName || '').toLowerCase();
                const multiple = element.tagName === 'SELECT' && !!element.multiple;
                const field = {
                    name: element.name, id: element.id || '', label: clean(label?.textContent || element.getAttribute('placeholder') || element.name),
                    type, tag: element.tagName.toLowerCase(), value: String(element.value ?? ''),
                    checked: !!element.checked, required: !!element.required, disabled: !!element.disabled || element.matches(':disabled'),
                    readOnly: !!element.readOnly, multiple,
                    options: optionList(element), values: multiple ? Array.from(element.selectedOptions || []).map(option => option.value) : undefined
                };
                const dep = element.getAttribute('data-krajee-depdrop');
                field.dependencies = [];
                if (dep) for (const script of scripts) {
                    const offset = script.indexOf(dep);
                    if (offset < 0) continue;
                    const tail = script.slice(offset, offset + 5000);
                    const match = tail.match(/["']url["']\s*:\s*["']([^"']+)["']/);
                    if (match) field.dependencies.push({ url: match[1].replace(/\\\//g, '/'), method: 'POST', depdrop: true,
                        parentId: (tail.match(/["']depends["']\s*:\s*\[\s*["']([^"']+)/) || [])[1] || '' });
                }
                for (const attribute of Array.from(element.attributes)) {
                    if (/url|href|ajax/i.test(attribute.name) && /^\//.test(attribute.value)) field.dependencies.push({ url: attribute.value, method: 'GET' });
                }
                return field;
            });
            const values = {};
            for (const field of fields) {
                if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) {
                    if (!(field.name in values)) values[field.name] = '0';
                    continue;
                }
                values[field.name] = field.multiple ? field.values : field.value;
            }
            const buttons = Array.from(form.querySelectorAll('button,input[type="submit"]')).map(button => ({
                name: button.name || '', value: button.value || '', text: clean(button.tagName === 'INPUT' ? button.value : button.textContent),
                type: String(button.type || 'submit').toLowerCase(), onclick: button.getAttribute('onclick') || '',
                disabled: !!button.disabled || button.matches(':disabled'), action: button.getAttribute('formaction') || '', method: button.getAttribute('formmethod') || ''
            }));
            return { id: form.id || '', action: form.getAttribute('action') || url || '', method: String(form.method || 'POST').toUpperCase(), fields, values, buttons };
        });
        const rows = [];
        const seen = new Set();
        for (const anchor of doc.querySelectorAll('a[href*="customer-request/update"]')) {
            let target;
            try { target = new URL(anchor.getAttribute('href'), url); } catch (_) { continue; }
            const id = target.searchParams.get('id');
            if (!/^\d+$/.test(id || '') || seen.has(id)) continue;
            seen.add(id);
            const row = anchor.closest('tr');
            const headings = Array.from(row?.closest('table')?.querySelectorAll('thead tr:first-child th') || []).map(node => clean(node.textContent));
            const cell = label => row?.children[headings.findIndex(text => text === label)];
            rows.push({ id, url: target.href, status: clean(row?.querySelector('td.col__req_status')?.textContent || cell('Статус')?.textContent),
                city: clean(row?.querySelector('td.--fullwidth')?.textContent || cell('Город')?.textContent),
                date: clean(row?.querySelector('td.col__openedAt')?.textContent || cell('Время заявки')?.textContent),
                phone: clean(cell('Телефон')?.textContent), text: clean(row?.textContent || anchor.textContent) });
        }
        const statusLabel = Array.from(doc.querySelectorAll('span')).find(node => /^\s*Статус:\s*$/.test(node.textContent || ''));
        const authorLabel = Array.from(doc.querySelectorAll('span,label')).find(node => /^\s*(?:Автор|Создал):?\s*$/.test(node.textContent || ''));
        const createdField = forms.flatMap(form => form.fields).find(item => /\[(?:created_at|createdAt|created_date)\]$/.test(item.name));
        const createdRow = Array.from(doc.querySelectorAll('tr')).find(row => /^(?:Создан[ао]?|Дата создания|Время создания):?$/i.test(clean(row.querySelector('th')?.textContent)));
        const customerLink = doc.querySelector('a[href*="/customer/update?id="]');
        let sessionOperator = '';
        for (const node of doc.querySelectorAll('[data-user-name],form[action*="logout"] button,a[href*="logout"],.user-name')) {
            const text = clean(node.getAttribute('data-user-name') || node.textContent);
            const candidate = (text.match(/\(([^)]+)\)/)?.[1] || text).replace(/^(?:выход|выйти|logout)\s*/i, '').trim();
            if (candidate.length >= 3 && !/^(?:выход|выйти|logout)$/i.test(candidate)) { sessionOperator = candidate; break; }
        }
        if (!sessionOperator) {
            const headerOperators = new Set();
            for (const node of doc.querySelectorAll('header nav .header-user-info .text-nowrap > small')) {
                const match = clean(node.textContent).match(/^(.+?)\s+[-–—]\s+(.+)$/u);
                if (!match || !/^(?:Диспетчер|Оператор|Администратор|Менеджер|Руководитель)(?:\s|$)/iu.test(match[1])) continue;
                const candidate = match[2];
                if (candidate.length <= 120 && /^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){1,3}$/u.test(candidate)) headerOperators.add(candidate);
            }
            if (headerOperators.size === 1) sessionOperator = [...headerOperators][0];
        }
        let linkedCustomer='';try {const target=new URL(customerLink?.getAttribute('href') || '',page);if(target.origin===page.origin && nativeCustomerTarget(target))linkedCustomer=target.searchParams.get('id');}catch(_){}
        const selectedCustomers=[...new Set(forms.flatMap(form=>form.fields).filter(field=>field.name==='CustomerRequest[customer_id]' && /^[1-9]\d*$/.test(field.value)).map(field=>field.value))];
        const customerId = nativeCustomerTarget(page) ? page.searchParams.get('id') : selectedCustomers.length===1 ? selectedCustomers[0] : selectedCustomers.length ? '' : linkedCustomer;
        const next = doc.querySelector('.pagination .next:not(.disabled) a,.pagination a[rel="next"]');
        const requestList = rows.length > 0 || !!doc.querySelector('.grid-view table,.kv-grid-table,table[data-request-list]')
            || (!!doc.querySelector('[name="CRSearch[phone]"]') && !!doc.querySelector('table'));
        const nativeComments = {}, commentConflicts = [];
        for (const name of ['comments', 'comments_service', 'date_changes', 'partner_comment']) {
            const candidates = Array.from(doc.querySelectorAll('input,textarea')).filter(element =>
                element.id === 'customerrequest-' + name || element.name === 'CustomerRequest[' + name + ']');
            const visible = candidates.filter(element => element.type !== 'hidden');
            const element = visible.find(element => !element.disabled && !element.matches(':disabled') && !element.readOnly)
                || visible.find(element => !element.disabled && !element.matches(':disabled')) || visible[0] || candidates[0];
            if (!element) continue;
            // Two active controls with different values are not a safe snapshot.
            if (visible.filter(item => !item.disabled && !item.matches(':disabled')).some(item => String(item.value) !== String(element.value))) {
                commentConflicts.push(name); continue;
            }
            nativeComments[name] = { name: element.name || '', id: element.id || '', type: String(element.type || '').toLowerCase(), tag: element.tagName.toLowerCase(),
                value: String(element.value ?? ''), disabled: !!element.disabled || element.matches(':disabled'), readOnly: !!element.readOnly };
        }
        // The CRM's comments-only action is also used by the supplied reference
        // extension (crm.js/saveCardComments). It posts short names to THIS card,
        // independently of how the page bundles its JS or renders readonly text.
        // Never take the write destination from executable page content.
        let commentsSave = null;
        const commentButton = doc.getElementById('actSaveComment');
        const canSaveComments = !!commentButton && !commentButton.disabled && !commentButton.matches(':disabled')
            && commentButton.getAttribute('aria-disabled') !== 'true' && !commentButton.classList.contains('disabled');
        const completeComments = ['comments','comments_service','date_changes','partner_comment'].every(name =>
            nativeComments[name] && !nativeComments[name].disabled && nativeComments[name].type !== 'hidden');
        const customerHistory = nativeCustomerHistory(doc,page,customerId);
        const {customerPhone,customerPhones} = nativeCustomerPhones(doc,page,customerId);
        const {paymentSummary,auditInfo} = nativeFacts(doc,page,customerHistory);
        const audioRoute = nativeAudioRoute(doc,scripts,page);
        // Read a small, literal native command vocabulary. Page JavaScript is
        // never evaluated and a link can only target this exact request.
        const actions = [];
        // Permissions can render the branch cancellation with a different
        // literal flag. Read that flag from the native function, never execute it.
        const branchValues=new Set(), waitingRecipes=[];
        for(const script of scripts){
            if(!/function\s+saveAndClose\s*\(/.test(script))continue;
            // Case22 creates/sets this status control and appends this flag in
            // the native CRM. Require those literal operations; never run JS.
            const waiting=script.match(/\bcase\s+22\s*:([\s\S]*?)(?=\bcase\s+\d+\s*:|$)/)?.[1] || '';
            const waitingInputs=[...waiting.matchAll(/<input\b[^>]{1,500}>/gi)].map(item=>item[0].replace(/\\(["'])/g,'$1'));
            if(waitingInputs.some(item=>/\bname\s*=\s*["']precheck_to_await["']/.test(item) && /\bvalue\s*=\s*["']1["']/.test(item))
                && waitingInputs.some(item=>/\bname\s*=\s*["']CustomerRequest\[status\]["']/.test(item))
                && /\$\(\s*(["'])#customerrequest-status\1\s*\)\s*\.val\(\s*(?:1|["']1["'])\s*\)/.test(waiting))
                waitingRecipes.push({'CustomerRequest[status]':'1',precheck_to_await:'1'});
            const block=script.match(/\bcase\s+11\s*:([\s\S]*?)(?=\bcase\s+\d+\s*:|$)/)?.[1] || '';
            for(const fragment of block.matchAll(/<input\b[^>]{1,500}>/gi)){
                const attrs=fragment[0].replace(/\\(["'])/g,'$1');
                if(/\bname\s*=\s*["']cancel_branch["']/.test(attrs)){
                    const value=attrs.match(/\bvalue\s*=\s*["']([12])["']/)?.[1];if(value)branchValues.add(value);
                }
            }
        }
        const branchFlag=branchValues.size===1?[...branchValues][0]:'2';
        const recipes = {1:['save_close','Сохранить и закрыть',{save_close:'1'}],2:['not_taken','Не оформлена',{not_taken:'1'}],
            10:['cancel_kc','Отмена КЦ',{cancel_kc:'1'}],11:['cancel_branch','Отмена филиала',{cancel_branch:branchFlag}],
            12:['cancel_regional','Отмена регионала',{cancel_regional:'1'}],20:['on_precheck','На уточнение',{on_precheck:'1'}],
            ...(waitingRecipes.length ? {22:['precheck_to_await','Ожидает',waitingRecipes[0]]} : {}),
            25:['not_taken_to_await','В ожидание',{not_taken_to_await:'1'}],26:['to_not_created','Не создана',{to_not_created:'1'}],
            41:['create_claim','Создать претензию',{create_claim:'1'}],50:['create_draft','В черновик',{create_draft:'1'}],
            60:['rejected_by_customer','Отказались',{rejected_by_customer:'1'}],61:['unroll_finish','Вернуть в работу',{unroll_finish:'1'}]};
        const request = forms.find(form => form.id === 'customerRequestForm');
        for (const button of request?.buttons || []) {
            if (button.disabled || button.action || button.method && !/^post$/i.test(button.method)) continue;
            if (button.type === 'submit' && !button.onclick && /^(?:Сохранить(?: изменения)?)$/i.test(button.text)) {
                actions.push({key:'save',label:button.text,enabled:true,type:'submit',fields:{}}); continue;
            }
            const match = button.onclick.trim().match(/^saveAndClose\(\s*this\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)\s*;?$/);
            const recipe = match && recipes[Number(match[1])];
            if (!recipe || Number(match[1]) === 11 && match[2] !== undefined && !['0','1'].includes(match[2])) continue;
            if ([20,22].includes(Number(match[1])) && (button.type !== 'submit' || match[2] !== undefined)) continue;
            actions.push({key:recipe[0],label:button.text || recipe[1],enabled:true,type:'submit',fields:recipe[2]});
        }
        for (const anchor of doc.querySelectorAll('a[href]')) {
            if (anchor.classList.contains('disabled') || anchor.getAttribute('aria-disabled') === 'true') continue;
            let target; try {target = new URL(anchor.getAttribute('href'),page);} catch (_) {continue;}
            const kind = target.pathname.match(/^\/admin\/domain\/customer-request\/(take-to-work|create-claim|cancel-to-not-taken|cancel-transaction)$/)?.[1];
            if (!kind || target.origin !== page.origin || target.username || target.password || target.searchParams.get('id') !== page.searchParams.get('id')
                || target.searchParams.getAll('id').length !== 1 || Array.from(target.searchParams.keys()).some(key => key !== 'id')) continue;
            const method = String(anchor.getAttribute('data-method') || 'GET').toUpperCase();
            if (!['GET','POST'].includes(method)) continue;
            const key = {'take-to-work':'take','create-claim':'create_claim','cancel-to-not-taken':'not_taken','cancel-transaction':'cancel_transaction'}[kind];
            if (!actions.some(item=>item.key === key)) actions.push({key,label:clean(anchor.textContent),enabled:true,type:'link',method,url:target.href,fields:{}});
        }
        const requestId = page.searchParams.get('id');
        const requestElement = doc.getElementById('customerRequestForm');
        const hasClaim = !!request?.fields.some(item=>/\[(?:is_claim|has_claim)\]$/.test(item.name) && (item.type === 'checkbox' ? item.checked : item.value === '1'))
            || Array.from(doc.querySelectorAll('.bg-has_claim,[data-has-claim="1"],.has-claim,[data-crm-existing-claim="true"]')).some(node=>{
                if(node.closest('a[href*="create-claim"],button[name="create_claim"]')) return false;
                const owner = node.closest('[data-request-id]');
                if(owner) return owner.getAttribute('data-request-id') === requestId;
                const row = node.closest('tr,[data-key]');
                if(row) return Array.from(row.querySelectorAll('a[href*="customer-request/update"]')).some(link=>{try{return new URL(link.getAttribute('href'),page).searchParams.get('id') === requestId;}catch(_){return false;}});
                return !!requestElement?.contains(node);
            }) || Array.from(doc.querySelectorAll('a[href]')).some(link=>{
                if(link.closest('tr,[data-key]')) return false;
                try {const target=new URL(link.getAttribute('href'),page);return target.origin===page.origin && /^\/admin\/domain\/(?:cr-claim|customer-request-claim)\/(?:update|view)\/?$/.test(target.pathname) && /^\d+$/.test(target.searchParams.get('id') || '');}catch(_){return false;}
            });
        if (page.pathname === '/admin/domain/customer-request/update' && /^\d+$/.test(page.searchParams.get('id') || '')
            && !page.username && !page.password && completeComments && (!nativeComments.partner_comment.readOnly || canSaveComments)) {
            commentsSave = {url:new URL(page.pathname + '?id=' + page.searchParams.get('id'),page.origin).href,mode:'comments-only'};
        }
        const callUrls=[...new Set(Array.from(doc.querySelectorAll('#customerInfo a[href]')).filter(link=>link.querySelector('.fa-phone-square')||/^(?:callto|tel):/iu.test(link.getAttribute('href')||'')).map(link=>link.getAttribute('href')||'').filter(href=>/^(?:callto|tel):[+0-9(). -]+(?:;sip_id=\d+)?$/iu.test(href)))];
        const callUrl=callUrls.length===1?callUrls[0]:'';
        return { customerPhone,customerPhones,customerHistory,paymentSummary,auditInfo,audioAvailable:!!audioRoute,audioRoute, callUrl, cityNotice, forms, errors: Array.from(new Set(errors)), csrfParam, csrfToken,
            login: !!doc.querySelector('input[type="password"],[name^="LoginForm["]'), rows, requestList, hasNext: !!next,
            status: clean(statusLabel?.parentElement?.textContent).replace(/^Статус:\s*/, ''),
            author: auditInfo.find(item=>/^(?:Автор|Создал(?:а)?|Кем создан[ао]?)$/iu.test(item.label))?.value || clean(authorLabel?.parentElement?.textContent), sessionOperator, createdAt: clean(createdField?.value || createdRow?.querySelector('td')?.textContent || auditInfo.find(item=>/^(?:Создан[ао]?|Дата создания|Время создания)$/iu.test(item.label))?.value),
            customerId: /^\d+$/.test(customerId) ? customerId : '',
            nativeComments, commentsSave, commentConflicts, actions, hasClaim, optionFragment, standaloneSelects, title: clean(doc.title), options: Array.from(doc.querySelectorAll('option')).map(option => ({ id: option.value, text: clean(option.textContent), disabled: !!option.disabled || !!option.parentElement?.disabled })) };
    }
    return { parse, parseAudioRecords };
});
