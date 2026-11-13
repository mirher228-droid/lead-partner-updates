/* CRM form service for an extension page. No AI, remote processing, or automatic write retries. */
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.LeadChatCrmService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const BASES = Object.freeze({ kp: 'https://kp-lead-centre.ru', mnc: 'https://mnc-lead-centre.ru', bt: 'https://bt-lead-centre.ru' });
    const PATH = '/admin/domain/customer-request/';
    // Commit visibility can lag behind its POST response. Re-read only.
    const DEFAULT_VERIFY_DELAYS = Object.freeze([0, 150, 350, 650, 1000]);
    async function readVerifiedWithRetry(read, verifyRecord, accepts = () => true, delays = DEFAULT_VERIFY_DELAYS) {
        let current, verified, lastError;
        for(const delay of delays) {
            if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
            try {
                current=await read();
                verified=verifyRecord(current);
                if(verified.ok && accepts(current))return {current,verified};
            }catch(error){lastError=error;}
        }
        if(!current)throw lastError || new Error('CRM не ответила на проверку сохранённой карточки.');
        return {current,verified};
    }
    const CUSTOMER_PATH = '/admin/domain/customer/update';
    const N = Object.freeze({ city: 'CustomerRequest[city_id]', work: 'CustomerRequest[appliance_type_id]', type: 'CustomerRequest[type]',
        partner: 'CustomerRequest[partner_id]', date: 'CustomerRequest[opened_at]', time: 'cr_opened_at_time',
        reason: 'CustomerRequest[cr_form_extra][timeChangeReason]', customer: 'CustomerRequest[customer_id]' });
    const ACTIVE = /^(?:Ожидает|В пути|В работе|Модерац|На уточнени|Назначен|Принят|Подтвержд|Едет)/i;
    const CLOSED = /^(?:Готов|Выполн|Оплачен|Отказ|Отмен|Не оформлен|Не создан|Брак|Закрыт|НФ$)/i;
    const RESTORE_ACTIONS = ['cancel_transaction','unroll_finish','take','not_taken_to_await'];
    const clarification = status => /^На\s+уточнени[еи](?:\s|$)/iu.test(str(status).trim());
    const HISTORY = 'CustomerRequest[date_changes]';
    const CALL_CHECK = 'CustomerRequest[is_need_call_check]';
    const callCheckState = value => value === true || /^(?:1|true|on|yes)$/i.test(str(value).trim());
    const PARTNER_COMMENT = 'CustomerRequest[partner_comment]';
    const NOT_TAKEN_COMMENT = 'НФ Клиент не знает когда сможет принять мастера';
    const appendUniqueLine = (value, line) => {
        const previous = str(value), key = str(line).trim().toLocaleLowerCase('ru');
        return previous.split(/\r?\n/).some(item => item.trim().toLocaleLowerCase('ru') === key)
            ? previous : [previous, line].filter(Boolean).join('\n');
    };
    const sharedInFlight = new Map();
    const sharedQueues = new Map();
    const clone = value => JSON.parse(JSON.stringify(value));
    const str = value => String(value == null ? '' : value);
    function normalizeAddressField(name, value) {
        const limit = /^(?:Customer|CustomerRequest)\[address_(?:entrance|porch)\]$/.test(name) ? 3
            : /^(?:Customer|CustomerRequest)\[address_floor\]$/.test(name) ? 2 : 0;
        if (!limit) return value;
        const compact = str(value).replace(/[\p{White_Space}\uFEFF]/gu, '');
        if ([...compact].length > limit) throw new Error('Поле «' + (limit === 2 ? 'Этаж' : 'Подъезд') + '» должно содержать максимум ' + limit + ' символа без пробелов.');
        return compact;
    }
    const normalizeAddressFields = input => Object.fromEntries(Object.entries(input || {}).map(([name, value]) => [name, normalizeAddressField(name, value)]));
    const phone10 = value => {
        const digits = str(value).replace(/\D/g, '');
        return /^\d{10}$/.test(digits) ? digits : /^[78]\d{10}$/.test(digits) ? digits.slice(1) : '';
    };
    const maskPhone = value => { const d = phone10(value); return '+7 ' + d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6); };
    const phoneVariants = value => { const d = phone10(value); return ['7' + d, maskPhone(d), d, '8' + d]; };
    const operationPhone = args => phone10(args.fields?.[args.primaryPhoneField] || args.fields?.['Customer[phone]'] || args.phone || Object.entries(args.fields || {}).find(([name, value]) => /\[contact_phones\].*\[v\]$/.test(name) && phone10(value).length === 10)?.[1]);
    const field = (form, name) => form?.fields.find(item => item.name === name && item.type !== 'hidden') || form?.fields.find(item => item.name === name);
    const serviceField = form => form?.fields.find(item => item.tag === 'select' && /sub.*(?:appl|type)|(?:appl|service).*sub|subappl/i.test(item.name))
        || form?.fields.find(item => item.tag === 'select' && /Вид\s+услуг/i.test(item.label));
    const isCustomerField = name => /^Customer\[(?:first_name|age|phone(?:_extra_[1-3])?|address_[\w]+)\]$/.test(name)
        || /^Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[(?:v|title)\]$/.test(name);
    const editableName = name => /^(?:CustomerRequest\[[a-zA-Z_]+\](?:\[[a-zA-Z_]+\])?(?:\[\])?|cr_opened_at_time)$/.test(name) || isCustomerField(name);
    const protectedName = name => [N.customer, 'CustomerRequest[id]', 'CustomerRequest[req_status]', 'CustomerRequest[status]', 'CustomerRequest[status_id]'].includes(name)
        || /author|created_by|employee|server|token|csrf/i.test(name);
    const reject = (error, extra) => ({ ok: false, state: 'rejected', error, ...extra });
    const uncertain = (error, extra) => ({ ok: false, state: 'uncertain', error, ...extra });
    const hash = text => { let result = 2166136261; for (const ch of text) result = Math.imul(result ^ ch.charCodeAt(0), 16777619); return (result >>> 0).toString(16); };
    const revision = form => hash(JSON.stringify(form.fields.filter(item => !/csrf/i.test(item.name) && !['submit', 'button', 'reset'].includes(item.type))
        .map(item => [item.name, item.value, item.checked, item.disabled, item.options]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    function isoDate(value) {
        const text = str(value).trim();
        let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
        if (match) {
            const iso = match[1] + '-' + match[2] + '-' + match[3];
            const date = new Date(iso + 'T00:00:00Z');
            return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
        }
        match = text.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})(?:$|\s)/);
        return match ? isoDate(match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0')) : '';
    }
    function dateFor(value, sample) {
        const iso = isoDate(value);
        if (!iso) throw new Error('Укажите корректную дату визита.');
        if (/^\d{4}-/.test(sample || '')) return iso;
        const separator = /^\d{1,2}-/.test(sample || '') ? '-' : '.';
        return iso.slice(8) + separator + iso.slice(5, 7) + separator + iso.slice(0, 4);
    }
    function normalizeValue(name, value) {
        if (typeof value === 'boolean') value = value ? '1' : '0';
        if (name === N.date) return isoDate(value);
        if (name === N.time) return str(value).trim().slice(0, 5).padStart(5, '0');
        // CRM strips leading empty lines from this native comment widget.
        // Compare its text without those lines; preserve all submitted content.
        if (name === 'CustomerRequest[comments_service]') return str(value).replace(/\r\n?/g, '\n').replace(/^\n+/, '');
        if (/\[(?:phone|phone_extra_[1-3])\]|\[contact_phones\].*\[v\]/.test(name)) return phone10(value);
        return Array.isArray(value) ? value.map(str).sort().join('\u001f') : str(value).replace(/\r\n?/g, '\n').trim();
    }
    function publicForm(form) {
        const fields = form.fields.filter(item => editableName(item.name) && !protectedName(item.name) && (item.type !== 'hidden' || item.name === N.time || item.name === N.reason)).map(item => ({
            name: item.name, id: item.id, label: item.name === N.time ? 'Время визита' : item.label, type: item.name === N.time && item.type === 'hidden' ? 'time' : item.type, value: item.value, checked: item.checked,
            multiple: item.multiple, required: item.required, disabled: item.disabled, readOnly: item.readOnly || item.name === HISTORY, options: item.name === N.reason && item.type === 'hidden' ? ['Клиент','Диспетчер','Директор'].map(id=>({id,text:id})) : clone(item.options || [])
        }));
        const values = {};
        for (const item of fields) values[item.name] = form.values[item.name];
        return { fields, values, revision: revision(form), capabilities: { save: true, reschedule: !!field(form, N.date) && !!field(form, N.time) } };
    }
    function lists(form) {
        const options = name => clone(field(form, name)?.options || []);
        return { cities: options(N.city), partners: options(N.partner), adverts: options('CustomerRequest[advert_id]'),
            types: options(N.type), workTypes: options(N.work), services: clone(serviceField(form)?.options || []) };
    }
    function serialize(form, changes, csrf) {
        const body = new URLSearchParams();
        for (const item of form.fields) {
            if (item.disabled || ['submit', 'button', 'reset', 'file', 'image'].includes(item.type)) continue;
            if ((item.type === 'checkbox' || item.type === 'radio') && !item.checked) continue;
            for (const value of item.multiple ? item.values || [] : [item.value]) body.append(item.name, value);
        }
        for (const [name, value] of Object.entries(changes || {})) {
            body.delete(name);
            for (const item of Array.isArray(value) ? value : [value]) body.append(name, typeof item === 'boolean' ? (item ? '1' : '0') : str(item));
        }
        if (!body.get(csrf.param) && csrf.token) body.set(csrf.param, csrf.token);
        if (!body.get(csrf.param)) throw new Error('В форме CRM нет токена защиты. Обновите вход в выбранную базу.');
        return body;
    }
    function nativeSubmit(form, body, creating) {
        // Use only an ordinary live submit control. Never execute or infer arbitrary onclick code.
        const button = (form.buttons || []).find(item => item.type === 'submit' && !item.disabled && !item.onclick && !item.action && (!item.method || /^post$/i.test(item.method))
            && /^(?:Сохранить(?: изменения)?|Создать(?: заявку)?)$/i.test(item.text) && item.name !== 'save_close');
        if (button) {
            body.delete('save_close');
            if (button.name) body.set(button.name, button.value);
            return { mode: 'native', name: button.name, text: button.text };
        }
        // The supplied extension documents save_close only for creation. Ordinary update
        // uses a plain form POST (crmact fields recipe / отправитьФорму, no status flag).
        if (creating) body.set('save_close', '1');
        else body.delete('save_close');
        return { mode: creating ? 'legacy-save-close' : 'plain-form' };
    }
    function nativeCommand(form,body,command){
        if(command?.type!=='submit')return;
        if(['on_precheck','precheck_to_await'].includes(command.key))for(const name of ['save_close','on_precheck','precheck_to_await'])body.delete(name);
        for(const [name,value]of Object.entries(command.fields))body.set(name,value);
        if(['cancel_kc','cancel_branch','cancel_regional'].includes(command.key)){
            const status=form.fields.find(item=>item.id==='customerrequest-status' && item.name==='CustomerRequest[status]' && !item.disabled);
            if(status && !status.value && (status.tag!=='select' || status.options?.some(item=>item.id==='1' && !item.disabled)))body.set(status.name,'1');
        }
    }
    function resolveBooleanChoice(field, value) {
        const raw = str(value).trim().toLowerCase();
        if (!raw) return '';
        const options = clone(field?.options || []).map(item => ({ id: str(item?.id ?? item?.value ?? item?.key), label: str(item?.label ?? item?.text ?? item?.name ?? item?.title ?? item?.id ?? item?.value) }))
            .filter(item => item.id && !item.disabled);
        if (!options.length) return '';
        const exact = options.find(item => item.id === raw || item.id === str(value));
        if (exact) return exact.id;
        const wantTrue = /^(?:1|true|yes|да|есть|нужен|нужно|подключен|подключён)$/i.test(raw);
        const wantFalse = /^(?:0|false|no|нет|не нужен|не нужно|отсутствует|без|none)$/i.test(raw);
        const pick = test => options.find(item => test.test(item.label) || test.test(item.id));
        if (wantTrue) return (pick(/^(?:1|да|есть|yes|true)$/i) || pick(/есть|домофон|подключ/i) || options[0]).id;
        if (wantFalse) return (pick(/^(?:0|нет|no|false)$/i) || pick(/нет|отсутств/i) || options[0]).id;
        return '';
    }
    function draftToFields(draft, metadata) {
        draft = draft || {};
        const mapping = { cityId: N.city, workId: N.work, applianceTypeId: N.work, serviceId: metadata?.fieldNames?.service,
            phone: metadata?.fieldNames?.phone || 'Customer[phone]', clientName: 'Customer[first_name]', age: 'Customer[age]', street: 'Customer[address_street]',
            house: 'Customer[address_building]', apartment: 'Customer[address_office]', settlement: 'Customer[address_locality]',
            entrance: 'Customer[address_entrance]', floor: 'Customer[address_floor]', intercom: 'Customer[address_has_intercom]',
            date: N.date, time: N.time, comments: 'CustomerRequest[comments]', commentsService: 'CustomerRequest[comments_service]',
            partnerComment: 'CustomerRequest[partner_comment]', partnerId: N.partner, requestType: N.type,
            farRide: 'CustomerRequest[is_far_ride]', callCheck: 'CustomerRequest[is_need_call_check]', callBeforeVisit: 'CustomerRequest[is_need_call_before_visit]',
            urgent: 'CustomerRequest[is_urgent]', zakrep: 'CustomerRequest[is_zakrep]', feedback: 'CustomerRequest[is_req_fback]' };
        const result = {};
        const fields = Array.isArray(metadata?.form?.fields) ? metadata.form.fields : [];
        const known = fields.length ? new Set(fields.map(item => item.name)) : null;
        const aliases={street:['Customer[address_street]','CustomerRequest[address_street]'],house:['Customer[address_building]','CustomerRequest[address_building]'],
            apartment:['Customer[address_office]','CustomerRequest[address_office]'],settlement:['Customer[address_locality]','CustomerRequest[address_locality]'],
            entrance:['Customer[address_entrance]','Customer[address_porch]','CustomerRequest[address_entrance]','CustomerRequest[address_porch]'],
            floor:['Customer[address_floor]','CustomerRequest[address_floor]'],intercom:['Customer[address_has_intercom]','Customer[address_intercom]','CustomerRequest[address_has_intercom]','CustomerRequest[address_intercom]']};
        if(known) for(const [key,names] of Object.entries(aliases)) mapping[key]=names.find(name=>known.has(name)) || mapping[key];
        for (const [key, name] of Object.entries(mapping)) if (name && Object.prototype.hasOwnProperty.call(draft, key)) {
            if (known && !known.has(name) && (['settlement','entrance','floor','intercom','farRide','callCheck','callBeforeVisit','urgent','zakrep','feedback'].includes(key) || draft[key] === '' || draft[key] === undefined || draft[key] === null)) continue;
            let value = draft[key];
            if (key === 'intercom') {
                if (value === '' || value === undefined || value === null) continue;
                const fieldMeta = fields.find(item => item.name === name);
                value = resolveBooleanChoice(fieldMeta, value) || value;
            }
            result[name] = value;
        }
        if (Array.isArray(draft.phonesExtra)) draft.phonesExtra.slice(0, 3).forEach((value, index) => {
            result[metadata?.fieldNames?.phonesExtra?.[index] || 'Customer[phone_extra_' + (index + 1) + ']'] = value;
        });
        return result;
    }
    function create(config) {
        config = config || {};
        const scope = str(config.scope || 'local');
        const storageKey = 'leadchatCrmOperationsV1:' + scope;
        const preparedCreates = new Map();
        const preparedRequests = new Map();
        const preparedDropdowns = new WeakMap();
        const nativeFormTtl = 30000;
        const sentProgress = new Map();
        const writeGateAccepted = new Set();
        const storage = config.storage || (root.chrome?.storage?.local ? {
            get: async key => (await root.chrome.storage.local.get(key))[key],
            set: async (key, value) => root.chrome.storage.local.set({ [key]: value })
        } : null);
        const parseDocument = config.parseDocument || ((html, url) => root.LeadChatCrmHtml.parse(html, url));
        const cityNoticeCache = new Map();
        const request = config.request || (async init => fetch(init.url, { method: init.method, credentials: 'include', headers: init.headers,
            ...(init.body !== undefined ? { body: init.body } : {}), ...(init.signal ? { signal: init.signal } : {}) }));
        function baseUrl(base) { if (!BASES[base]) throw new Error('Выберите базу КП, МНЧ или БТ.'); return BASES[base]; }
        function safeUrl(base, value) {
            const url = new URL(value, baseUrl(base));
            if (url.origin !== BASES[base] || !/^\/(?:admin\/domain\/|api\/customer\/search$)/.test(url.pathname)) throw new Error('Адрес операции CRM не разрешён.');
            return url.href;
        }
        async function locked(key, work, global) {
            const full = 'leadchat-crm:' + (global ? 'global' : scope) + ':' + key;
            if (root.navigator?.locks?.request) return root.navigator.locks.request(full, work);
            const before = sharedQueues.get(full) || Promise.resolve();
            const next = before.catch(() => {}).then(work);
            sharedQueues.set(full, next);
            try { return await next; } finally { if (sharedQueues.get(full) === next) sharedQueues.delete(full); }
        }
        async function journalChange(work) {
            if (!storage) throw new Error('Хранилище операций недоступно. Форма не отправлена.');
            return locked('journal', async () => {
                const all = (await storage.get(storageKey)) || {};
                const result = await work(all);
                await storage.set(storageKey, all);
                return result;
            });
        }
        async function recordOperation(id, patch) { return journalChange(all => { all[id] = { ...all[id], ...clone(patch), updatedAt: Date.now() }; return clone(all[id]); }); }
        async function http(base, url, options) {
            options = options || {};
            const method = options.method || 'GET';
            const target = safeUrl(base, url);
            const controller = method === 'GET' && typeof AbortController !== 'undefined' ? new AbortController() : null;
            let timer;
            const timeout = new Promise((_, fail) => { timer = setTimeout(() => { controller?.abort(); fail(new Error(method === 'GET' ? 'CRM не ответила на чтение.' : 'CRM не ответила после отправки.')); }, method === 'GET' ? Math.min(options.readTimeoutMs || Infinity, config.readTimeoutMs || 20000) : (config.writeTimeoutMs || 120000)); });
            try {
                const pending = Promise.resolve(request({ url: target, method,
                    ...(options.fullPage === true ? { fullPage: true } : {}),
                    headers: { ...(options.fullPage === true ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
                    ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}), ...(options.headers || {}) },
                    ...(options.body !== undefined ? { body: str(options.body) } : {}), ...(controller ? { signal: controller.signal } : {}) })).then(async response => {
                    const headers = response.headers || {};
                    const getHeader = name => typeof headers.get === 'function' ? headers.get(name) : Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
                    let responseText = '', bodyReadError = '';
                    try { responseText = typeof response.text === 'function' ? await response.text() : str(response.text ?? response.html ?? ''); }
                    catch (error) { if (method === 'GET') throw error; bodyReadError = error?.message || 'Ответ CRM оборвался при чтении.'; }
                    return { status: Number(response.status || 200), url: response.url || target,
                        redirect: getHeader('X-Redirect') || getHeader('Location') || '',
                        text: responseText, bodyReadError };
                });
                return await Promise.race([pending, timeout]);
            } finally { clearTimeout(timer); }
        }
        let reportedSessionOperator = '', pendingSessionOperator = '';
        function reportSessionOperator(document, response, base) {
            try { const url = new URL(response.url); if (url.origin !== BASES[base] || !url.pathname.startsWith('/admin/') || response.status < 200 || response.status >= 300) return; } catch (_) { return; }
            const displayName = document?.sessionOperator;
            if (typeof displayName !== 'string' || !displayName || displayName.length > 120 || displayName !== displayName.trim() || /[\x00-\x1f\x7f]/.test(displayName) || displayName === reportedSessionOperator || displayName === pendingSessionOperator) return;
            let receipt;
            try {
                receipt = root.LeadPartnerEmployeesClient?.reportCrmSession?.(displayName);
                if (receipt == null) {
                    if (typeof root.chrome?.runtime?.sendMessage !== 'function') return;
                    receipt = root.chrome.runtime.sendMessage({type:'LP_EMPLOYEES_IDENTITY',schema:1,source:'crm-session',displayName});
                }
            } catch (_) { return; }
            pendingSessionOperator = displayName;
            // Do not await identity storage on the CRM response path. Deduplicate
            // only after persistence is acknowledged; a failed delivery can retry
            // when the next already-needed CRM response is parsed.
            void Promise.resolve(receipt).then(result => {
                if (result === true || result?.ok === true) reportedSessionOperator = displayName;
            }).catch(() => {}).finally(() => { if (pendingSessionOperator === displayName) pendingSessionOperator = ''; });
        }
        async function documentAt(base, url, options) {
            const response = await http(base, url, options);
            const document = await parseDocument(response.text, response.url);
            if (document.login || /\/(?:login|default\/index)(?:[/?#]|$)/i.test(response.url)) throw new Error('Войдите в CRM ' + base.toUpperCase() + ' и повторите чтение.');
            if (response.status >= 400) throw new Error('CRM ответила ошибкой ' + response.status + '.');
            reportSessionOperator(document, response, base);
            return { response, document };
        }
        async function cityNoticeFor(args, form) {
            const cityId = str(args.cityId || ''), empty = {cityNotice:'',cityNoticeCityId:cityId};
            if (!/^\d+$/.test(cityId)) return empty;
            const now = new Date(), today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
            const date = isoDate(args.date) || isoDate(form.values[N.date]) || today;
            const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(str(args.time)) ? str(args.time) : str(form.values[N.time] || '10:00').slice(0,5);
            const key = [args.base,cityId,date].join('|'), at = Date.now();
            for (const [cachedKey,cached] of cityNoticeCache) if (at-cached.at >= 30000) cityNoticeCache.delete(cachedKey);
            if (cityNoticeCache.has(key)) return cityNoticeCache.get(key).pending;
            // Read the same fixed endpoint as the CRM city selector. Share and
            // cache even empty replies, so changing a service does not reload it.
            const pending = (async () => {
                try {
                    const query = new URLSearchParams({city_id:cityId,on_date:date.slice(8)+'-'+date.slice(5,7)+'-'+date.slice(0,4),on_time:time,cur_time:time});
                    const page = await documentAt(args.base, PATH+'city-timetable?'+query,{readTimeoutMs:1800});
                    const returned = new URL(page.response.url);
                    if (returned.origin !== BASES[args.base] || returned.pathname !== PATH+'city-timetable' || returned.searchParams.get('city_id') !== cityId) return empty;
                    return {cityNotice:page.document.cityNotice || '',cityNoticeCityId:cityId};
                } catch (_) { return empty; }
            })();
            cityNoticeCache.set(key,{at,pending});
            return pending;
        }
        function requestForm(document) {
            const forms = document.forms || [];
            const full = form => !!field(form, N.city) && form.fields.some(item => item.name === N.work || item.name === N.type || item.name === N.customer);
            const fallback = form => form.fields.some(item => item.name === N.work || item.name === N.type || item.name === N.customer)
                && form.fields.filter(item => /^CustomerRequest\[/.test(item.name)).length >= 3;
            // A live Yii page may render city through a dynamic widget. Accept
            // the actual update form only when several independent request
            // fields are present; never mistake a bare comment/search form for it.
            return forms.find(form => form.id === 'customerRequestForm' && (full(form) || fallback(form)))
                || forms.find(full) || forms.find(fallback);
        }
        function customerForm(document) { return document.forms.find(form => form.fields.some(item => item.name === 'Customer[first_name]' || item.name === 'Customer[address_street]')); }
        function assertCustomerUrl(base, response, id) {
            const url = new URL(response.url, BASES[base]);
            if (url.origin !== BASES[base] || url.pathname !== CUSTOMER_PATH || url.searchParams.getAll('id').length !== 1 || url.searchParams.get('id') !== str(id)) throw new Error('CRM вернула другую карточку клиента вместо № ' + id + '.');
        }
        function names(form, customer, preferredPhone) {
            const cf = customer?.form || form;
            const phones = cf.fields.filter(item => /^Customer\[contact_phones\].*\[v\]$/.test(item.name) && !item.disabled);
            const primary = phones.find(item => phone10(item.value).length === 10) || phones[0];
            const wanted = phone10(preferredPhone);
            const matched = wanted ? cf.fields.find(item => !item.disabled && item.type !== 'hidden' && /^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[v\]$/.test(item.name) && phone10(item.value) === wanted) : null;
            const selected = matched?.name || cf.fields.find(item => item.name === 'Customer[phone]' && !item.disabled && item.type !== 'hidden')?.name || primary?.name || 'Customer[phone]';
            return { service: serviceField(form)?.name || '', workType: N.work, date: N.date, time: N.time,
                phone: selected,
                phonesExtra: field(cf, 'Customer[phone_extra_1]') ? [1, 2, 3].map(number => 'Customer[phone_extra_' + number + ']').filter(name => name !== selected) : phones.filter(item => item.name !== selected).map(item => item.name) };
        }
        function remapPrimaryPhone(input, form, sourceName) {
            const output = { ...input };
            const targetName = names(form).phone;
            if (!sourceName && Object.prototype.hasOwnProperty.call(output, 'Customer[phone]')) sourceName = 'Customer[phone]';
            if (!sourceName) {
                const candidates = Object.keys(output).filter(name => /^Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[v\]$/.test(name));
                // Without old metadata only an unchanged sole primary value proves the alias.
                if (candidates.length === 1 && !field(form, candidates[0]) && phone10(output[candidates[0]]) && phone10(output[candidates[0]]) === phone10(form.values[targetName])) sourceName = candidates[0];
            }
            if (!sourceName || sourceName === targetName || !Object.prototype.hasOwnProperty.call(output, sourceName) || field(form, sourceName)) return output;
            if (!/^(?:Customer\[phone\]|Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[v\])$/.test(sourceName) || !field(form, targetName)) return output;
            if (Object.prototype.hasOwnProperty.call(output, targetName) && normalizeValue(targetName, output[targetName]) !== normalizeValue(sourceName, output[sourceName])) throw new Error('В полях основного телефона указаны разные номера. Обновите карточку.');
            output[targetName] = output[sourceName];
            delete output[sourceName];
            return output;
        }
        async function findCustomer(base, phone) {
            const d = phone10(phone);
            if (d.length !== 10) throw new Error('Укажите телефон клиента из 10 цифр.');
            const found = new Map();
            const responses = await readWave(phoneVariants(d), query => http(base, '/api/customer/search?q=' + encodeURIComponent(query) + '&_serverKey='));
            for (const response of responses) {
                if (response.status >= 400) throw new Error('Не удалось проверить клиента в CRM: ' + response.status + '.');
                let json;
                try { json = JSON.parse(response.text); } catch (_) { throw new Error('Поиск клиента не ответил данными. Проверьте вход в выбранную базу.'); }
                const items = json.results || json.items || (Array.isArray(json) ? json : null);
                if (!Array.isArray(items)) throw new Error('CRM изменила формат поиска клиента.');
                if (json.pagination?.more || json.has_more || json.hasMore) throw new Error('Поиск клиентов CRM показан не полностью. Единственный клиент не подтверждён.');
                const customers = items.map(item => ({ id: str(item.id ?? item.value), text: str(item.text ?? item.label) })).filter(item => /^\d+$/.test(item.id));
                for (const customer of customers) found.set(customer.id, customer);
            }
            const customers = Array.from(found.values());
            return { customers, id: customers.length === 1 ? customers[0].id : '' };
        }
        async function readWave(items, work) {
            // At most four independent reads run in one wave. Wait for all outcomes
            // before propagating a failure, so late replies cannot affect another search.
            const output = [];
            for (let offset = 0; offset < items.length; offset += 4) {
                const results = await Promise.allSettled(items.slice(offset, offset + 4).map(work));
                const failed = results.find(item => item.status === 'rejected');
                if (failed) throw failed.reason;
                output.push(...results.map(item => item.value));
            }
            return output;
        }
        async function search(args) {
            try {
                const d = phone10(args.phone);
                if (d.length !== 10) return reject('Укажите телефон клиента из 10 цифр.');
                // Opening an existing request needs its phone-filtered list,
                // not the separate customer selector used only by creation.
                const customer = args.lookupOnly === true ? {id:'',customers:[]} : await findCustomer(args.base, d);
                const variants = phoneVariants(d);
                const found = new Map();
                const candidates = new Map();
                let incomplete = false;
                const readList = value => documentAt(args.base, PATH + 'index?' + new URLSearchParams({ 'CRSearch[phone]': value }));
                let pages, failedVariants = 0;
                if (args.lookupOnly === true) {
                    pages = [];
                    // Canonical and native masked formats cover ordinary CRM
                    // lists. Try legacy formats only when they found no card.
                    for (let offset = 0; offset < variants.length; offset += 2) {
                        const batch = await Promise.allSettled(variants.slice(offset, offset + 2).map(readList));
                        failedVariants += batch.filter(item=>item.status==='rejected').length;
                        pages.push(...batch.filter(item=>item.status==='fulfilled').map(item=>item.value));
                        if (pages.some(({document})=>document.requestList && document.rows.some(row=>!phone10(row.phone) || phone10(row.phone)===d))) break;
                    }
                } else pages = await readWave(variants, readList);
                for (const { document } of pages) {
                    if (args.lookupOnly === true && !document.requestList) {failedVariants++;continue;}
                    if (!document.requestList) throw new Error('CRM не вернула список заявок. Отсутствие заявок не подтверждено; проверьте вход в выбранную базу.');
                    incomplete = incomplete || document.hasNext;
                    for (const row of document.rows) {
                        // Native phone filtering can match an additional number
                        // while the list column still shows the primary one.
                        // Prove ownership on that exact card before accepting it.
                        if (args.lookupOnly === true && phone10(row.phone) !== d) {candidates.set(row.id,row);continue;}
                        if (row.phone && phone10(row.phone) && phone10(row.phone) !== d) {incomplete=true;continue;}
                        const previous = found.get(row.id);
                        // Any possibly open status outranks a completed status from another format.
                        if (!previous || (!CLOSED.test(row.status) && CLOSED.test(previous.status)) || (ACTIVE.test(row.status) && !ACTIVE.test(previous.status))) found.set(row.id, row);
                    }
                }
                if (candidates.size) {
                    const verified = await readWave(Array.from(candidates.values()).filter(row=>!found.has(row.id)), async row => {
                        try {
                            const current = await readPrivate({base:args.base,id:row.id});
                            return current.record.phones.includes(d) ? {...row,phone:d,customerId:current.record.customerId} : null;
                        } catch (_) {incomplete=true;return null;}
                    });
                    for (const row of verified) if(row)found.set(row.id,row);
                }
                // Some native lists do not index the customer's static phone.
                // Recover only through the existing customer selector and the
                // history actually rendered on that exact customer card.
                if (args.lookupOnly===true && !found.size) {
                    try {
                        const selected=await findCustomer(args.base,d);
                        if(selected.customers.length>4)incomplete=true;
                        const customers=await Promise.allSettled(selected.customers.slice(0,4).map(async item=>{
                            const page=await documentAt(args.base,CUSTOMER_PATH+'?id='+item.id);
                            assertCustomerUrl(args.base,page.response,item.id);
                            const phones=[...(page.document.customerPhones || []),...(page.document.forms || []).flatMap(form=>form.fields)
                                .filter(field=>/^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[v\]$/.test(field.name)).map(field=>phone10(field.value))];
                            if(!phones.includes(d))return [];
                            const history=page.document.customerHistory;
                            if(!history || history.customerId!==item.id || history.base!==args.base){incomplete=true;return [];}
                            const value=(row,label)=>row.cells[history.columns.find(column=>column.label===label)?.key] || '';
                            return history.rows.map(row=>({id:row.id,url:row.url,phone:d,customerId:item.id,status:value(row,'Статус'),city:value(row,'Город'),date:value(row,'Дата принятия заявки'),text:Object.values(row.cells).join(' ')}));
                        }));
                        for(const result of customers){if(result.status==='rejected'){incomplete=true;continue;}for(const row of result.value)found.set(row.id,row);}
                    }catch(_){incomplete=true;}
                }
                const matches = Array.from(found.values());
                // A failed legacy format cannot prove an empty history. A
                // matching card is still usable after its own phone readback.
                if (args.lookupOnly === true && !matches.length && failedVariants) incomplete = true;
                return { ok: true, state: 'ready', base: args.base, phone: d, customerId: customer.id, customers: customer.customers,
                    matches: matches.map(item => ({ ...item, base: args.base, active: ACTIVE.test(item.status) || !CLOSED.test(item.status) })), incomplete };
            } catch (error) { return reject(error.message); }
        }
        async function getCreate(args, known) {
            const customer = !known && args.phone && args.lookupCustomer !== false ? await findCustomer(args.base, phone10(args.phone)) : null;
            const lookup = known || {ok:true,customerId:customer?.id || '',customers:customer?.customers || [],matches:[],incomplete:false};
            if (!lookup.ok) throw new Error(lookup.error);
            const { document } = await documentAt(args.base, PATH + 'create' + (lookup.customerId ? '?customer_id=' + encodeURIComponent(lookup.customerId) : ''));
            const form = requestForm(document);
            if (!form) throw new Error('Форма создания CRM не найдена.');
            let selectedCustomer = null;
            if (lookup.customerId) {
                const page = await documentAt(args.base, CUSTOMER_PATH + '?id=' + lookup.customerId);
                assertCustomerUrl(args.base, page.response, lookup.customerId);
                const cform = customerForm(page.document);
                if (!cform) throw new Error('Карточка существующего клиента не открылась.');
                const phones = cform.fields.filter(item => /^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\].*\[v\]$/.test(item.name))
                    .map(item => phone10(item.value)).filter(Boolean);
                if (!phones.includes(phone10(args.phone))) throw new Error('Клиент из поиска CRM не подтвердил этот телефон в своей карточке. Создание не отправлено.');
                selectedCustomer = { id: lookup.customerId, form: cform, csrf: { param: page.document.csrfParam, token: page.document.csrfToken } };
            }
            return { lookup, document, form, customer:selectedCustomer };
        }
        function customerDiffs(customer, fields) {
            if (!customer) return [];
            const diffs = [];
            for (const [name, value] of Object.entries(fields || {})) {
                if (!isCustomerField(name)) continue;
                const item = field(customer.form, name);
                if (!item) {
                    diffs.push({ name, label: name, before: null, after: value, unsupported: true });
                } else if (normalizeValue(name, customer.form.values[name]) !== normalizeValue(name, value)) diffs.push({ name, label: item.label, before: customer.form.values[name], after: value });
            }
            return diffs;
        }
        async function prepare(args) {
            try {
                const current = await getCreate(args);
                preparedCreates.set(args.base+':'+phone10(args.phone),{at:Date.now(),current});
                const output = { ok: true, state: 'ready', base: args.base, form: publicForm(current.form), lists: lists(current.form), cityNotice:current.document.cityNotice || '',cityNoticeCityId:str(current.form.values['CustomerRequest[city_id]'] || ''), sessionOperator: current.document.sessionOperator || '',
                    fieldNames: names(current.form, current.customer, args.phone),
                    matches: current.lookup.matches, incomplete: !!current.lookup.incomplete, customerId: current.lookup.customerId,
                    customer: current.customer ? { id: current.customer.id, form: publicForm(current.customer.form), values: publicForm(current.customer.form).values } : null,
                    customerDiffs: customerDiffs(current.customer, args.fields || {}) };
                if (phone10(args.phone)) output.phoneLookup = { base: args.base, phone: phone10(args.phone), matches: clone(current.lookup.matches), incomplete: !!current.lookup.incomplete };
                if (current.customer) {
                    const snapshot = publicForm(current.customer.form);
                    output.form.fields = output.form.fields.filter(item => !isCustomerField(item.name)).concat(snapshot.fields.filter(item => isCustomerField(item.name)));
                    for (const name of Object.keys(output.form.values)) if (isCustomerField(name)) delete output.form.values[name];
                    for (const item of snapshot.fields) if (isCustomerField(item.name)) output.form.values[item.name] = snapshot.values[item.name];
                }
                if (args.cityId) {
                    const deps = await dependencies({ ...args, applianceTypeId: args.applianceTypeId });
                    if (!deps.ok) return deps;
                    output.lists.workTypes = deps.workTypes;
                    output.lists.services = deps.services;
                    output.cityNotice = deps.cityNotice;
                    output.cityNoticeCityId = deps.cityNoticeCityId;
                }
                return output;
            } catch (error) {preparedCreates.delete(args.base+':'+phone10(args.phone));return reject(error.message);}
        }
        function parseList(response, name) {
            if (response.status >= 400) throw new Error('CRM не отдала справочник: HTTP ' + response.status + '.');
            let json;
            try { json = JSON.parse(response.text); } catch (_) { json = null; }
            if (json) {
                let source = Array.isArray(json) ? json : json.output || json.results || json.items || json.data;
                if (source && !Array.isArray(source) && typeof source === 'object') source = Object.entries(source).map(([id, text]) => ({ id, text }));
                if (Array.isArray(source)) return source.flatMap(item => item?.children || [item]).map(item => ({ id: str(item.id ?? item.value), text: str(item.text ?? item.name ?? item.label), disabled: !!item.disabled })).filter(item => /^\d+$/.test(item.id));
            }
            return Promise.resolve(parseDocument(response.text, response.url)).then(document => {
                if (document.login || response.status >= 400) throw new Error('CRM не отдала справочник. Проверьте вход.');
                const select = document.forms.flatMap(form => form.fields).find(item => item.name === name);
                return (select ? select.options : document.forms.length ? [] : document.options).filter(item => /^\d+$/.test(item.id));
            });
        }
        async function dependencies(args) {
            const prepared=args.preparedPhone!==undefined?preparedCreates.get(args.base+':'+phone10(args.preparedPhone)):null;
            return loadDependencies(args,prepared && Date.now()-prepared.at<nativeFormTtl?prepared.current:null);
        }
        async function loadDependencies(args, current) {
            try {
                if (!/^\d+$/.test(str(args.cityId))) return reject('Сначала выберите город.');
                // Creation has just read its own live form. Reuse only that
                // operation's snapshot; standalone dropdown reads stay fresh.
                const { document } = current || await documentAt(args.base, PATH + 'create');
                const form = current?.form || requestForm(document);
                if (!form) throw new Error('Форма CRM не найдена.');
                const partner = str(args.partnerId || '');
                if (partner && !field(form, N.partner)?.options.some(item => item.id === partner && !item.disabled)) throw new Error('Партнёр отсутствует в справочнике выбранной CRM.');
                const notice = cityNoticeFor(args,form);
                const query = new URLSearchParams({ _get_appltype: '1', city_id: str(args.cityId), appl_id: '', subappl_id: '', has_partner: partner ? '1' : '0' });
                // A native preparation owns these dropdowns and its CSRF token.
                // Date changes only need their timetable; they do not change the
                // work/service lists for this city and partner.
                let dropdowns=current && preparedDropdowns.get(current);
                if(current && !dropdowns){dropdowns=new Map();preparedDropdowns.set(current,dropdowns);}
                const workKey=JSON.stringify([str(args.cityId),partner]),serviceKey=workKey+'|'+str(args.applianceTypeId || '');
                let workTypes=dropdowns?.get(workKey);
                if(!workTypes){const workResponse=await http(args.base,PATH+'create?'+query);workTypes=await parseList(workResponse,N.work);dropdowns?.set(workKey,workTypes);}
                const sub = serviceField(form);
                let services = [];
                if (args.applianceTypeId) {
                    if (!workTypes.some(item => item.id === str(args.applianceTypeId) && !item.disabled)) return reject('Этот вид работ недоступен для выбранного города и партнёра.');
                    if (sub) {
                        query.set('appl_id', str(args.applianceTypeId)); query.set('get_subappltypes', '1');
                        const cachedServices=dropdowns?.get(serviceKey);
                        if(cachedServices)services=cachedServices;
                        else {const response=await http(args.base,PATH+'create?'+query);services=await parseList(response,sub.name);}
                        if (services.length && JSON.stringify(services.map(item => item.id)) === JSON.stringify(workTypes.map(item => item.id))) services = [];
                        if (!services.length) for (const dep of sub.dependencies || []) {
                            const url = new URL(dep.url, baseUrl(args.base));
                            if (url.origin !== BASES[args.base] || /(?:save|create|update|delete|remove|login|logout|employee|customer\/search)/i.test(url.pathname)
                                || !/sub|appl|depdrop|type|service|list/i.test(url.pathname)) continue;
                            let result;
                            if (dep.depdrop) {
                                const body = new URLSearchParams({ 'depdrop_parents[0]': str(args.applianceTypeId),
                                    ['depdrop_all_params[' + (dep.parentId || 'customerrequest-appliance_type_id') + ']']: str(args.applianceTypeId) });
                                if (!document.csrfToken) throw new Error('CRM не отдала токен справочника услуг.');
                                body.set(document.csrfParam, document.csrfToken);
                                result = await http(args.base, url.href, { method: 'POST', body });
                            } else {
                                for (const [key, value] of [['id', args.applianceTypeId], ['appl_id', args.applianceTypeId], ['appliance_type_id', args.applianceTypeId], ['city_id', args.cityId]]) url.searchParams.set(key, str(value));
                                result = await http(args.base, url.href);
                            }
                            services = await parseList(result, sub.name);
                            if (services.length) break;
                        }
                        if(services.length)dropdowns?.set(serviceKey,services);
                    }
                }
                return { ok: true, state: 'ready', base: args.base, cityId: str(args.cityId), applianceTypeId: str(args.applianceTypeId || ''),
                    workTypes, services, serviceField: sub?.name || '', serviceUnavailable: !!sub && !!args.applianceTypeId && !services.length, ...await notice };
            } catch (error) { return reject(error.message); }
        }
        async function readPrivate(args,nativeResponse,previous) {
            if (!/^\d+$/.test(str(args.id))) throw new Error('Нет точного номера заявки.');
            const preparedKey=args.base+':'+str(args.id),preparedBefore=preparedRequests.get(preparedKey);
            const url = baseUrl(args.base) + PATH + 'update?id=' + args.id;
            let page = nativeResponse ? {response:nativeResponse,document:await parseDocument(nativeResponse.text,url)} : await documentAt(args.base, url, {fullPage:true});
            if (exactId(args.base, page.response) !== str(args.id)) throw new Error('CRM вернула другую карточку вместо заявки № ' + args.id + '.');
            let form = requestForm(page.document);
            if(nativeResponse && !form)return readPrivate(args);
            if (!form || (args.comments === true && !page.document.commentsSave)) {
                // Some Yii versions expose only a partial page for browser-like
                // GET and the opposite for XMLHttpRequest. Both are READS;
                // never retry a POST or mark a result saved on this fallback.
                const secondary = await documentAt(args.base, url);
                if (exactId(args.base, secondary.response) !== str(args.id)) throw new Error('CRM вернула другую карточку вместо заявки № ' + args.id + '.');
                const secondaryForm = requestForm(secondary.document);
                // A Yii comments partial can omit CSRF metadata. Both GETs
                // have already proved the same exact card; prefer its widget
                // token when present, otherwise retain the full-page token.
                const csrfDocument = secondary.document.csrfToken ? secondary.document : page.document;
                const commentsCsrf = {param:csrfDocument.csrfParam,token:csrfDocument.csrfToken};
                if (secondaryForm && (!form || secondary.document.commentsSave)) {
                    const sameCustomer=secondary.document.customerId && secondary.document.customerId===page.document.customerId;
                    const customerHistory=secondary.document.customerHistory || (sameCustomer?page.document.customerHistory:null);
                    const customerPhone=secondary.document.customerPhone || (sameCustomer?page.document.customerPhone:'');
                    const customerPhones=secondary.document.customerPhones?.length?secondary.document.customerPhones:(sameCustomer?page.document.customerPhones:[]);
                    page = {...secondary,document:{...secondary.document,customerHistory,customerPhone,customerPhones,commentsCsrf}}; form = secondaryForm;
                }
                else if (form && secondary.document.commentsSave) {
                    // A comments-only partial is a single coherent snapshot;
                    // preserve all four texts from that snapshot together.
                    page.document = {...page.document, nativeComments:secondary.document.nativeComments,
                        commentsSave:secondary.document.commentsSave,commentConflicts:secondary.document.commentConflicts || [],
                        commentsCsrf};
                }
            }
            if (!form) throw new Error('Заявка №' + args.id + ' доступна по ссылке, но CRM не передала форму редактирования для автоматической проверки. Откройте карточку в CRM и проверьте вход; повторно создавать заявку не нужно.');
            let customer = null, customerPhoneFacts = null;
            const id = page.document.customerId || form.values[N.customer];
            if (/^\d+$/.test(str(id))) {
                const embedded=nativeResponse && !args.preferCustomerRead ? customerForm(page.document) : null;
                const complete=embedded && (args.customerFieldNames || []).every(name=>!!field(embedded,name))
                    && embedded.fields.some(item=>/^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\].*\[v\]$/.test(item.name) && phone10(item.value));
                if(complete)customer={id:str(id),form:embedded,csrf:{param:page.document.csrfParam,token:page.document.csrfToken}};
                // A native request POST need not repeat the separate customer
                // form. When this operation did not edit that customer, retain
                // its exact, already-read snapshot instead of blocking the
                // saved request on another customer GET. Edited or rebound
                // customers still require a fresh read.
                else if(nativeResponse && !args.preferCustomerRead && previous?.record.base===args.base
                    && previous.record.id===str(args.id) && previous.customer?.id===str(id))customer=previous.customer;
                else{
                    const customerPage = await documentAt(args.base, CUSTOMER_PATH + '?id=' + id);
                    assertCustomerUrl(args.base, customerPage.response, id);
                    const cform = customerForm(customerPage.document);
                    customerPhoneFacts=customerPage.document;
                    if (!cform && !(customerPhoneFacts.customerPhones || []).length) throw new Error('Карточка клиента заявки не прочиталась.');
                    if(cform)customer = { id: str(id), form: cform, csrf: { param: customerPage.document.csrfParam, token: customerPage.document.csrfToken } };
                }
            }
            // Comments may be a separate native widget. Its current values take
            // priority over readonly copies in the ordinary request form.
            for (const [short, native] of Object.entries(page.document.nativeComments || {})) {
                const name = 'CustomerRequest[' + short + ']';
                form.values[name] = native.value;
                for (const item of form.fields.filter(item => item.name === name)) item.value = native.value;
            }
            const snapshot = publicForm(form);
            for (const [short, native] of Object.entries(page.document.nativeComments || {})) {
                const name = 'CustomerRequest[' + short + ']';
                snapshot.values[name] = native.value;
                const writable=!!page.document.commentsSave;
                const existing=snapshot.fields.find(item=>item.name===name);
                if(existing){if(writable){existing.readOnly=false;existing.disabled=false;}continue;}
                snapshot.fields.push({ ...native, name, label: short, readOnly: !writable, options: [] });
            }
            if (customer) {
                const customerSnapshot = publicForm(customer.form);
                snapshot.fields = snapshot.fields.filter(item => !isCustomerField(item.name)).concat(customerSnapshot.fields.filter(item => isCustomerField(item.name)));
                for (const name of Object.keys(snapshot.values)) if (isCustomerField(name)) delete snapshot.values[name];
                for (const item of customerSnapshot.fields) if (isCustomerField(item.name)) snapshot.values[item.name] = customerSnapshot.values[item.name];
                snapshot.revision = hash(snapshot.revision + ':' + revision(customer.form));
            }
            const nativeHistory=[page.document.customerHistory,customerPhoneFacts?.customerHistory].find(history=>history && history.customerId===str(id)
                && history.base===args.base && (history.requestId===str(args.id) || history===customerPhoneFacts?.customerHistory && history.requestId===''));
            const customerHistory=nativeHistory?{...clone(nativeHistory),requestId:str(args.id),rows:nativeHistory.rows.map(row=>({...clone(row),current:row.id===str(args.id)}))}:null;
            const record = { id: str(args.id), base: args.base, url, status: page.document.status || str(form.values['CustomerRequest[req_status]'] || ''), cityNotice:page.document.cityNotice || '',cityNoticeCityId:str(form.values['CustomerRequest[city_id]'] || ''),
                customerHistory,
                paymentSummary: page.document.paymentSummary ? clone(page.document.paymentSummary) : null, auditInfo:clone(page.document.auditInfo || []), audioAvailable:page.document.audioAvailable === true,
                author: page.document.author || page.document.auditInfo?.find(item=>/^(?:Автор|Создал(?:а)?|Кем создан[ао]?)$/iu.test(item.label))?.value || '', sessionOperator: page.document.sessionOperator || '', authorVerified: false, createdAt: page.document.createdAt || '', customerId: str(id || ''), form: snapshot, lists: lists(form),
                fieldNames: names(form, customer), revision: snapshot.revision };
            const nativePhones=snapshot.fields.filter(item=>/^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[a-zA-Z0-9_-]+\]\[v\]$/.test(item.name)).map(item=>phone10(item.value)).filter(Boolean);
            record.phone=phone10(snapshot.values[record.fieldNames.phone]) || page.document.customerPhone || customerPhoneFacts?.customerPhone || nativePhones[0] || '';
            record.phones=[...new Set([record.phone,...nativePhones,...(page.document.customerPhones || []),...(customerPhoneFacts?.customerPhones || [])].filter(Boolean))];
            // Editing has a narrower policy than completed-history duplicate detection.
            const readOnly = root.LeadPartnerRules.requestReadOnly(record.status);
            record.hasClaim = page.document.hasClaim === true;
            record.callUrl = page.document.callUrl || ''; 
            record.actions = clone(page.document.actions || []).filter(action => !readOnly || ['create_claim','not_taken',...RESTORE_ACTIONS].includes(action.key));
            record.capabilities = {readOnly,save:!readOnly,reschedule:!readOnly && snapshot.capabilities.reschedule};
            record.form.capabilities = record.capabilities;
            record.statusColor = /Готов|Выполн|Оплачен/i.test(record.status) ? '#44b9f3' : /Отказ|Отмен|Брак/i.test(record.status) ? '#e83b3b'
                : /Не оформ|Не создан/i.test(record.status) ? '#47a9a7' : /В работе|СД/i.test(record.status) ? '#f79336'
                : /В пути/i.test(record.status) ? '#46b458' : /Модерац/i.test(record.status) ? '#e55454' : '#54d350';
            const current={ ...page, form, customer, record };
            // A slower earlier GET must not replace a newer native save reply.
            if(nativeResponse || preparedRequests.get(preparedKey)===preparedBefore)preparedRequests.set(preparedKey,{at:Date.now(),current});
            return current;
        }
        async function readRequest(args) {
            const preparedKey=args.base+':'+str(args.id), preparedBefore=preparedRequests.get(preparedKey);
            try {
                const current = await readPrivate(args);
                if (!current.record.cityNotice) Object.assign(current.record, await cityNoticeFor({...args,cityId:current.form.values[N.city]},current.form));
                return { ok: true, state: 'ready', ...current.record, record: current.record };
            }
            catch (error) {if(preparedRequests.get(preparedKey)===preparedBefore)preparedRequests.delete(preparedKey);return reject(error.message);}
        }

        async function getAudioRecords(args) {
            try {
                if (!/^\d+$/.test(str(args.id))) throw new Error('Нет точного номера заявки.');
                const page = await documentAt(args.base,PATH+'update?id='+args.id,{fullPage:true});
                if (exactId(args.base,page.response)!==str(args.id)) throw new Error('CRM вернула другую карточку вместо выбранной заявки.');
                const form=requestForm(page.document),customerId=str(page.document.customerId || form?.values[N.customer] || '');
                if (!/^\d+$/.test(str(args.customerId)) || customerId!==str(args.customerId)) throw new Error('Клиент заявки изменился. Обновите карточку перед загрузкой аудиозаписей.');
                const route=page.document.audioRoute;
                if (!route || route.method!=='GET') return {ok:false,unavailable:true,records:[],columns:[],error:'CRM не передала доступную кнопку загрузки аудиозаписей.'};
                const target=new URL(route.url);
                if (target.origin!==BASES[args.base] || target.username || target.password || target.hash || target.pathname!==PATH+'update'
                    || target.searchParams.get('id')!==str(args.id) || target.searchParams.get('_get-customer-audio')!=='1'
                    || target.searchParams.getAll('id').length!==1 || target.searchParams.getAll('_get-customer-audio').length!==1
                    || Array.from(target.searchParams.keys()).some(key=>!['id','_get-customer-audio'].includes(key))) throw new Error('CRM не подтвердила адрес аудиозаписей выбранной заявки.');
                const response=await http(args.base,target.href);
                const final=new URL(response.url);
                if (response.status>=400 || final.origin!==target.origin || final.pathname!==target.pathname || final.searchParams.toString()!==target.searchParams.toString()) throw new Error('CRM не подтвердила чтение аудиозаписей. Проверьте вход в выбранную базу.');
                const parsed=await parseDocument(response.text,response.url);
                if (parsed.login) throw new Error('Войдите в выбранную CRM перед загрузкой аудиозаписей.');
                // This parser consumes only the fresh, exact native GET reply.
                // Remote sources must be explicit audio/source elements there.
                const audio=root.LeadChatCrmHtml.parseAudioRecords(response.text,response.url,{nativeResponse:true});
                return {ok:true,base:args.base,id:str(args.id),...audio};
            } catch (error) {return {ok:false,records:[],columns:[],error:error.message};}
        }

        function cancellationPage(args, response, document) {
            // A native cancellation is commonly a two-page workflow. Its
            // second action, field names and option IDs come ONLY from that
            // exact server response; labels are never translated into IDs.
            const candidates=(document.forms || []).filter(form=>form.method==='POST'
                && form.fields.some(item=>item.tag==='select' && !item.disabled
                    && /причин.*(?:смен|отмен)|(?:смен|отмен).*причин/i.test(item.label)));
            if(!candidates.length)return null;
            if(candidates.length!==1)throw Error('CRM передала несколько форм причины отмены.');
            const form=candidates[0],page=new URL(response.url,BASES[args.base]);
            const submits=(form.buttons || []).filter(item=>item.type==='submit' && !item.disabled && !item.onclick && (!item.method || /^post$/i.test(item.method)));
            const submit=submits.find(item=>/^(?:Сохранить(?: изменения)?|Подтвердить|Применить|Отменить заявку)$/i.test(item.text)) || (submits.length===1?submits[0]:null);
            if(submits.length>1 && !submit)throw Error('CRM не передала однозначную кнопку сохранения причины отмены.');
            const action=new URL(submit?.action || form.action || page.href,page.href);
            const matchesId=url=>['id','request_id','customer_request_id'].some(key=>url.searchParams.get(key)===str(args.id));
            const requestIds=form.fields.filter(item=>item.type==='hidden' && /^(?:id|request_id|customer_request_id|CustomerRequest\[id\]|[A-Za-z_][A-Za-z0-9_]*\[(?:request_id|customer_request_id)\])$/.test(item.name));
            const hiddenId=requestIds.some(item=>item.value===str(args.id));
            const conflicting=url=>['id','request_id','customer_request_id'].some(key=>url.searchParams.getAll(key).some(value=>value!==str(args.id)));
            const trusted=url=>url.origin===BASES[args.base] && !url.username && !url.password && !url.hash
                && /^\/admin\/domain\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/?$/.test(url.pathname);
            if(!trusted(page) || !trusted(action) || conflicting(page) || conflicting(action) || requestIds.some(item=>item.value!==str(args.id))
                || (!matchesId(page) && !hiddenId) || (!matchesId(action) && !hiddenId))throw Error('Форма причины отмены относится к другой заявке.');
            const reasons=form.fields.filter(item=>item.tag==='select' && !item.disabled && !item.readOnly
                && /причин.*(?:смен|отмен)|(?:смен|отмен).*причин/i.test(item.label));
            if(reasons.length!==1 || reasons[0].multiple)throw Error('CRM не передала однозначный выбор причины отмены.');
            const reason=reasons[0],comment=form.fields.find(item=>item.tag==='textarea' && !item.disabled && !item.readOnly && /комментар/i.test(item.label));
            const unsupported=form.fields.find(item=>item.required && !item.disabled && !['hidden','submit','button','reset'].includes(item.type)
                && item.name!==reason.name && item.name!==comment?.name && !str(item.value).trim());
            if(unsupported)throw Error('В форме отмены CRM требуется поле «'+unsupported.label+'».');
            if(!reason.options.some(item=>item.id && !item.disabled))throw Error('CRM не передала доступные причины отмены.');
            if(!document.csrfToken && !form.fields.some(item=>!item.disabled && item.name===document.csrfParam && str(item.value)))throw Error('CRM не передала токен формы причины отмены.');
            return {form:clone(form),url:page.href,action:action.href,reasonName:reason.name,commentName:comment?.name || '',
                submit:submit?{name:submit.name,value:submit.value}:null,csrf:{param:document.csrfParam,token:document.csrfToken}};
        }
        function cancellationResult(entry,record,error) {
            const data=entry.cancellationForm,reason=data?.form.fields.find(item=>item.name===data.reasonName),comment=data?.form.fields.find(item=>item.name===data.commentName);
            if(!reason)throw Error('Не сохранена форма выбора причины отмены.');
            return {ok:!error,state:'awaiting_reason',id:str(entry.id),base:entry.base,operationId:entry.operationId,
                action:entry.expected?._nativeAction?.key,reasons:clone(reason.options).filter(item=>item.id && !item.disabled),
                commentAvailable:!!comment,commentRequired:!!comment?.required,record,...(error?{error}: {})};
        }
        async function captureCancellation(args,response,current) {
            const document=await parseDocument(response.text,response.url);
            const data=cancellationPage(args,response,document);
            if(!data)return null;
            let entry=await recordOperation(args.operationId,{cancellationForm:data,nativeActionPhase:'reason_pending'});
            // Persist the native continuation before any extra read. Some CRM
            // versions update status in phase one, then require the reason.
            // That intermediate closed card is NOT a completed cancellation.
            let result=await persistResult(args.operationId,cancellationResult(entry,current.record));
            try{
                const fresh=await readPrivate(args);
                entry=await recordOperation(args.operationId,{reasonStageStatus:fresh.record.status,reasonStageRevision:fresh.record.revision});
                result=await persistResult(args.operationId,cancellationResult(entry,fresh.record));
            }catch(_){/* Captured continuation remains durable; next fresh read determines its actual stage. */}
            return result;
        }
        async function prepareCancellation(args) {
            if(!['cancel_kc','cancel_branch'].includes(args.action))return reject('Выберите отмену КЦ или филиала.');
            // This is the user's deliberate first cancellation click, not a
            // background GET. The existing write gate journals it once.
            return update({...args,fields:{}},false);
        }
        async function prepareNotTakenRequest(args) {
            return update({...args,action:'not_taken',fields:{}},false);
        }
        async function saveNotTakenRequest(args) {
            return saveCancellation({...args,requiredAction:'not_taken'});
        }
        async function saveCancellation(args) {
            return locked('write',async()=>{
                let entry;
                try{
                    entry=((await storage.get(storageKey)) || {})[args.operationId];
                    if(!entry || entry.base!==args.base || str(entry.id)!==str(args.id)
                        || !['cancel_kc','cancel_branch','not_taken'].includes(entry.expected?._nativeAction?.key)
                        || args.requiredAction && entry.expected._nativeAction.key!==args.requiredAction)return reject('Операция смены статуса этой заявки не найдена.');
                    if(entry.state==='saved')return clone(entry.result);
                    if(entry.nativeActionPhase!=='reason_pending' || entry.state!=='awaiting_reason')return entry.result || uncertain('Отмена уже отправлена.',{id:entry.id,operationId:args.operationId});
                    const data=entry.cancellationForm,reason=data?.form.fields.find(item=>item.name===data.reasonName),comment=data?.form.fields.find(item=>item.name===data.commentName);
                    const selected=reason?.options.find(item=>item.id===str(args.reasonId) && item.id && !item.disabled);
                    if(!selected)return cancellationResult(entry,entry.result?.record,'Выберите причину отмены.');
                    if(str(args.comment).length>20000 || comment?.required && !str(args.comment).trim())return cancellationResult(entry,entry.result?.record,'Заполните комментарий отмены.');
                    let current=await readPrivate(args);
                    if(Object.hasOwn(entry,'reasonStageStatus') && current.record.status!==entry.reasonStageStatus)return persistResult(args.operationId,reject('Статус заявки уже изменился в CRM.',{id:entry.id,record:current.record,operationId:args.operationId}));
                    if(!Object.hasOwn(entry,'reasonStageStatus'))entry=await recordOperation(args.operationId,{reasonStageStatus:current.record.status,reasonStageRevision:current.record.revision});
                    let native=data;
                    // A redirected reason page is safe to refresh by GET. When
                    // CRM rendered it at update itself, keep its actual hidden
                    // command fields and use the fresh same-session CSRF token.
                    if(new URL(data.url).pathname!==PATH+'update'){
                        const page=await documentAt(args.base,data.url,{fullPage:true});
                        const refreshed=cancellationPage(args,page.response,page.document);
                        if(!refreshed)return cancellationResult(entry,current.record,'CRM не передала форму причины отмены.');
                        native=refreshed;
                    }
                    const freshReason=native.form.fields.find(item=>item.name===native.reasonName),freshSelected=freshReason?.options.find(item=>item.id===selected.id && !item.disabled && item.text===selected.text);
                    if(!freshSelected){
                        entry=await recordOperation(args.operationId,{cancellationForm:native});
                        return persistResult(args.operationId,cancellationResult(entry,current.record,'Причины отмены изменились в CRM. Выберите причину снова.'));
                    }
                    const changes={[native.reasonName]:freshSelected.id};
                    if(native.commentName)changes[native.commentName]=str(args.comment);
                    const csrf=native===data?{param:current.document.csrfParam,token:current.document.csrfToken}:native.csrf;
                    const body=serialize(native.form,changes,csrf);
                    // Replace the captured token explicitly; serialize normally
                    // preserves native hidden values, but CSRF may have rotated.
                    if(csrf.token)body.set(csrf.param,csrf.token);
                    // Preserve ALL actual hidden continuation fields. This is
                    // a different native form, so update-form cleanup such as
                    // deleting save_close must not alter its contract.
                    if(native.submit?.name)body.set(native.submit.name,native.submit.value);
                    const notTaken=entry.expected._nativeAction.key==='not_taken';
                    const nativeOutcome=notTaken?{notTaken:{reason:freshSelected.text}}:{cancellation:{action:entry.expected._nativeAction.key,reason:freshSelected.text}};
                    const expected={...entry.expected,_cancellationReason:{name:native.reasonName,id:freshSelected.id,label:freshSelected.text}};
                    delete expected._nativeReasonPending;
                    // The background gate was deliberately paused while the
                    // user chose a reason. Resume the SAME operation before
                    // dispatching the final native form, never create a new one.
                    writeGateAccepted.delete(args.operationId);
                    await markSent(args,{nativeActionPhase:'reason_pending'});
                    await recordOperation(args.operationId,{state:'sent',phase:'sent',nativeActionPhase:'reason_sent',...nativeOutcome,expected,
                        cancellationSelection:{reasonId:freshSelected.id,comment:str(args.comment)}});
                    entry.expected=expected;
                    const response=await http(args.base,native.action,{method:'POST',body,fullPage:true});
                    const refusal=await responseRejection(response);
                    const returned=await parseDocument(response.text,response.url),again=cancellationPage(args,response,returned);
                    if(again){
                        entry=await recordOperation(args.operationId,{cancellationForm:again,nativeActionPhase:'reason_pending'});
                        return persistResult(args.operationId,cancellationResult(entry,current.record,refusal || 'Выберите причину отмены в форме CRM.'));
                    }
                    if(refusal){
                        current=await readPrivate(args);
                        if(current.record.status===entry.reasonStageStatus){
                            entry=await recordOperation(args.operationId,{cancellationForm:native,nativeActionPhase:'reason_pending'});
                            return persistResult(args.operationId,cancellationResult(entry,current.record,refusal));
                        }
                        // An explicit rejection of OUR final form cannot be
                        // turned into success by somebody else's cancellation.
                        return persistResult(args.operationId,reject(refusal,{id:entry.id,record:current.record,operationId:args.operationId}));
                    }
                    let verified;
                    for(const delay of [0,250,650]){
                        if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
                        current=await readPrivate(args);verified=verify(current,entry.expected,entry.expectedPrimaryPhoneField);
                        if(verified.ok)break;
                    }
                    if(verified.ok)await storage.set('leadPartnerCancellationNoteV1:'+args.base+':'+entry.id,{kind:notTaken?'nf':'cancel',reason:freshSelected.text,originalPartner:entry.originalPartnerComment||'',at:Date.now()});
                    return persistResult(args.operationId,verified.ok?{ok:true,state:'saved',id:entry.id,record:current.record,verified,...nativeOutcome,operationId:args.operationId}
                        :uncertain('CRM ещё не завершила отмену заявки.',{id:entry.id,record:current.record,verified,operationId:args.operationId}));
                }catch(error){
                    if(!entry)return reject(error.message);
                    const latest=((await storage.get(storageKey).catch(()=>({}))) || {})[args.operationId];
                    if(latest?.nativeActionPhase==='reason_pending'){
                        if(latest.state==='rejected')return clone(latest.result);
                        return persistResult(args.operationId,cancellationResult(latest,latest.result?.record,error.message));
                    }
                    const result=uncertain(error.message,{id:entry.id,operationId:args.operationId});
                    await persistResult(args.operationId,result);return result;
                }
            },true);
        }
        async function claimFormAt(args) {
            const current=await readPrivate(args);
            if(current.record.hasClaim) return {current,already:true};
            const command=current.record.actions.find(item=>item.key==='create_claim' && item.enabled);
            if(!command) throw Error('Создание претензии недоступно в CRM для этой заявки.');
            const url=baseUrl(args.base)+PATH+'create-claim?id='+args.id;
            const page=await documentAt(args.base,url,{fullPage:true});
            const final=new URL(page.response.url,baseUrl(args.base));
            if(final.origin!==BASES[args.base] || final.pathname!==PATH+'create-claim' || final.searchParams.get('id')!==str(args.id)) throw Error('CRM вернула другую форму претензии.');
            const form=page.document.forms.find(candidate=>candidate.method==='POST'
                && candidate.fields.some(item=>item.tag==='select' && /тип.*претенз|претенз.*тип/i.test(item.label)));
            if(!form) throw Error('CRM не передала форму создания претензии.');
            const action=new URL(form.action || url,url);
            if(action.origin!==BASES[args.base] || action.pathname!==PATH+'create-claim' || action.searchParams.get('id')!==str(args.id)
                || [...action.searchParams.keys()].some(key=>key!=='id')) throw Error('Адрес сохранения претензии не совпадает с заявкой.');
            const type=form.fields.find(item=>item.tag==='select' && /тип.*претенз|претенз.*тип/i.test(item.label) && !item.disabled);
            const comment=form.fields.find(item=>item.tag==='textarea' && /комментар/i.test(item.label) && !item.disabled && !item.readOnly);
            if(!type || !comment) throw Error('В форме CRM отсутствует тип претензии или комментарий.');
            return {current,page,form,action,type,comment};
        }
        async function prepareClaim(args) {
            try {
                const data=await claimFormAt(args);
                if(data.already) return {ok:true,already:true,record:data.current.record};
                return {ok:true,id:str(args.id),base:args.base,types:clone(data.type.options).filter(item=>item.id && !item.disabled),
                    commentRequired:!!data.comment.required,revision:revision(data.form)};
            } catch(error) {return reject(error.message);}
        }
        async function saveClaim(args) {
            return mutate({...args,action:'claim_form',fields:{claimType:str(args.claimType),comment:str(args.comment)}},'save',async()=>{
                const data=await claimFormAt(args);
                if(data.already) return persistResult(args.operationId,{ok:true,state:'saved',already:true,id:str(args.id),record:data.current.record,verified:{ok:true,checked:['_nativeAction'],diffs:[]}});
                if(!data.type.options.some(item=>item.id===str(args.claimType) && item.id && !item.disabled)) return persistResult(args.operationId,reject('Выберите тип претензии.'));
                if(str(args.comment).length>20000 || data.comment.required && !str(args.comment).trim()) return persistResult(args.operationId,reject('Заполните комментарий претензии.'));
                const body=serialize(data.form,{[data.type.name]:str(args.claimType),[data.comment.name]:str(args.comment)},
                    {param:data.page.document.csrfParam,token:data.page.document.csrfToken});
                const submit=(data.form.buttons || []).find(item=>!item.disabled && item.type==='submit' && !item.onclick && /^Сохранить$/i.test(item.text));
                if(submit?.name)body.set(submit.name,submit.value);
                const expected={_nativeAction:{key:'create_claim',beforeStatus:data.current.record.status}};
                await markSent(args,{id:str(args.id),expected,transport:'native-form-v2',claim:true});
                const response=await http(args.base,data.action.href,{method:'POST',body,fullPage:true});
                const refusal=await responseRejection(response);
                if(refusal)return persistResult(args.operationId,reject(refusal,{id:str(args.id),operationId:args.operationId}));
                let after,verified;
                for(const delay of [0,300,700]){
                    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
                    after=await readPrivate(args);verified=verify(after,expected);
                    if(verified.ok)break;
                }
                return persistResult(args.operationId,verified.ok ? {ok:true,state:'saved',id:str(args.id),record:after.record,verified,operationId:args.operationId}
                    : uncertain('CRM не подтвердила создание претензии.',{id:str(args.id),record:after.record,verified,operationId:args.operationId}));
            });
        }
        async function writeEditedComments(args,changes,before) {
            const fresh=await readPrivate({...args,comments:true});
            if(!fresh.document.commentsSave || fresh.document.commentConflicts?.length) throw Error('CRM не разрешила сохранение комментариев этой заявки.');
            const widgets=fresh.document.nativeComments || {};
            const csrf=fresh.document.commentsCsrf || {param:fresh.document.csrfParam,token:fresh.document.csrfToken};
            if(!csrf.token)throw Error('Не прочитан токен сохранения комментариев.');
            const body=new URLSearchParams({[csrf.param]:csrf.token,_comments_only:'true'});
            for(const short of ['comments','comments_service','date_changes','partner_comment']){
                const item=widgets[short],name='CustomerRequest['+short+']';
                if(!item || item.disabled || item.type==='hidden')throw Error('CRM не передала полный блок комментариев.');
                if(Object.hasOwn(changes,name) && normalizeValue(name,item.value)!==normalizeValue(name,before[name])
                    && normalizeValue(name,item.value)!==normalizeValue(name,changes[name]))throw Error('Комментарий изменился в CRM. Обновите карточку перед сохранением.');
                body.set(short,Object.hasOwn(changes,name)?str(changes[name]):item.value);
            }
            if(Object.entries(changes).every(([name,value])=>normalizeValue(name,value)===normalizeValue(name,fresh.record.form.values[name])))return;
            await recordOperation(args.operationId,{commentsEditPhase:'sent'});
            const response=await http(args.base,fresh.document.commentsSave.url,{method:'POST',body});
            const refusal=await responseRejection(response);if(refusal)throw Error(refusal);
            await recordOperation(args.operationId,{commentsEditPhase:'replied'});
        }

        async function completePostEdit(args,current,entry) {
            const intent=entry.postEditIntent,changes={};
            // Full HTML and the native comments widget can expose different
            // snapshots. Use the existing same-card widget fallback for history.
            const readArgs={...args,comments:true};
            if(!current.document.commentsSave)current=await readPrivate(readArgs);
            const latest=((await storage.get(storageKey))||{})[args.operationId]||{};
            if(latest.postEditExpected){
                const checked=verify(current,latest.postEditExpected,entry.expectedPrimaryPhoneField);
                if(checked.ok)return {ok:true,current,expected:latest.postEditExpected};
                if(latest.postEditPhase==='sent'||latest.postEditPhase==='replied')return {ok:false,current,expected:latest.postEditExpected,error:'Основное действие сохранено. Сохранение комментариев пока не подтверждено; повторная отправка не выполняется.'};
            }
            if(intent.kind==='restore'){
                for(const short of ['comments','partner_comment']){
                    const name='CustomerRequest['+short+']',before=current.document.nativeComments?.[short]?.value ?? current.form.values[name];
                    let next=root.LeadPartnerRules.removeCancellation(before,intent.cancelKind,intent.reason);
                    if(short==='partner_comment'&&intent.originalPartner&&!next)next=intent.originalPartner;
                    if(str(before)!==next)changes[name]=next;
                }
            }else if(intent.kind==='visit'){
                const freshHistory=record=>record.document.nativeComments?.date_changes?.value ?? record.form.values[HISTORY];
                const historyReady=record=>{const value=freshHistory(record);return !!value && str(value)!==str(intent.historyBefore) && !root.LeadPartnerRules.tagVisitHistory(intent.historyBefore,value,{panel:true}).unknown;};
                if(!historyReady(current))current=(await readVerified(readArgs,{},entry.expectedPrimaryPhoneField,historyReady)).current;
                const before=freshHistory(current);
                const tagged=root.LeadPartnerRules.tagVisitHistory(intent.historyBefore,before,{panel:true});
                if(tagged.unknown||!before||str(before)===str(intent.historyBefore))return {ok:false,current,expected:{},error:'Время визита сохранено. CRM ещё не вернула однозначную новую запись переноса для отметки «с Авито».'};
                if(tagged.changed)changes[HISTORY]=tagged.value;
            }
            if(!Object.keys(changes).length)return {ok:true,current,expected:{}};
            if(!current.document.commentsSave)return {ok:false,current,expected:{},error:'Основное действие сохранено, но CRM не разрешила сохранить блок комментариев.'};
            await recordOperation(args.operationId,{postEditExpected:changes,postEditPhase:'sent',expected:{...entry.expected,...changes}});
            let error;
            try{await writeEditedComments(args,changes,current.record.form.values);await recordOperation(args.operationId,{postEditPhase:'replied'});}catch(cause){error=cause;}
            const proof=await readVerified(readArgs,changes,entry.expectedPrimaryPhoneField),after=proof.current,checked=proof.verified;
            return {ok:checked.ok,current:after,expected:changes,error:checked.ok?'':error?.message||'Основное действие сохранено. CRM пока не подтвердила изменения комментариев.'};
        }
        async function readVerified(args, expected, primaryPhoneField, accepts = () => true) {
            const current=await readPrivate(args);
            return {current,verified:verify(current,expected,primaryPhoneField)};
        }
        function verify(current, expected, primaryPhoneField) {
            const diffs = [], checked = [], warnings = [];
            for (const [name, want] of Object.entries(expected || {})) {
                if(name==='_nativeReasonPending'){
                    // Status alone cannot acknowledge NF: its native reason
                    // continuation must have been selected and dispatched.
                    diffs.push({name,label:'Причина НФ',expected:'подтверждённая нативная причина',actual:'причина ещё не отправлена'});
                    continue;
                }
                if (name === '_nativeAction') {
                    const status = current.record.status || '';
                    const patterns = {cancel_kc:/Отмен|Отказ/i,cancel_branch:/Отмен|Отказ/i,cancel_regional:/Отмен|Отказ/i,
                        not_taken:/Не оформ|Не принят|^НФ$/i,on_precheck:/^На\s+уточнени[еи](?:\s|$)/iu,precheck_to_await:/^Ожидает$/iu,not_taken_to_await:/Ожидает/i,
                        to_not_created:/Не создан|Не оформ/i,create_draft:/Чернов/i,rejected_by_customer:/Отказ/i,unroll_finish:/Ожидает|В пути|В работе/i,cancel_transaction:/Ожидает|В пути|В работе/i};
                    const cancelling=['cancel_kc','cancel_branch','cancel_regional'].includes(want.key);
                    const wrongCancellation=want.key==='cancel_kc'?/Отмен[^\n]{0,25}Филиал/i.test(status)
                        :want.key==='cancel_branch'?/Отмен[^\n]{0,25}КЦ/i.test(status):false;
                    const confirmed = want.key === 'create_claim' ? current.record.hasClaim === true
                        : want.key === 'take' ? ACTIVE.test(status) && status!==want.beforeStatus && !current.record.actions.some(action=>action.key === 'take')
                        : patterns[want.key]?.test(status) && status !== want.beforeStatus
                            && (!cancelling || CLOSED.test(status) && !wrongCancellation);
                    if (confirmed) checked.push(name); else diffs.push({name,label:'Действие CRM',expected:want.key,actual:status});
                    continue;
                }
                if(name==='_preservedStatus'){
                    if(current.record.status===want)checked.push(name);else diffs.push({name,label:'Статус заявки',expected:want,actual:current.record.status});
                    continue;
                }
                if(name==='_cancellationReason'){
                    const exact=current.form.fields.find(item=>item.name===want.name);
                    const candidates=exact?[exact]:current.form.fields.filter(item=>item.tag==='select' && item.name!==N.reason
                        && /причин.*(?:смен|отмен)|(?:смен|отмен).*причин/i.test(item.label));
                    if(candidates.length){
                        if(candidates.every(item=>str(current.form.values[item.name])===want.id))checked.push(name);
                        else diffs.push({name,label:'Причина отмены',expected:want.label,actual:candidates.map(item=>str(current.form.values[item.name])).join(', ')});
                    }else warnings.push({name,code:'native_reason_not_rendered'});
                    continue;
                }
                if (name === '_timeChangeBefore') {
                    const history = current.form.values[HISTORY] ?? current.document.nativeComments?.date_changes?.value;
                    if (typeof history === 'string' && history.trim() && history !== want) checked.push(HISTORY);
                    else if(Object.keys(expected).some(key=>key===N.date || key===N.time)) warnings.push({name:HISTORY,code:'native_history_unchanged'});
                    else diffs.push({name:HISTORY,expected:'новая запись о переносе',actual:history || '',label:'История переносов'});
                    continue;
                }
                const form = isCustomerField(name) && current.customer ? current.customer.form : current.form;
                let item = field(form, name), got = form.values[name];
                const commentName = name.match(/^CustomerRequest\[(comments|comments_service|date_changes|partner_comment)\]$/)?.[1];
                if (commentName && current.document.commentConflicts?.includes(commentName)) {
                    diffs.push({name,expected:want,actual:null,label:'Конфликт значений комментария CRM'});continue;
                }
                if (commentName && current.document.nativeComments?.[commentName]) { item = current.document.nativeComments[commentName]; got = item.value; }
                if (!item && name === primaryPhoneField) { item = field(form, names(form).phone); got = item?.value; }
                if (!item && /^Customer\[phone(?:_extra_[1-3])?\]$/.test(name)) {
                    const phones = form.fields.filter(candidate => /\[contact_phones\].*\[v\]$/.test(candidate.name) && phone10(candidate.value).length === 10);
                    item = name === 'Customer[phone]' ? phones[0] : phones.find(candidate => phone10(candidate.value) === phone10(want));
                    got = item?.value;
                    if (!str(want).trim() && !item) { checked.push(name); continue; }
                }
                if (!item || normalizeValue(name, got) !== normalizeValue(name, want)) diffs.push({ name, expected: want, actual: item ? got : null, label: item?.label || name });
                else checked.push(name);
            }
            return { ok: !diffs.length, checked, diffs, ...(warnings.length?{warnings}:{}) };
        }
        function linkedPhoneName(current, phone) {
            return Object.keys(current.record.form.values).find(name =>
                /^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[^\]]+\]\[v\]$/.test(name)
                && phone10(current.record.form.values[name]) === phone) || '';
        }
        function createdIdentityMatches(current, entry) {
            const serviceName = 'CustomerRequest[comments_service]';
            const dialog = str(entry.expected?.[serviceName]);
            // CRM may remove the empty first line on creation. Ignore only
            // leading blank lines here; keep the entire dialog URL and every
            // nonblank character exact, without changing the saved text.
            const dialogIdentity = value => str(value).replace(/\r\n?/g,'\n').replace(/^\n+/,'');
            if (str(current.record.id) !== str(entry.id) || current.record.base !== entry.base
                || (entry.beforeIds || []).map(str).includes(str(entry.id))
                || !/https?:\/\/[^\s]+\/(?:chats|conversations)\//i.test(dialog) || entry.phone?.length !== 10
                || dialogIdentity(current.record.form.values[serviceName]) !== dialogIdentity(dialog)) return false;
            const phoneName = linkedPhoneName(current,entry.phone);
            if (!phoneName) return false;
            const expected = {[phoneName]:entry.phone};
            if (str(entry.expected?.[N.partner]).trim()) expected[N.partner] = entry.expected[N.partner];
            return verify(current, expected, current.record.fieldNames.phone).ok;
        }
        function createdSourceMatches(current, entry) {
            const wanted = str(entry.sourceCode || entry.expected?.[PARTNER_COMMENT]).trim();
            return !!wanted && createdIdentityMatches(current,entry) && verify(current,{[PARTNER_COMMENT]:wanted}).ok;
        }
        function normalizeChanges(form, input, allowCustomer) {
            const result = {};
            for (const [name, supplied] of Object.entries(input || {})) {
                if (!editableName(name) || protectedName(name)) throw new Error('Поле «' + name + '» недоступно для изменения.');
                const value = normalizeAddressField(name, supplied);
                if (allowCustomer && isCustomerField(name)) { result[name] = value; continue; }
                const item = field(form, name);
                if (!item || item.disabled || item.readOnly || (item.type === 'hidden' && name !== N.time && name !== N.reason)) throw new Error('Поле «' + (item?.label || name) + '» отсутствует или недоступно в CRM.');
                if (name === N.reason) {if (!['Клиент','Диспетчер','Директор'].includes(str(value))) throw Error('Выберите причину изменения времени визита.'); result[name]=str(value);}
                else if (name === N.date) result[name] = dateFor(value, item.type === 'date' ? '2000-01-01' : item.value);
                else if (name === N.time) {
                    const time = str(value).trim();
                    if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Укажите время визита в формате ЧЧ:ММ.');
                    result[name] = time.padStart(5, '0');
                } else if (/\[phone(?:_extra_[1-3])?\]$|\[contact_phones\].*\[v\]$/.test(name)) {
                    if (str(value).trim() && phone10(value).length !== 10) throw new Error('Телефон должен содержать 10 цифр.');
                    result[name] = str(value).trim() ? maskPhone(value) : '';
                } else if (item.type === 'checkbox') result[name] = value === true || str(value) === '1' ? '1' : '0';
                else if (item.tag === 'select') {
                    const selectedValue = typeof value === 'boolean' ? (value ? '1' : '0') : value;
                    const values = item.multiple ? (Array.isArray(selectedValue) ? selectedValue.map(str) : [str(selectedValue)]) : [str(selectedValue)];
                    if (item.required && values.some(selected => selected === '')) throw new Error('Заполните поле «' + item.label + '».');
                    result[name] = item.multiple ? values : values[0];
                } else result[name] = str(value);
            }
            return result;
        }
        function exactId(base, response) {
            for (const raw of [response.redirect, response.url]) {
                if (!raw) continue;
                try {
                    const url = new URL(raw, BASES[base]);
                    if (url.origin === BASES[base] && url.pathname === PATH + 'update') {
                        const ids=url.searchParams.getAll('id');
                        return ids.length===1 && /^\d+$/.test(ids[0]) ? ids[0] : '';
                    }
                } catch (_) { /* no uncorrelated ID recovery */ }
            }
            return '';
        }
        async function responseRejection(response) {
            // Yii AJAX validation returns field errors as JSON, not HTML. Do
            // not mistake a 200 validation response for a completed form save.
            if (/^\s*[\[{]/.test(response.text)) {
                try {
                    const value=JSON.parse(response.text);
                    const explicitFailure=value?.success===false || value?.result===false || value?.ok===false;
                    const errors=value?.errors && typeof value.errors==='object'?value.errors:value;
                    const messages=Array.isArray(errors) ? errors.flat() : Object.entries(errors || {})
                        .flatMap(([key,item])=>Array.isArray(item)?item:key==='error' && typeof item==='string'?[item]:[]);
                    if(explicitFailure && typeof value?.message==='string')messages.push(value.message);
                    if(messages.some(item=>typeof item==='string' && item.trim())) return messages.filter(item=>typeof item==='string').join('; ');
                    if(explicitFailure) return 'CRM отклонила сохранение.';
                } catch (_) { /* HTML readback remains authoritative. */ }
            }
            const document = await parseDocument(response.text, response.url);
            if (document.login || /\/(?:login|default\/index)(?:[/?#]|$)/i.test(response.redirect || response.url)) return 'Сессия CRM истекла. Форма не сохранена.';
            if (document.errors.length) return document.errors.join('; ');
            if (response.status >= 400) return 'CRM отклонила форму: HTTP ' + response.status + '.';
            return '';
        }
        async function persistResult(operationId, result, more) {
            const entry=await recordOperation(operationId, { result, state: result.state, ...(more || {}) });
            if(result.state==='rejected' || result.state==='uncertain'){
                preparedCreates.delete(entry.base+':'+entry.phone);
                preparedRequests.delete(entry.base+':'+entry.id);
            }
            if (['saved', 'rejected'].includes(result.state)) sentProgress.delete(operationId);
            return result;
        }
        async function markSent(args, patch) {
            const alreadyStarted = sentProgress.has(args.operationId);
            const entry = await recordOperation(args.operationId, { state: alreadyStarted ? 'sent' : 'prepared', phase: alreadyStarted ? 'sent' : 'prepared', ...patch });
            if (!writeGateAccepted.has(args.operationId) && typeof config.onBeforeWrite === 'function') {
                try {
                    const allowed = await config.onBeforeWrite({ base: entry.base, operationId: args.operationId, kind: entry.kind, id: entry.id || '' });
                    if (allowed === false || allowed?.ok === false) throw new Error(allowed?.error || 'Отправка формы не разрешена текущей операцией.');
                    writeGateAccepted.add(args.operationId);
                } catch (cause) {
                    const error = new Error(cause?.message || 'Отправка формы не разрешена текущей операцией.');
                    error.writeNotStarted = true;
                    await persistResult(args.operationId, reject(error.message, { code: 'write_gate_rejected', writeStarted: false, operationId: args.operationId }));
                    throw error;
                }
            }
            await recordOperation(args.operationId, { state: 'sent', phase: 'sent', writeStarted: true });
            sentProgress.set(args.operationId, { id: entry.id || '' });
            return entry;
        }
        async function mutate(args, kind, work) {
            if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(str(args.operationId))) return reject('Нет устойчивого ключа операции. Форма не отправлена.');
            const key = scope + ':' + args.operationId;
            const fingerprint = hash(JSON.stringify([kind, args.base, str(args.id || ''), Object.entries(args.fields || {}).sort(([a], [b]) => a.localeCompare(b)),
                args.date || '', args.time || '', args.reason || '', !!args.allowDuplicate, str(args.existingRequestId || ''), !!args.allowCustomerUpdate, str(args.action || 'save'),
                ...(args.submitAction ? [str(args.submitAction)] : []),
                ...(args.primaryPhoneField ? [str(args.primaryPhoneField)] : [])]));
            if (sharedInFlight.has(key)) {
                const existing = sharedInFlight.get(key);
                return existing.fingerprint === fingerprint ? existing.promise : reject('Под этим ключом уже отправляются другие поля.', { code: 'operation_changed' });
            }
            const operation = locked('write:'+args.operationId, async () => {
                let prior;
                try {
                    if (!storage) return reject('Хранилище операций недоступно. Форма не отправлена.');
                    prior = await journalChange(all => {
                        if (all[args.operationId]) return clone(all[args.operationId]);
                        all[args.operationId] = { operationId: args.operationId, kind, base: args.base, id: str(args.id || ''),
                            phone: operationPhone(args), fingerprint, state: 'preparing', createdAt: Date.now() };
                        return null;
                    });
                } catch (error) { return reject(error.message); }
                if (prior) {
                    if (prior.base && (prior.base !== args.base || prior.kind !== kind || (args.id && str(prior.id) !== str(args.id)))) return reject('Ключ операции уже относится к другой заявке.');
                    if (prior.fingerprint && prior.fingerprint !== fingerprint) return reject('Под этим ключом уже отправлялись другие поля. Сначала проверьте результат прежней операции.', { code: 'operation_changed' });
                    return prior.result || uncertain('Эта операция уже началась. Проверьте результат; повторная отправка заблокирована.', { operationId: args.operationId, id: prior.id || '' });
                }
                try { return await work(); }
                catch (error) {
                    const all = await storage.get(storageKey).catch(() => ({}));
                    const sent = sentProgress.has(args.operationId) || all?.[args.operationId]?.state === 'sent';
                    const sentId = sentProgress.get(args.operationId)?.id || all?.[args.operationId]?.id || '';
                    const result = error.writeNotStarted ? reject(error.message, { code: 'write_gate_rejected', writeStarted: false, operationId: args.operationId })
                        : sent ? uncertain(error.message + ' Результат отправки нужно проверить.', { operationId: args.operationId, id: sentId, writeStarted: true, ...(sentId ? {partial: true} : {}) }) : reject(error.message);
                    try { return await persistResult(args.operationId, result); }
                    catch (_) { return sent ? { ...result, error: result.error + ' Не удалось сохранить подтверждение в памяти расширения.' } : result; }
                }
            });
            sharedInFlight.set(key, { promise: operation, fingerprint });
            try { return await operation; } finally { sharedInFlight.delete(key); }
        }
        async function writeCustomer(base, current, changes) {
            // The request write and dependent lookups may take time. Read the customer
            // again so unrelated new data is preserved by this whole-form customer POST.
            const page = await documentAt(base, CUSTOMER_PATH + '?id=' + current.id);
            assertCustomerUrl(base, page.response, current.id);
            const freshForm = customerForm(page.document);
            if (!freshForm) throw new Error('Карточка клиента не перечиталась перед сохранением.');
            const oldPrimary = names(current.form).phone, freshPrimary = names(freshForm).phone;
            changes = remapPrimaryPhone(changes, freshForm, oldPrimary);
            for (const [name, wanted] of Object.entries(changes)) {
                const beforeName = name === freshPrimary && oldPrimary !== freshPrimary && !field(freshForm, oldPrimary) ? oldPrimary : name;
                const before = current.form.values[beforeName], now = freshForm.values[name];
                if (normalizeValue(name, before) !== normalizeValue(name, now) && normalizeValue(name, now) !== normalizeValue(name, wanted)) throw new Error('Поле клиента «' + (field(freshForm, name)?.label || name) + '» изменилось во время сохранения. Повторная запись не отправлена.');
            }
            const normalized = normalizeChanges(freshForm, changes, false);
            const body = serialize(freshForm, normalized, { param: page.document.csrfParam, token: page.document.csrfToken });
            const action = new URL(freshForm.action || CUSTOMER_PATH + '?id=' + current.id, baseUrl(base));
            if (action.origin !== BASES[base] || action.pathname !== CUSTOMER_PATH || action.searchParams.get('id') !== current.id) throw new Error('Адрес сохранения клиента изменился. Форма клиента не отправлена.');
            const response = await http(base, action.href, { method: 'POST', body, fullPage:true });
            const refusal = await responseRejection(response);
            if (refusal) throw new Error(refusal);
        }
        async function completeCreatedPartnerComment(args, id, wanted, initial) {
            // This is a SECOND, distinct edit on the exact record created by the
            // first POST. Never resubmit the creation form, and never retry an
            // ambiguous comment POST. Source is not part of the create response.
            const entry = ((await storage.get(storageKey)) || {})[args.operationId];
            if (!entry || entry.kind !== 'create' || entry.base !== args.base || str(entry.id) !== id
                || (entry.beforeIds || []).map(str).includes(id) || str(entry.sourceCode).trim() !== wanted || entry.phone?.length !== 10)
                throw new Error('Не подтверждена исходная операция создания заявки №' + id + '. Источник не записан.');
            let current, comments, item;
            for (let attempt = 0; attempt < 5; attempt++) {
                current = attempt === 0 && initial?.document.commentsSave ? initial : await readPrivate({ base: args.base, id, comments:true });
                if (current.document.commentConflicts?.length) throw new Error('CRM передала противоречивые значения комментариев заявки №' + id + '. Источник не записан.');
                const phoneName = linkedPhoneName(current,entry.phone);
                if (!phoneName) throw new Error('Телефон созданной заявки №' + id + ' не совпал с клиентом. Источник не записан.');
                if (!createdIdentityMatches(current,entry))
                    throw new Error('Телефон, партнёр или диалог заявки №' + id + ' не совпал с созданием. Источник не записан.');
                comments = current.document.nativeComments || {};
                item = field(current.form, PARTNER_COMMENT);
                const available = current.document.commentsSave?.mode === 'comments-only'
                    || (item && !item.disabled && !item.readOnly && item.type !== 'hidden');
                if (normalizeValue(PARTNER_COMMENT, comments.partner_comment?.value ?? item?.value) === normalizeValue(PARTNER_COMMENT,wanted)) break;
                if (available) break;
                if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 500));
            }
            const partner = comments.partner_comment;
            const existing = str(partner?.value ?? item?.value).trim();
            if (normalizeValue(PARTNER_COMMENT, existing) === normalizeValue(PARTNER_COMMENT, wanted)) {
                await recordOperation(args.operationId, { commentsPhase: 'verified' });
                return current;
            }
            if (existing) throw new Error('В заявке №' + id + ' уже записан другой комментарий партнёра. Автозамена запрещена.');
            if (entry.commentsPhase !== 'pending') throw new Error('Запись источника уже отправлялась. Повторная отправка отключена до проверки CRM.');
            const recipe = current.document.commentsSave;
            const csrf = current.document.commentsCsrf || {param:current.document.csrfParam,token:current.document.csrfToken};
            if (!csrf.token) throw new Error('В созданной заявке №' + id + ' нет CSRF-токена для сохранения источника.');
            if (!(recipe?.mode === 'comments-only' || (item && !item.disabled && !item.readOnly && item.type !== 'hidden'))) {
                throw new Error('Поле комментария партнёра ещё недоступно в карточке №' + id + '.');
            }
            let body, action;
            if (recipe?.mode === 'comments-only') {
                // The native save button sends all four comments. Preserve the
                // freshly read text and transfer history verbatim.
                body = new URLSearchParams({[csrf.param]:csrf.token,_comments_only:'true'});
                for (const short of ['comments','comments_service','date_changes','partner_comment']) {
                    if (!comments[short]) throw new Error('CRM не передала все комментарии заявки №' + id + '. Сохранение источника остановлено, чтобы не стереть данные.');
                    body.set(short, short === 'partner_comment' ? wanted : comments[short].value);
                }
                action = new URL(recipe.url, baseUrl(args.base));
            } else {
                // Older CRM versions use an ordinary native form. Only actual
                // names from that form are permitted; do not invent Yii fields
                // for a separate, unrecognised comment widget.
                if (!item || item.name !== PARTNER_COMMENT) throw new Error('CRM не передала способ сохранения комментария партнёра в заявке №' + id + '.');
                body = serialize(current.form, normalizeChanges(current.form, {[PARTNER_COMMENT]:wanted}, false),
                    {param:current.document.csrfParam,token:current.document.csrfToken});
                nativeSubmit(current.form, body, false);
                action = new URL(current.form.action || current.record.url, baseUrl(args.base));
            }
            if (action.origin !== BASES[args.base] || action.pathname !== PATH + 'update' || action.searchParams.get('id') !== id)
                throw new Error('CRM изменила адрес формы сохранения заявки №' + id + '. Источник не отправлен.');
            // From here, there may have been a write; a retry is NOT safe.
            await recordOperation(args.operationId, {commentsPhase:'sending',commentsRecordId:id,commentsMode:recipe?.mode || 'native-form'});
            let writeError;
            try {
                const response = await http(args.base, action.href, {method:'POST',body});
                const refusal = await responseRejection(response);
                if (refusal) throw new Error('Источник не сохранён в заявке №' + id + ': ' + refusal);
                let json;
                try {json=JSON.parse(response.text)} catch (_) {/* verify by independent GET */}
                if (json?.result === false) throw new Error('CRM отклонила изменение источника в заявке №' + id + '.');
            } catch (error) {writeError=error;}
            // Commit visibility can lag even after a successful reply, or the
            // reply can be lost. Retry only independent reads, never this POST.
            const {current:after,verified} = await readVerifiedWithRetry(
                () => readPrivate({base:args.base,id,comments:true}),
                fresh => ({ok:createdSourceMatches(fresh,entry)}));
            if (!verified.ok) throw writeError || new Error('Заявка №' + id + ' существует, но CRM не подтвердила источник после повторного сохранения.');
            await recordOperation(args.operationId,{commentsPhase:'verified'});
            return after;
        }
        async function createRequest(args) {
            return mutate(args, 'create', async () => {
                if(args.submitAction !== undefined && args.submitAction !== 'clarify')return persistResult(args.operationId,reject('Неизвестный способ создания заявки. Форма не отправлена.'));
                let input = normalizeAddressFields(args.fields);
                const phone = operationPhone(args);
                if (phone.length !== 10) return persistResult(args.operationId, reject('Укажите телефон клиента из 10 цифр.'));
                const formKey=args.base+':'+phone;
                const prepared=preparedCreates.get(formKey);
                const current = prepared && Date.now()-prepared.at<nativeFormTtl ? prepared.current : await getCreate({base:args.base,phone});
                preparedCreates.set(formKey,{at:Date.now(),current});
                const lookup=current.lookup;
                const command=args.submitAction==='clarify' ? current.document.actions.find(item=>item.key==='on_precheck' && item.enabled && item.type==='submit') : null;
                if(args.submitAction==='clarify'){
                    const target=new URL(current.form.action || PATH+'create',BASES[args.base]);
                    if(!command || current.form.method!=='POST' || target.origin!==BASES[args.base] || target.pathname!==PATH+'create')
                        return persistResult(args.operationId,reject('В выбранной CRM недоступна штатная кнопка «На уточнение». Форма не отправлена.'));
                }
                input = remapPrimaryPhone(input, current.customer?.form || current.form, args.primaryPhoneField);
                const expectedPrimaryPhoneField = names(current.form, current.customer).phone;
                if (args.expectedOperator && str(args.expectedOperator).trim().toLowerCase() !== str(current.document.sessionOperator).trim().toLowerCase()) return persistResult(args.operationId, reject('В выбранной CRM не подтверждён ожидаемый сотрудник. Проверьте вход.', { sessionOperator: current.document.sessionOperator || '' }));
                const diffs = customerDiffs(current.customer, input);
                if (diffs.some(item => item.unsupported)) return persistResult(args.operationId, reject('Некоторые поля клиента отсутствуют в его карточке CRM.', { customerDiffs: diffs }));
                if (diffs.length) normalizeChanges(current.customer.form, Object.fromEntries(diffs.map(item => [item.name, item.after])), false);
                const work = str(input[N.work] || current.form.values[N.work]);
                if (!work) return persistResult(args.operationId, reject('Выберите вид работ.'));
                // Partner comment is a SECOND save on the newly created request,
                // regardless of what an unsaved creation form happened to expose.
                const deferredPartnerComment = str(input[PARTNER_COMMENT]).trim();
                const requestInput = Object.fromEntries(Object.entries(input).filter(([name]) => (!current.customer || !isCustomerField(name)) && name !== PARTNER_COMMENT));
                const changes = normalizeChanges(current.form, requestInput, false);
                if (current.customer) changes[N.customer] = current.customer.id;
                if (!current.customer && !Object.prototype.hasOwnProperty.call(changes, 'Customer[age]') && field(current.form, 'Customer[age]')) changes['Customer[age]'] = '31';
                for (const name of [N.city, N.work, N.type]) if (!str(changes[name] ?? current.form.values[name])) return persistResult(args.operationId, reject('Заполните город, вид работ и тип заявки.'));
                const body = serialize(current.form, changes, { param: current.document.csrfParam, token: current.document.csrfToken });
                // Even an old/pre-filled create form cannot submit a source.
                // It belongs to the distinct save on the newly created ID.
                body.delete(PARTNER_COMMENT);
                const submit = nativeSubmit(current.form, body, !command);
                nativeCommand(current.form,body,command);
                const expected = { ...changes, ...Object.fromEntries(Object.entries(input).filter(([name]) => isCustomerField(name))) };
                if(command)expected._nativeAction={key:command.key,beforeStatus:current.document.status || ''};
                if (deferredPartnerComment) expected[PARTNER_COMMENT] = deferredPartnerComment;
                delete expected[N.customer];
                await markSent(args, { phone, expected, expectedPrimaryPhoneField, beforeIds: lookup.matches.map(item => item.id), submit,
                    ...(deferredPartnerComment ? { commentsPhase: 'pending', sourceCode: deferredPartnerComment } : {}),
                    customerChanges: diffs.length ? Object.fromEntries(diffs.map(item => [item.name, item.after])) : {}, customerId: current.customer?.id || '' });
                // The native create button posts an ordinary form. An AJAX
                // header can route Yii into its validation-only response.
                const response = await http(args.base, PATH + 'create' + (lookup.customerId ? '?customer_id=' + lookup.customerId : ''), { method: 'POST', body, fullPage:true });
                const refusal = await responseRejection(response);
                if (refusal) return persistResult(args.operationId, reject(refusal, { operationId: args.operationId }));
                let id = exactId(args.base, response);
                if (!id) {
                    return persistResult(args.operationId,uncertain('CRM не вернула номер заявки.',{operationId:args.operationId,writeStarted:true}));
                }
                // Keep the exact redirect immediately, even if its durable checkpoint fails.
                sentProgress.set(args.operationId, { id });
                await markSent(args, { id });
                if (diffs.length) await writeCustomer(args.base, current.customer, Object.fromEntries(diffs.map(item => [item.name, item.after])));
                const desiredSource = str(input[PARTNER_COMMENT]).trim();
                let after = await readPrivate({base:args.base,id,comments:!!desiredSource,preferCustomerRead:diffs.length>0,
                    customerFieldNames:(current.customer?.form || current.form).fields.filter(item=>isCustomerField(item.name)).map(item=>item.name)},response);
                // Some CRM versions expose the partner comment on the create
                // page but silently ignore its value. Only a confirmed created
                // ID permits the comments-only follow-up write.
                let sourceWarning = '';
                if (desiredSource) {
                    try { after = await completeCreatedPartnerComment(args, id, desiredSource, after); }
                    catch (error) {
                        sourceWarning = 'Источник требует проверки: ' + (error?.message || 'не подтверждена запись комментария партнёра');
                        // The request itself already has an exact NEW ID. A
                        // comment write may have succeeded despite a timeout.
                        // Read once more; do not blindly repeat this POST.
                        after = await readPrivate({base:args.base,id,comments:true});
                    }
                }
                const verified = verify(after, expected, expectedPrimaryPhoneField);
                if(expected._nativeAction && verified.diffs.some(item=>item.name==='_nativeAction'))return persistResult(args.operationId,uncertain('Заявка создана, но CRM пока не подтвердила статус «На уточнение». Повторное создание отключено.',{id,url:after.record.url,record:after.record,verified,operationId:args.operationId}));
                if (!linkedPhoneName(after,phone)) return persistResult(args.operationId, uncertain('CRM вернула карточку с другим телефоном. Номер не принят как подтверждение создания.', {id, operationId:args.operationId}));
                const differences = verified.diffs || [];
                // A freshly created, separately read record with a new exact
                // ID and the expected PRIMARY phone proves existence. It does
                // NOT prove that every field was stored as requested; surface
                // any differences explicitly and allow correction in the card.
                const sourceCommitted = createdSourceMatches(after,{id,base:args.base,phone,expected,sourceCode:desiredSource});
                if (sourceCommitted) {
                    sourceWarning = '';
                    await recordOperation(args.operationId,{commentsPhase:'verified'});
                }
                const result = {ok:true,state:'saved',id,url:after.record.url,record:after.record,
                    sourceCommitted, expectedSource: desiredSource,
                    verified:verified.ok ? verified : {...verified,ok:true,recordConfirmed:true,partial:true},
                    ...(sourceWarning ? {sourceWarning} : {}),
                    ...(differences.length ? {fieldDifferences:differences,
                      notice:'Заявка создана и подтверждена по номеру и телефону, но есть расхождения: ' + (sourceWarning || 'Проверьте карточку CRM.') } : {}),
                    operationId:args.operationId};
                return persistResult(args.operationId, result);
            });
        }
        async function update(args, rescheduling) {
            return mutate(args, rescheduling ? 'reschedule' : 'save', async () => {
                const prepared=preparedRequests.get(args.base+':'+str(args.id));
                const current = prepared && Date.now()-prepared.at<nativeFormTtl ? prepared.current : await readPrivate(args);
                // Reject a stale editor against the already known native card; no extra read is needed.
                if (args.expectedRevision && str(args.expectedRevision) !== str(current.record.revision)) return persistResult(args.operationId, reject('Карточка уже обновлена. Обновите её и повторите изменения.', { code: 'revision_conflict', safeToRetry: true, writeStarted: false, operationId: args.operationId }));
                const actionKey = str(args.action || 'save');
                let command = actionKey === 'save' ? null : current.record.actions.find(item=>item.key === actionKey && item.enabled);
                const waiting=actionKey==='precheck_to_await';
                if(waiting && (!clarification(current.record.status) || command?.type!=='submit' || current.form.method!=='POST'))return persistResult(args.operationId,reject('Перевод в ожидание доступен только для заявки на уточнении со штатной кнопкой CRM. Обновите карточку.'));
                if(actionKey==='create_claim')return persistResult(args.operationId,reject('Выберите тип и заполните форму претензии перед сохранением.'));
                if (actionKey !== 'save' && !command) return persistResult(args.operationId,reject('Это действие больше недоступно в CRM. Обновите карточку.'));
                if (current.record.capabilities.readOnly && !['create_claim','not_taken',...RESTORE_ACTIONS].includes(actionKey)) return persistResult(args.operationId,reject('Заявка закрыта. В CRM она доступна только для просмотра.'));
                if (args.expectedOperator && str(args.expectedOperator).trim().toLowerCase() !== str(current.document.sessionOperator).trim().toLowerCase()) return persistResult(args.operationId, reject('В выбранной CRM не подтверждён ожидаемый сотрудник. Проверьте вход.', { sessionOperator: current.document.sessionOperator || '' }));
                // Closed cards cannot edit draft fields. Native return acts only on the
                // freshly read exact card, independently of incidental panel defaults.
                const input = normalizeAddressFields(remapPrimaryPhone(current.record.capabilities.readOnly && command?.type==='link' ? {} : args.fields || {}, current.customer?.form || current.form, args.primaryPhoneField));
                const expectedPrimaryPhoneField = names(current.form, current.customer).phone;
                if(args.allowBindingChange !== true || actionKey !== 'save') {
                const binding=root.LeadPartnerRules.preserveBinding({partnerId:current.form.values[N.partner],partnerComment:current.form.values[PARTNER_COMMENT],comments:current.form.values['CustomerRequest[comments]'],commentsService:current.form.values['CustomerRequest[comments_service]']},{partnerId:input[N.partner],partnerComment:input[PARTNER_COMMENT],comments:input['CustomerRequest[comments]'] ?? current.form.values['CustomerRequest[comments]'],commentsService:input['CustomerRequest[comments_service]'] ?? current.form.values['CustomerRequest[comments_service]']});
                for(const [name,value]of [[N.partner,binding.partnerId],[PARTNER_COMMENT,binding.partnerComment],['CustomerRequest[comments]',binding.comments],['CustomerRequest[comments_service]',binding.commentsService]])if(Object.hasOwn(input,name))input[name]=value;
                }
                if (rescheduling) {
                    if (!args.date || !args.time || !['Клиент', 'Диспетчер', 'Директор'].includes(args.reason)) return persistResult(args.operationId, reject('Укажите дату, время и причину переноса.'));
                    if (!field(current.form, N.reason)) return persistResult(args.operationId, reject('В форме CRM нет поля причины переноса.'));
                    input[N.date] = args.date; input[N.time] = args.time; input[N.reason] = args.reason;
                }
                // The panel submits its complete draft. Unchanged readonly
                // native controls are evidence, not attempts to edit them.
                for (const [name,value] of Object.entries(input)) {
                    const source = isCustomerField(name) && current.customer ? current.customer.form : current.form;
                    const actual = current.document.nativeComments?.[name.match(/^CustomerRequest\[(comments|comments_service|date_changes|partner_comment)\]$/)?.[1]];
                    if ((field(source,name) || actual) && normalizeValue(name,value) === normalizeValue(name,actual?.value ?? source.values[name])) delete input[name];
                }
                const customerChanges = Object.fromEntries(Object.entries(input).filter(([name]) => isCustomerField(name)));
                const diffs = customerDiffs(current.customer, customerChanges);
                if (Object.keys(customerChanges).length && !current.customer) throw new Error('Карточка клиента не определена.');
                if (diffs.some(item => item.unsupported)) return persistResult(args.operationId, reject('Некоторые поля отсутствуют в карточке клиента CRM.', { customerDiffs: diffs }));
                if (diffs.length) normalizeChanges(current.customer.form, Object.fromEntries(diffs.map(item => [item.name, item.after])), false);
                const requestInput = Object.fromEntries(Object.entries(input).filter(([name]) => !isCustomerField(name)));
                const cancelling=['cancel_kc','cancel_branch'].includes(actionKey);
                const notTaken=actionKey==='not_taken',nativeReasonAction=cancelling || notTaken;
                if(cancelling){
                    const name='CustomerRequest[comments_service]';
                    const previous=str(requestInput[name] ?? current.document.nativeComments?.comments_service?.value ?? current.form.values[name]);
                    requestInput[name]=/(?:^|\n)\s*отмена\s+с\s+авито\s*(?:\n|$)/i.test(previous)?previous:[previous,'Отмена с Авито'].filter(Boolean).join('\n');
                }
                if(notTaken){
                    for(const [short,line] of [['comments_service','Отмена с Авито'],['comments',NOT_TAKEN_COMMENT]]){
                        const name='CustomerRequest['+short+']';
                        requestInput[name]=appendUniqueLine(current.document.nativeComments?.[short]?.value ?? current.form.values[name],line);
                    }
                    // Keep the immutable source; add only a removable NF line.
                    requestInput[PARTNER_COMMENT]=appendUniqueLine(current.document.nativeComments?.partner_comment?.value ?? current.form.values[PARTNER_COMMENT],NOT_TAKEN_COMMENT);
                }
                if(nativeReasonAction){
                    const name='CustomerRequest[comments_service]';
                    const previous=str(current.document.nativeComments?.comments_service?.value ?? current.form.values[name]);
                    const bound=previous.split(/\r?\n/).find(line=>/^https?:\/\/(?:chat\.partner-lead-centre\.ru|188-225-34-82\.sslip\.io|72-56-68-159\.sslip\.io)\/chats\/[A-Za-z0-9_-]+\/?$/u.test(line.trim()));
                    if(bound)requestInput[name]=root.LeadPartnerRules.serviceComment(str(requestInput[name]).replace(/^(?:[ \t]*\r?\n)+/u,''),bound.trim());
                }
                const commentChanges={};
                if(current.document.commentsSave)for(const short of ['comments','comments_service','date_changes','partner_comment']){
                    const name='CustomerRequest['+short+']';
                    if(Object.hasOwn(requestInput,name)){commentChanges[name]=str(requestInput[name]);delete requestInput[name];}
                }
                const sourceItem = field(current.form,PARTNER_COMMENT), nativeSource = current.document.nativeComments?.partner_comment;
                const preserveSource = Object.prototype.hasOwnProperty.call(requestInput,PARTNER_COMMENT)
                    && (!sourceItem || sourceItem.disabled || sourceItem.readOnly) && nativeSource
                    && normalizeValue(PARTNER_COMMENT,requestInput[PARTNER_COMMENT]) === normalizeValue(PARTNER_COMMENT,nativeSource.value);
                if (preserveSource) delete requestInput[PARTNER_COMMENT];
                const requestChanges = normalizeChanges(current.form, requestInput, false);
                const changed = Object.fromEntries(Object.entries(requestChanges).filter(([name, value]) => normalizeValue(name, value) !== normalizeValue(name, current.form.values[name])));
                const expected = { ...requestChanges, ...customerChanges, ...commentChanges };
                if(actionKey==='save' && clarification(current.record.status))expected._preservedStatus=current.record.status;
                if (preserveSource) expected[PARTNER_COMMENT] = input[PARTNER_COMMENT];
                const timeChanged = Object.keys(changed).some(name => name === N.date || name === N.time);
                const historyBeforeVisit=Object.hasOwn(commentChanges,HISTORY)?str(commentChanges[HISTORY]):str(current.form.values[HISTORY] ?? current.document.nativeComments?.date_changes?.value);
                if(timeChanged && Object.hasOwn(commentChanges,HISTORY))delete expected[HISTORY];
                if (timeChanged) {
                    if (!field(current.form, N.reason)) return persistResult(args.operationId, reject('В форме CRM нет поля причины переноса.'));
                    const reason = requestChanges[N.reason] || args.reason;
                    if (!['Клиент', 'Диспетчер', 'Директор'].includes(str(reason))) return persistResult(args.operationId, reject('Выберите причину изменения времени визита.'));
                    requestChanges[N.reason] = reason;
                    // Reason is a transient native command. The actual saved
                    // date/time are authoritative; history rendering varies by CRM.
                    delete expected[N.reason];
                    expected._timeChangeBefore = historyBeforeVisit;
                } else delete expected[N.reason];
                if (!Object.keys(changed).length && !diffs.length && !Object.keys(commentChanges).length && !command) return persistResult(args.operationId, { ok: true, state: 'saved', already: true, id: str(args.id), url: current.record.url, record: current.record, verified: verify(current, expected, expectedPrimaryPhoneField), operationId: args.operationId });
                if (command?.type === 'link' && (Object.keys(changed).length || diffs.length)) return persistResult(args.operationId,reject('Сначала сохраните изменения карточки, затем выполните выбранное действие.'));
                if (command && command.key !== 'save_close') expected._nativeAction = {key:command.key,beforeStatus:current.record.status};
                if(notTaken)expected._nativeReasonPending=true;
                // Moderation/precheck forms can echo customer data. A stale address in that
                // form must not undo a later edit of the shared customer card on reschedule.
                const customerEcho = {};
                if (current.customer) for (const item of current.form.fields) {
                    if (!isCustomerField(item.name) || item.disabled || item.readOnly || item.type === 'hidden') continue;
                    if (field(current.customer.form, item.name)) customerEcho[item.name] = current.customer.form.values[item.name];
                    if (Object.prototype.hasOwnProperty.call(customerChanges, item.name)) customerEcho[item.name] = customerChanges[item.name];
                }
                const restoring=RESTORE_ACTIONS.includes(actionKey)&&!!root.LeadPartnerRules.cancellationKind(current.record.status);
                const reasonField=current.form.fields.find(v=>v.tag==='select'&&/(?:cancel|not_taken).*reason|reason.*(?:cancel|not_taken)/iu.test(v.name));
                const reasonOption=reasonField?.options?.find(v=>v.id===str(current.form.values[reasonField.name]));
                const note=restoring?(await storage.get('leadPartnerCancellationNoteV1:'+args.base+':'+args.id))||{}:{};
                const postEditIntent=restoring?{kind:'restore',cancelKind:root.LeadPartnerRules.cancellationKind(current.record.status),reason:note.reason || reasonOption?.text || reasonOption?.label || '',originalPartner:note.originalPartner || ''}:timeChanged?{kind:'visit',historyBefore:historyBeforeVisit}:null;
                const visitBefore=timeChanged?{fromAvito:true,beforeDate:isoDate(current.record.form.values[N.date]),beforeTime:normalizeValue(N.time,current.record.form.values[N.time])}:null;
                if(visitBefore && field(current.form,CALL_CHECK)){
                    const intended=requestChanges[CALL_CHECK] ?? current.form.values[CALL_CHECK];
                    visitBefore.callCheckBefore=callCheckState(current.form.values[CALL_CHECK]);
                    visitBefore.callCheckAfter=callCheckState(intended);
                    // Even an unchanged flag belongs to this exact saved transfer.
                    // A later CRM toggle must not become its notification transition.
                    expected[CALL_CHECK]=intended;
                }
                const callCheckChange=!timeChanged && !command && field(current.form,CALL_CHECK) && Object.hasOwn(requestChanges,CALL_CHECK) && callCheckState(current.form.values[CALL_CHECK])!==callCheckState(requestChanges[CALL_CHECK]) ? {callCheckBefore:callCheckState(current.form.values[CALL_CHECK]),callCheckAfter:callCheckState(requestChanges[CALL_CHECK])}:null;
                await markSent(args, { ...(callCheckChange?{callCheckChange}:{}),id: str(args.id), customerId: current.customer?.id || '', expected, expectedPrimaryPhoneField, transport:'native-form-v3',...(postEditIntent?{postEditIntent}:{}),rescheduleReason:timeChanged?requestChanges[N.reason]:'',...(visitBefore?{visitBefore}:{}),...(nativeReasonAction?{nativeCancellationVersion:2,originalPartnerComment:str(current.form.values[PARTNER_COMMENT])}:{}),nativeActionPhase:command?'pending':'' });
                let submitCurrent=current,commentsWritten=false;
                if((nativeReasonAction || timeChanged && Object.hasOwn(commentChanges,HISTORY)) && Object.keys(commentChanges).length){
                    let commentError;
                    try{await writeEditedComments(args,commentChanges,current.record.form.values);}catch(error){commentError=error;}
                    submitCurrent=await readPrivate(args);
                    const commentProof=verify(submitCurrent,commentChanges,expectedPrimaryPhoneField);
                    if(!commentProof.ok)throw Error(commentError?.message || 'Не удалось сохранить комментарии. Основное действие не отправлено.');
                    commentsWritten=true;
                    if(submitCurrent.record.status!==current.record.status || !submitCurrent.record.actions.some(item=>item.key===actionKey && item.enabled))throw Error('Статус заявки изменился перед сохранением. Обновите карточку.');
                    command=submitCurrent.record.actions.find(item=>item.key===actionKey && item.enabled);
                    for(const name of Object.keys(customerEcho))if(!Object.hasOwn(customerChanges,name) && Object.hasOwn(submitCurrent.customer?.form.values || {},name))customerEcho[name]=submitCurrent.customer.form.values[name];
                }
                // The native clarification form accepts the current comments
                // together with case22. Keep them in that same submit payload.
                const body = serialize(submitCurrent.form, { ...customerEcho, ...requestChanges, ...(waiting ? commentChanges : {}) }, { param: submitCurrent.document.csrfParam, token: submitCurrent.document.csrfToken });
                if(waiting)commentsWritten=true;
                nativeSubmit(submitCurrent.form, body, false);
                nativeCommand(submitCurrent.form,body,command);
                const action = new URL(command?.type === 'link' ? command.url : submitCurrent.form.action || current.record.url, baseUrl(args.base));
                if (action.origin !== BASES[args.base] || action.searchParams.get('id') !== str(args.id) || action.searchParams.getAll('id').length !== 1
                    || (command?.type === 'link' ? ![PATH+'take-to-work',PATH+'create-claim',PATH+'cancel-to-not-taken',PATH+'cancel-transaction'].includes(action.pathname) : action.pathname !== PATH+'update')) throw new Error('Адрес сохранения заявки изменился. Форма не отправлена.');
                let nativeResponse;
                if (Object.keys(changed).length || command) {
                    if(command)await recordOperation(args.operationId,{nativeActionPhase:'sent'});
                    const method = command?.type === 'link' ? command.method : 'POST';
                    const response = await http(args.base, action.href, { method, fullPage:true, ...(method === 'POST' ? {body} : {}) });
                    nativeResponse=response;
                    if(nativeReasonAction){const prepared=await captureCancellation(args,response,submitCurrent);if(prepared)return prepared;}
                    const refusal = await responseRejection(response);
                    if (refusal) return persistResult(args.operationId, reject(refusal, { id: str(args.id), operationId: args.operationId }));
                }
                if (diffs.length) await writeCustomer(args.base, current.customer, Object.fromEntries(diffs.map(item => [item.name, item.after])));
                if(!commentsWritten && Object.keys(commentChanges).length)await writeEditedComments(args,commentChanges,current.record.form.values);
                const afterArgs={...args,preferCustomerRead:diffs.length>0,customerFieldNames:(current.customer?.form || current.form).fields.filter(item=>isCustomerField(item.name)).map(item=>item.name)};
                // Waiting submits the edited comments in this same native
                // POST. Its returned card can prove both the status and text;
                // only separately-written comments make that reply stale.
                const returned=await readPrivate(afterArgs,commentsWritten || !Object.keys(commentChanges).length?nativeResponse:undefined,current);
                const proof={current:returned,verified:verify(returned,expected,expectedPrimaryPhoneField)};
                let after=proof.current,verified=proof.verified;
                if(!verified.ok && nativeResponse && after.response===nativeResponse){
                    // Some CRM actions render the pre-submit form even after
                    // committing. Confirm an ambiguous reply once, by GET;
                    // never replay the POST or override a real field mismatch.
                    const confirmation=await readVerified(afterArgs,expected,expectedPrimaryPhoneField);
                    after=confirmation.current;verified=confirmation.verified;
                }
                if(verified.ok&&postEditIntent){const post=await completePostEdit(args,after,{expected,expectedPrimaryPhoneField,postEditIntent});after=post.current;Object.assign(expected,post.expected);verified=verify(after,expected,expectedPrimaryPhoneField);if(!post.ok)return persistResult(args.operationId,uncertain(post.error,{id:str(args.id),record:after.record,operationId:args.operationId,primarySaved:true}));}
                return persistResult(args.operationId, verified.ok ? { ok: true, state: 'saved', id: str(args.id), url: after.record.url, record: after.record, verified, operationId: args.operationId,
                    ...(callCheckChange?{callCheckChange:{...callCheckChange,callCheckAfter:callCheckState(after.record.form.values[CALL_CHECK])}}:{}),
                    ...(timeChanged && !command?{visitChange:{...visitBefore,...(typeof visitBefore?.callCheckBefore==='boolean'?{callCheckAfter:callCheckState(after.record.form.values[CALL_CHECK])}:{}),date:isoDate(after.record.form.values[N.date]),time:normalizeValue(N.time,after.record.form.values[N.time]),reason:requestChanges[N.reason]}}:{}) }
                    : uncertain('Отправка завершилась, но CRM сохранила другие значения. Проверьте карточку.', { id: str(args.id), url: after.record.url, record: after.record, verified, partial: true, operationId: args.operationId }));
            });
        }
        async function reconcile(args) {
            return locked('write', async () => {
            let entry;
            try {
                if (!storage) return reject('Хранилище операций недоступно.');
                entry = ((await storage.get(storageKey)) || {})[args.operationId];
                if (!entry || entry.base !== args.base) return uncertain('Журнал этой операции не найден. Повторная отправка заблокирована до проверки результата в CRM.', { code: 'operation_missing', operationId: args.operationId });
                if (entry.state === 'rejected') return entry.result ? await persistResult(args.operationId, entry.result) : uncertain('Запись результата операции неполна.', { operationId: args.operationId });
                if (entry.state === 'saved' && (entry.result?.sourceCommitted === true || !entry.sourceCode))
                    return entry.result ? await persistResult(args.operationId, entry.result) : uncertain('Запись результата операции неполна.', { operationId: args.operationId });
                if(entry.state==='awaiting_reason' && entry.nativeActionPhase==='reason_pending'){
                    const current=await readPrivate({base:entry.base,id:entry.id});
                    if(Object.hasOwn(entry,'reasonStageStatus') && current.record.status!==entry.reasonStageStatus)return persistResult(args.operationId,reject('Статус заявки уже изменился в CRM.',{id:entry.id,record:current.record,operationId:args.operationId}));
                    if(!Object.hasOwn(entry,'reasonStageStatus'))entry=await recordOperation(args.operationId,{reasonStageStatus:current.record.status,reasonStageRevision:current.record.revision});
                    return persistResult(args.operationId,cancellationResult(entry,current.record));
                }
                if (entry.phase === 'prepared') return await persistResult(args.operationId, reject('Операция прервалась до отправки формы в CRM. Можно подготовить новое сохранение.', { code: 'write_not_started', writeStarted: false, operationId: args.operationId }));
                if (args.candidateId) {
                    const candidateId = str(args.candidateId);
                    if (entry.kind !== 'create' || !/^\d+$/.test(candidateId) || (entry.beforeIds || []).includes(candidateId)) return uncertain('Выбранная карточка уже существовала до отправки или не относится к созданию.', { operationId: args.operationId });
                    if (entry.id && entry.id !== candidateId) return uncertain('CRM уже вернула другой точный номер. Подмена номера операции не допускается.', { operationId: args.operationId, id: entry.id });
                    const expected = entry.expected || {};
                    if (!str(expected['CustomerRequest[partner_comment]']).trim() || !/https?:\/\/[^\s]+\/(?:chats|conversations)\//i.test(str(expected['CustomerRequest[comments_service]'])) || entry.phone.length !== 10) {
                        return uncertain('Для ручной сверки не сохранены источник, телефон и ссылка диалога. Требуется проверка карточки CRM.', { operationId: args.operationId });
                    }
                    const lookup = await search({ base: entry.base, phone: entry.phone });
                    if (!lookup.ok || !lookup.matches.some(item => item.id === candidateId)) return uncertain('Выбранная заявка не найдена при свежем поиске телефона в этой базе.', { operationId: args.operationId });
                    let current = await readPrivate({ base: entry.base, id: candidateId });
                    const wanted = str(entry.sourceCode || expected[PARTNER_COMMENT]).trim();
                    // Partner comment is absent before the SECOND save; do not reject
                    // a newly created card merely because that stage has not run yet.
                    const beforeSource = {...expected};
                    delete beforeSource[PARTNER_COMMENT];
                    const checked = verify(current, beforeSource, entry.expectedPrimaryPhoneField);
                    const actualPhoneName = current.record.fieldNames.phone;
                    if (!linkedPhoneName(current,entry.phone)) checked.diffs.push({ name: actualPhoneName, expected: entry.phone, actual: current.record.form.values[actualPhoneName], label: 'Телефон клиента' });
                    const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(current.record.createdAt || '') ? Date.parse(current.record.createdAt) : NaN;
                    if (Number.isFinite(timestamp) && (timestamp < entry.createdAt - 120000 || timestamp > Date.now() + 120000)) checked.diffs.push({ name: 'createdAt', expected: 'после начала операции', actual: current.record.createdAt, label: 'Время создания' });
                    checked.ok = !checked.diffs.length;
                    if (!checked.ok) return uncertain('Выбранная заявка не совпала с данными отправленной формы.', { operationId: args.operationId, candidateId, record: current.record, verified: checked });
                    await recordOperation(args.operationId, { id: candidateId, confirmedCandidate: true });
                    if (wanted && entry.commentsPhase === 'pending') {
                        try { current = await completeCreatedPartnerComment({base:entry.base,operationId:args.operationId},candidateId,wanted,current); }
                        catch (_) { current = await readPrivate({base:entry.base,id:candidateId}); }
                    }
                    const sourceCommitted = createdSourceMatches(current,{...entry,id:candidateId});
                    const verified = verify(current, expected, entry.expectedPrimaryPhoneField);
                    return await persistResult(args.operationId, {ok:true,state:'saved',id:candidateId,url:current.record.url,record:current.record,
                        sourceCommitted,expectedSource:wanted,
                        verified:verified.ok ? verified : {...verified,ok:true,recordConfirmed:true,partial:true},
                        ...(!verified.ok ? {fieldDifferences:verified.diffs,notice:'Заявка найдена, но некоторые поля требуют проверки.'} : {}),
                        candidateConfirmed:true,operationId:args.operationId});
                }
                if (!entry.id) {
                    const lookup = await search({ base: entry.base, phone: entry.phone });
                    return uncertain('Точный номер не получен. Найденные заявки требуют проверки; создание повторно не отправлялось.', { operationId: args.operationId,
                        candidates: lookup.ok ? lookup.matches.filter(item => !(entry.beforeIds || []).includes(item.id)) : [], searchError: lookup.ok ? '' : lookup.error });
                }
                const readArgs={base:entry.base,id:entry.id,...(entry.postEditIntent?{comments:true}:{})};
                let current = entry.kind!=='create' && !entry.expected?._nativeAction
                    ? (await readVerified(readArgs,entry.expected || {},entry.expectedPrimaryPhoneField)).current
                    : await readPrivate(readArgs);
                const pendingAction=entry.expected?._nativeAction,serviceName='CustomerRequest[comments_service]';
                const pendingNotTaken=pendingAction?.key==='not_taken';
                const cancellationComments=['comments','comments_service','partner_comment'].map(short=>'CustomerRequest['+short+']');
                const pendingComments=pendingNotTaken?cancellationComments:cancellationComments.filter(name=>Object.hasOwn(entry.expected || {},name));
                const pendingExpectedNames=[...pendingComments,'_nativeAction',...(pendingNotTaken?['_nativeReasonPending']:[])];
                const pendingCommentProof=Object.fromEntries(pendingComments.map(name=>[name,entry.expected?.[name]]));
                if(entry.kind!=='create' && entry.nativeActionPhase==='pending' && ['cancel_kc','cancel_branch','not_taken'].includes(pendingAction?.key)
                    && Object.keys(entry.expected || {}).every(name=>pendingExpectedNames.includes(name))
                    && pendingComments.includes(serviceName) && pendingComments.every(name=>Object.hasOwn(entry.expected || {},name))
                    && current.record.status===pendingAction.beforeStatus && verify(current,pendingCommentProof).ok){
                    const command=current.record.actions.find(item=>item.key===pendingAction.key && item.enabled && (item.type==='submit' || pendingNotTaken && item.type==='link'));
                    if(command){
                        const body=serialize(current.form,{}, {param:current.document.csrfParam,token:current.document.csrfToken});
                        nativeSubmit(current.form,body,false);nativeCommand(current.form,body,command);
                        const target=new URL(command.type==='link'?command.url:current.form.action || current.record.url,BASES[entry.base]);
                        if(target.origin!==BASES[entry.base] || target.pathname!==PATH+(command.type==='link'?'cancel-to-not-taken':'update') || target.searchParams.get('id')!==str(entry.id))throw Error('Адрес смены статуса заявки изменился.');
                        await recordOperation(args.operationId,{nativeActionPhase:'sent',nativeCancellationVersion:2});
                        const method=command.type==='link'?command.method:'POST';
                        const response=await http(entry.base,target.href,{method,fullPage:true,...(method==='POST'?{body}:{})});
                        const prepared=await captureCancellation({...args,base:entry.base,id:entry.id},response,current);if(prepared)return prepared;
                        const refusal=await responseRejection(response);
                        if(refusal)return persistResult(args.operationId,reject(refusal,{id:entry.id,operationId:args.operationId}));
                        current=await readPrivate({base:entry.base,id:entry.id});
                    }
                }
                const wanted = str(entry.sourceCode || entry.expected?.[PARTNER_COMMENT]).trim();
                const hasSource = () => createdSourceMatches(current,entry);
                if (entry.kind === 'create' && wanted && !hasSource() && entry.commentsPhase === 'pending') {
                    // The second POST was not started. It can be dispatched once
                    // after exact ID + phone identity are rechecked.
                    if (linkedPhoneName(current,entry.phone)
                        && !(entry.beforeIds || []).includes(str(entry.id))) {
                        try { current = await completeCreatedPartnerComment({base:entry.base,operationId:args.operationId},str(entry.id),wanted,current); }
                        catch (_) { current = await readPrivate({base:entry.base,id:entry.id}); }
                    }
                }
                const verified = verify(current, entry.expected || {}, entry.expectedPrimaryPhoneField);
                // Versions before 1.18 sent ordinary edits through the AJAX
                // validation transport. Keep the real (unsaved) result, but
                // release that stale edit so a deliberate Save can send the
                // native form. Never do this for creation, status or claims.
                const oldAction=entry.expected?._nativeAction;
                // 1.18.1 sent the first native cancellation command but did
                // not understand the server's next reason page. Such an old
                // abandoned attempt can be released for a deliberate new
                // click only after the SAME unchanged active card is read.
                // New two-page operations and any submitted final reason are
                // explicitly excluded; this branch NEVER sends a POST.
                const legacyCancelV3=entry.transport==='native-form-v3' && !entry.nativeCancellationVersion
                    && !entry.cancellationForm && !entry.cancellationSelection && !entry.cancellation
                    && entry.nativeActionPhase==='sent' && ['cancel_kc','cancel_branch'].includes(oldAction?.key)
                    && current.record.status===oldAction.beforeStatus && !current.record.capabilities.readOnly
                    && current.record.actions.some(item=>item.key===oldAction.key && item.enabled)
                    && /(?:^|\n)\s*отмена\s+с\s+авито\s*(?:\n|$)/i.test(str(entry.expected?.[serviceName]))
                    && verify(current,{[serviceName]:entry.expected[serviceName]}).ok;
                const retryOldAction=entry.transport!=='native-form-v3' && !entry.claim && oldAction && (
                    ['cancel_kc','cancel_branch','not_taken'].includes(oldAction.key) && current.record.status===oldAction.beforeStatus
                    || oldAction.key==='create_claim' && !current.record.hasClaim);
                if(!verified.ok && (entry.transport!=='native-form-v3' || legacyCancelV3) && ['save','reschedule'].includes(entry.kind)
                    && (!oldAction || retryOldAction || legacyCancelV3) && !entry.claim && ['sent','uncertain'].includes(entry.state)
                    && !sharedInFlight.has(scope+':'+args.operationId)
                    && Date.now()-Number(entry.createdAt || 0)>120000) {
                    return persistResult(args.operationId,reject(retryOldAction || legacyCancelV3?'Прежнее действие не применено. Кнопки заявки снова доступны.':'Изменения не сохранены. Нажмите «Сохранить», чтобы отправить их повторно.',
                        {code:'edit_not_applied',retryable:true,writeStarted:true,id:entry.id,record:current.record,retryFields:entry.expected,retryReason:entry.rescheduleReason || '',verified,operationId:args.operationId}));
                }
                const confirmedIdentity = entry.kind === 'create' && !verified.diffs.some(item=>item.name==='_nativeAction') && /^\d+$/.test(str(entry.id)) && entry.phone.length === 10
                    && !(entry.beforeIds || []).map(str).includes(str(entry.id)) && !!linkedPhoneName(current,entry.phone);
                if(verified.ok&&entry.postEditIntent){const post=await completePostEdit({...args,base:entry.base,id:entry.id},current,entry);if(!post.ok)return persistResult(args.operationId,uncertain(post.error,{id:entry.id,record:post.current.record,operationId:args.operationId,primarySaved:true}));current=post.current;Object.assign(entry.expected,post.expected);}
                const result = verified.ok || confirmedIdentity
                    ? {ok:true,state:'saved',id:entry.id,url:current.record.url,record:current.record,
                        sourceCommitted:hasSource(), expectedSource:wanted,
                        verified:verified.ok ? verified : {...verified,ok:true,recordConfirmed:true,partial:true},
                        ...(!verified.ok ? {fieldDifferences:verified.diffs,notice:'Заявка найдена, но часть полей отличается. Проверьте их в карточке.'} : {}),
                        ...(entry.kind!=='create' && !entry.expected?._nativeAction && entry.rescheduleReason && (Object.hasOwn(entry.expected || {},N.date)||Object.hasOwn(entry.expected || {},N.time))?{visitChange:{...(entry.visitBefore || {}),...(typeof entry.visitBefore?.callCheckBefore==='boolean'?{callCheckAfter:callCheckState(current.record.form.values[CALL_CHECK])}:{}),date:isoDate(current.record.form.values[N.date]),time:normalizeValue(N.time,current.record.form.values[N.time]),reason:entry.rescheduleReason}}:{}),
                        ...(entry.callCheckChange && !entry.expected?._nativeAction && !entry.rescheduleReason?{callCheckChange:{...entry.callCheckChange,callCheckAfter:callCheckState(current.record.form.values[CALL_CHECK])}}:{}),
                        ...(entry.cancellation?{cancellation:entry.cancellation}:{}),
                        ...(entry.notTaken?{notTaken:entry.notTaken}:{}),
                        operationId:args.operationId}
                    : uncertain('Пока не все отправленные поля подтверждены в CRM.', { id: entry.id, url: current.record.url, record: current.record, verified, operationId: args.operationId });
                return await persistResult(args.operationId, result);
            } catch (error) { return uncertain(error.message, { operationId: args.operationId, ...(entry?.id ? {id:entry.id} : {}) }); }
            }, true);
        }
        return { prepare, dependencies, search, createRequest, readRequest, getAudioRecords, prepareClaim, saveClaim, prepareCancellation, saveCancellation, prepareNotTakenRequest, saveNotTakenRequest, saveRequest: args => update(args, false),
            reschedule: args => update(args, true), reconcile, draftToFields };
    }
    return { create, draftToFields, BASES, fieldNames: N, readVerifiedWithRetry, DEFAULT_VERIFY_DELAYS, _test: { isoDate, dateFor, normalizeValue, serialize, nativeSubmit } };
});
