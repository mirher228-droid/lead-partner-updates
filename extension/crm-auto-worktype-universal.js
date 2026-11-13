// ==== Единый автовыбор вида работ и услуги: КП / МНЧ / БТ, create + update ====
(function () {
    'use strict';

    // В hostname нет https://. Проверяем протокол и точное имя базы отдельно.
    if (location.protocol !== 'https:' || !/^(kp|mnc|bt)-lead-centre\.ru$/i.test(location.hostname)) return;
    if (!/^\/admin\/domain\/customer-request\/(create|update)\/?$/.test(location.pathname)) return;
    if (window.__CRM_AUTO_WORKTYPE_UNIVERSAL_INIT__) return;
    window.__CRM_AUTO_WORKTYPE_UNIVERSAL_INIT__ = true;

    function log(...args) {
        try {
            if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-WORKTYPE-UNIVERSAL]', ...args);
        } catch (_) { /* В некоторых режимах браузера localStorage недоступен. */ }
    }

    const FIELD_COMMENT = '#customerrequest-comments, textarea[name="CustomerRequest[comments]"]';
    const FIELD_WORK = '#customerrequest-appliance_type_id, select[name="CustomerRequest[appliance_type_id]"]';
    const FIELD_SUB = '#customerrequest-appliance_sub_type_id, select[name="CustomerRequest[appliance_sub_type_id]"]';

    // Составные фразы имеют приоритет над «сборка», «собрать» и другими общими словами.
    // «Подключить бойлер» относится к сантехнике (576), а не к электрике (705).
    const COMPOUND_RULES = [
        { phrases: ['подключить сушильную машину', 'подключить водонагреватель', 'подключить бойлер', 'подключить см', 'подключить пм'], workValue: '458', subValue: '576' },
        { phrases: ['пластиковые трубы', 'трубы пластиковые'], workValue: '458', subValue: '544' },
        { phrases: ['кран на кухне', 'кран в туалете', 'кран в ванной'], workValue: '458', subValue: '545' },
        { phrases: ['уст кухню', 'собрать кухню', 'сборка кухни', 'установить кухню'], workValue: '554', subValue: '578' },
        { phrases: ['уст карниз', 'уст шторы', 'уст гардину'], workValue: '459', subValue: '550' },
        { phrases: ['ручка окна'], workValue: '459', subValue: '692' }
    ];

    // Полный справочник из промта. Варианты старого МНЧ (полки, жалюзи) сохранены.
    // «Прочая» и одиночный «-» намеренно не выбираются автоматически.
    const RULES = [
        { keys: ['дезинфекция', 'травля'], workValue: '579', subValue: '580' },
        { keys: ['кондеры', 'кондиционеры', 'кондиционер'], workValue: '665' },
        { keys: ['турник', 'турника'], workValue: '459', subValue: '551' },
        { keys: ['сушилка', 'сушилки'], workValue: '459', subValue: '552' },
        { keys: ['замок', 'замка'], workValue: '459', subValue: '689' },
        { keys: ['окно'], workValue: '459', subValue: '692' },
        { keys: ['навес', 'повесить', 'повешать', 'шторы', 'кронштейн', 'кронштейны', 'ковёр', 'ковры', 'гардину', 'гардина', 'гардины', 'вешалки', 'вешалка', 'часы', 'крючки', 'картины', 'зеркало', 'карниз', 'карнизы', 'полка', 'полку', 'полки', 'вешалку', 'жалюзи', 'штора'], workValue: '459', subValue: '550' },
        { keys: ['плинтус', 'плинтуса', 'плинтусы'], workValue: '577', subValue: '558' },
        { keys: ['ламинат', 'ламинаты', 'линолеум', 'линолеумы'], workValue: '577', subValue: '557' },
        { keys: ['смеситель', 'смесители', 'сифон', 'сифоны'], workValue: '458', subValue: '539' },
        { keys: ['полотенцосушитель', 'полотенцосушители', 'полотенсушитель', 'полотенсушители', 'полотенцесушитель', 'полотенцесушители'], workValue: '458', subValue: '540' },
        { keys: ['раковина', 'раковины', 'мойка', 'мойки'], workValue: '458', subValue: '541' },
        { keys: ['ванна', 'ванной', 'ванны', 'душевая', 'душевые', 'кабинка', 'кабина', 'кабины', 'кабинки'], workValue: '458', subValue: '542' },
        { keys: ['унитаз', 'унитазы', 'инсталляция', 'инсталляции', 'инсаталяция', 'инстоляция', 'инстоляции'], workValue: '458', subValue: '543' },
        { keys: ['засор', 'засоры'], workValue: '458', subValue: '701' },
        { keys: ['тв', 'телевизор'], workValue: '703', subValue: '704' },
        { keys: ['ремонт', 'регулировка', 'сломалась', 'сломалось', 'сборка', 'собрать'], workValue: '554', subValue: '556' },
        { keys: ['розетка', 'розетки', 'розетку', 'розеток', 'розетке', 'выключатель', 'выключатели'], workValue: '457', subValue: '546' },
        { keys: ['люстра', 'люстры', 'светильник', 'светильники', 'бра'], workValue: '457', subValue: '547' },
        { keys: ['автомат', 'автоматы', 'кабеля', 'кабель', 'проводка', 'провод', 'провода'], workValue: '457', subValue: '548' },
        { keys: ['лампочка', 'лампочки', 'лампа', 'лампы'], workValue: '457', subValue: '549' },
        // Дополнительно: все бытовые услуги из «виды.txt».
        { keys: ['бойлер', 'бойлеры', 'водонагреватель', 'водонагреватели'], workValue: '565', subValue: '655' },
        { keys: ['вытяжка', 'вытяжки', 'вытяжку'], workValue: '565', subValue: '656' },
        { keys: ['духовка', 'духовки', 'духовку', 'духовой', 'электроплита', 'электроплиты'], workValue: '565', subValue: '657' },
        { keys: ['кофемашина', 'кофемашины'], workValue: '565', subValue: '658' },
        { keys: ['посудомоечная', 'посудомоечную', 'посудомоечной', 'посудомойка', 'посудомойку', 'пм', 'пмм'], workValue: '565', subValue: '660' },
        { keys: ['стиральная', 'стиральную', 'стиральной', 'стиралка', 'стиралку', 'см', 'сушильная', 'сушильную', 'сушильной'], workValue: '565', subValue: '661' },
        { keys: ['холодильник', 'холодильники', 'морозилка', 'морозилки'], workValue: '565', subValue: '662' }
    ];

    // В старом КП другой справочник. Его проверенные правила сохранены как резерв:
    // только для КП, только если нужная опция действительно существует в форме.
    // Это не отдельный слушатель и не второй механизм, который переписывает результат.
    const LEGACY_KP_RULES = [
        { keys: ['тв', 'телевизор', 'телик', 'tv', 'жк', 'плазма', 'кинескоп'], workValue: '259' },
        { keys: ['ноутбук', 'ноут', 'пк', 'компьютер', 'комп', 'винду', 'винда', 'виндовс', 'виндоус', 'windows', 'ос', 'моноблок', 'программа', 'програму', 'программу', 'макбук', 'macbook', 'imac', 'аймак', 'мак', 'mac'], workValue: '257' },
        { keys: ['принтер', 'мфу'], workValue: '258' },
        { keys: ['роутер', 'роутар', 'router'], workValue: '262' },
        { keys: ['монитор', 'видеокарта', 'видик'], workValue: '261' },
        { keys: ['ps', 'ps3', 'ps4', 'ps5', 'пс', 'пс3', 'пс4', 'пс5', 'xbox', 'иксбокс', 'nintendo', 'нинтендо', 'стимдек', 'steamdeck'], workValue: '264' },
        { keys: ['восстановление', 'восстановить', 'вд'], workValue: '263' },
        { keys: ['обжать', 'обжим'], workValue: '437' },
        { keys: ['тлф', 'айфон', 'iphone', 'айпад', 'ipad', 'телефон', 'планшет', 'смартфон'], workValue: '260' }
    ];

    function normalizeWord(word) {
        return String(word || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:]+$/g, '');
    }

    function normalizeComment(text) {
        // Существующий partner-autofill добавляет эту служебную строку перед заявкой.
        // Ссылки партнёров и сам комментарий не изменяем, убираем пометку только для поиска.
        return String(text || '').replace(/^\s*🔴БЕЛАЯ ЗАЯВКА🔴\s*/i, '')
            .replace(/(?:\r?\nhttps?:\/\/\S+[ \t]*)+\s*$/i, '')
            .trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    }

    function matchesWord(rule, word) {
        // Короткие коды должны быть отдельными словами: «см» не равно «сможете»,
        // «бра» не равно «обратно»/«брать». Длинные ключи допускают окончания.
        return rule.keys.some(key => {
            const normalized = normalizeWord(key);
            return word === normalized || (normalized.length > 3 && word.startsWith(normalized));
        });
    }

    function getCommentWords(text) {
        // Ищем по словам во всём сообщении, включая многострочную вставку с Авито.
        // Адреса ссылок не являются описанием работ; поле комментария не меняем.
        const source = normalizeComment(text).replace(/https?:\/\/\S+/gi, ' ');
        return source.match(/[\p{L}\p{N}]+/gu) || [];
    }

    function findRule(text) {
        const words = getCommentWords(text);
        if (!words.length) return null;
        const compounds = COMPOUND_RULES.flatMap(rule => rule.phrases.map(phrase => ({ rule, words: getCommentWords(phrase) })))
            .sort((a, b) => b.words.length - a.words.length);
        // Специфичные фразы имеют приоритет над одиночными словами в любой части текста.
        // При нескольких фразах выбираем первую по позиции, самую длинную в этой позиции.
        for (let index = 0; index < words.length; index++) {
            for (const candidate of compounds) {
                if (candidate.words.every((word, offset) => words[index + offset] === word)) return candidate.rule;
            }
        }
        let furnitureFallback = null;
        for (const word of words) {
            const rule = RULES.find(item => matchesWord(item, word));
            if (!rule) continue;
            // «Ремонт/сломалась» из переписки не должны затмевать конкретную технику:
            // «Здравствуйте, сломалась стиральная машина» — бытовая техника, не мебель.
            if (rule.workValue === '554' && rule.subValue === '556') {
                furnitureFallback = furnitureFallback || rule;
                continue;
            }
            return rule;
        }
        return furnitureFallback;
    }

    function findOptionByValue(select, value) {
        return select && Array.from(select.options).find(option => String(option.value) === String(value) && !option.disabled);
    }

    function findOptionByText(select, textPart) {
        const needle = normalizeWord(textPart);
        return select && needle && Array.from(select.options).find(option => option.value && !option.disabled && normalizeWord(option.textContent).includes(needle));
    }

    let dispatching = 0;
    let currentComment = null;
    let currentWork = null;
    let lastComment = null;
    let allowOverride = false;
    let retryNeeded = false;
    let commentTimer = null;
    let serviceTimer = null;
    let revision = 0;
    let autoWork = false;
    let autoWorkValue = '';
    let autoSub = false;
    let resetGuard = null;
    const boundComments = new WeakSet();
    const boundSelects = new WeakSet();

    function cancelServiceWait() {
        revision++;
        clearInterval(serviceTimer);
        serviceTimer = null;
    }

    function setSelect(select, value, changeFnName) {
        if (!select || select.disabled || !findOptionByValue(select, value)) return false;
        if (String(select.value) === String(value)) return true;
        dispatching++;
        try {
            select.value = String(value);
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.classList.remove('is-invalid');
            select.setAttribute('aria-invalid', 'false');
            // Реальные селекты имеют onchange="changeApplianceTypeHint(this)".
            // change уже вызвал этот обработчик: повторно запускать AJAX нельзя.
            const inlineCallsHint = changeFnName && typeof select.onchange === 'function'
                && String(select.getAttribute('onchange') || '').includes(changeFnName);
            if (changeFnName && !inlineCallsHint && typeof window[changeFnName] === 'function') {
                try { window[changeFnName](select); } catch (error) { log('Ошибка подсказки CRM:', error); }
            }
            return true;
        } finally { dispatching--; }
    }

    function resolveRule(text, work) {
        const rule = findRule(text);
        if (rule && findOptionByValue(work, rule.workValue)) return rule;
        if (location.hostname === 'kp-lead-centre.ru') {
            for (const word of getCommentWords(text)) {
                const legacy = LEGACY_KP_RULES.find(item => matchesWord(item, word) && findOptionByValue(work, item.workValue));
                if (legacy) return legacy;
            }
        }
        if (location.hostname === 'bt-lead-centre.ru') {
            // В БТ каждая бытовая техника — отдельный вид работ, а не группа 565.
            const appliance = rule && rule.workValue === '565' ? rule
                : getCommentWords(text).map(word => RULES.find(item => item.workValue === '565' && matchesWord(item, word))).find(Boolean);
            const btValues = { '655': '441', '656': '316', '657': '315', '658': '313', '660': '312', '661': '311', '662': '310' };
            const value = appliance ? btValues[appliance.subValue]
                : rule && ({ '703': '318', '665': '436' })[rule.workValue];
            if (value && findOptionByValue(work, value)) {
                const words = getCommentWords(text);
                const subText = words.some(word => word.startsWith('подключ')) ? 'подключение'
                    : words.some(word => word.startsWith('настро')) ? 'настройка' : 'ремонт';
                return { workValue: value, subText, exactSubText: true };
            }
        }
        return rule;
    }

    function clearAutomatic(signature) {
        const clearWork = autoWork;
        const clearSub = autoSub || clearWork;
        if (!clearWork && !clearSub) return;
        resetGuard = { signature, comment: currentComment, clearWork, clearSub };
        autoWork = autoSub = false;
        const token = revision;
        let attempts = 0;
        const clear = () => {
            if (token !== revision || normalizeComment(currentComment && currentComment.value) !== signature) return;
            if (clearWork) setSelect(currentWork, '', 'changeApplianceTypeHint');
            if (clearSub) setSelect(document.querySelector(FIELD_SUB), '', 'changeApplianceSubTypeHint');
        };
        clear();
        // Ответ AJAX от прежнего выбора может прийти уже после удаления ключа.
        serviceTimer = setInterval(() => {
            clear();
            if (++attempts >= 20 || token !== revision) cancelServiceWait();
        }, 250);
    }

    function waitForService(rule, signature, override) {
        if (!rule.subValue && !rule.subText) return;
        const token = revision;
        let attempts = 0;
        let serviceOwnedByAuto = false;
        serviceTimer = setInterval(() => {
            attempts++;
            const work = document.querySelector(FIELD_WORK);
            const comment = document.querySelector(FIELD_COMMENT);
            if (token !== revision || comment !== currentComment || work !== currentWork
                || normalizeComment(comment && comment.value) !== signature || String(work && work.value) !== rule.workValue) {
                cancelServiceWait();
                return;
            }
            const sub = document.querySelector(FIELD_SUB);
            bindSelect(sub);
            if (sub && !sub.disabled) {
                const option = (rule.subValue && findOptionByValue(sub, rule.subValue))
                    || (rule.subText && (rule.exactSubText
                        ? Array.from(sub.options).find(item => item.value && !item.disabled && normalizeWord(item.textContent) === rule.subText)
                        : findOptionByText(sub, rule.subText)));
                if (option) {
                    if (sub.value && sub.value !== option.value && !override && !serviceOwnedByAuto) {
                        log('Сохраняем выбранную пользователем услугу:', sub.value);
                        cancelServiceWait();
                        return;
                    }
                    const changed = sub.value !== option.value;
                    if (setSelect(sub, option.value, 'changeApplianceSubTypeHint')) {
                        serviceOwnedByAuto = true;
                        if (changed || override || autoWork) autoSub = true;
                    }
                    if (changed) log('Услуга установлена:', option.value);
                }
            }
            // Ещё проверяем до 5 секунд: поздний ответ старого AJAX может заменить опции.
            // Ручной выбор сразу останавливает этот таймер; повторных change для того же value нет.
            if (attempts >= 20) {
                log('Ожидание услуг завершено:', rule.subValue || rule.subText);
                cancelServiceWait();
            }
        }, 250);
    }

    function processComment() {
        if (window.__CRM_CREATE_TRANSFER_APPLYING__) { retryNeeded = true; return; }
        const comment = document.querySelector(FIELD_COMMENT);
        const work = document.querySelector(FIELD_WORK);
        if (!comment || !work) return;
        const signature = normalizeComment(comment.value);
        const changed = lastComment !== null && signature !== lastComment;
        if (signature === lastComment && !retryNeeded) return;
        if (signature !== lastComment) {
            allowOverride = changed;
            cancelServiceWait();
        }
        lastComment = signature;
        retryNeeded = false;
        const rule = resolveRule(comment.value, work);
        if (!rule) { clearAutomatic(signature); return; }
        if (work.disabled || !findOptionByValue(work, rule.workValue)) {
            if (changed) clearAutomatic(signature);
            retryNeeded = true;
            log('Ожидаем вид работ в справочнике:', rule.workValue);
            return;
        }
        if (work.value && work.value !== rule.workValue && !allowOverride && !autoWork) {
            log('Сохраняем выбранный пользователем вид работ:', work.value);
            return;
        }
        resetGuard = null;
        cancelServiceWait();
        const changedWork = work.value !== rule.workValue;
        if (!setSelect(work, rule.workValue, 'changeApplianceTypeHint')) return;
        if (changedWork || allowOverride) autoWork = true;
        if (autoWork) autoWorkValue = rule.workValue;
        log('Вид работ установлен:', rule.workValue);
        waitForService(rule, signature, allowOverride);
    }

    function scheduleComment(delay) {
        const comment = document.querySelector(FIELD_COMMENT);
        if (comment && normalizeComment(comment.value) !== lastComment) { resetGuard = null; cancelServiceWait(); }
        clearTimeout(commentTimer);
        commentTimer = setTimeout(processComment, delay);
    }

    function bindSelect(select) {
        if (!select || boundSelects.has(select)) return;
        boundSelects.add(select);
        const handleManual = event => {
            if (dispatching || window.__CRM_CREATE_TRANSFER_APPLYING__
                || (!select.value && !event.isTrusted && !(event.originalEvent && event.originalEvent.isTrusted))) return;
            if (select === currentWork) autoWork = autoSub = false;
            else autoSub = false;
            resetGuard = null;
            // Любой внешний выбор, включая Select2, уважает ручной ввод.
            cancelServiceWait();
            clearTimeout(commentTimer);
            const comment = document.querySelector(FIELD_COMMENT);
            lastComment = normalizeComment(comment && comment.value);
            allowOverride = false;
            retryNeeded = false;
        };
        select.addEventListener('input', handleManual);
        select.addEventListener('change', handleManual);
        if (typeof window.jQuery === 'function') {
            window.jQuery(select).on('change.crmAutoWorktypeUniversal', handleManual);
        }
    }

    function ensureFields() {
        const comment = document.querySelector(FIELD_COMMENT);
        const work = document.querySelector(FIELD_WORK);
        if (!comment || !work) return;
        if (comment !== currentComment || work !== currentWork) {
            cancelServiceWait();
            clearTimeout(commentTimer);
            currentComment = comment;
            currentWork = work;
            lastComment = null;
            retryNeeded = true;
            allowOverride = false;
            autoWork = autoSub = false;
            autoWorkValue = '';
            resetGuard = null;
        }
        bindSelect(work);
        bindSelect(document.querySelector(FIELD_SUB));
        if (resetGuard && resetGuard.comment === comment && normalizeComment(comment.value) === resetGuard.signature) {
            // Даже очень поздняя замена опций не должна вернуть выбор после удаления ключа.
            if (resetGuard.clearWork) setSelect(work, '', 'changeApplianceTypeHint');
            if (resetGuard.clearSub) setSelect(document.querySelector(FIELD_SUB), '', 'changeApplianceSubTypeHint');
        }
        if (!boundComments.has(comment)) {
            boundComments.add(comment);
            ['input', 'change', 'blur', 'paste'].forEach(type => comment.addEventListener(type, () => scheduleComment(type === 'blur' ? 0 : 250)));
            log('Слушатели установлены');
        }
        if (autoWork && work.value !== autoWorkValue && !window.__CRM_CREATE_TRANSFER_APPLYING__) retryNeeded = true;
        if (retryNeeded) scheduleComment(0);
    }

    function init() {
        document.addEventListener('crm-create-transfer-applied', () => { retryNeeded = true; ensureFields(); scheduleComment(0); });
        ensureFields();
        const fields = [FIELD_COMMENT, FIELD_WORK, FIELD_SUB].join(', ');
        const containsField = node => node.nodeType === 1 && (node.matches(fields) || node.querySelector(fields));
        const observer = new MutationObserver(records => {
            const relevant = records.some(record => {
                // Option updates belong to their select even when the option has no id.
                if (record.target.closest?.(fields)) return true;
                if (record.type === 'attributes') return containsField(record.target);
                // Fields may arrive or disappear inside a replaced form/container.
                return [...record.addedNodes, ...record.removedNodes].some(containsField);
            });
            if (relevant) ensureFields();
        });
        const observerOptions = { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] };
        observer.observe(document.documentElement, observerOptions);
        window.addEventListener('pagehide', () => {
            cancelServiceWait();
            clearTimeout(commentTimer);
            observer.disconnect();
        });
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            observer.observe(document.documentElement, observerOptions);
            ensureFields();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
