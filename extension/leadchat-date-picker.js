/* Compact local-date calendar. It changes the form value only; no network or CRM writes. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadChatDatePicker = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const WEEKDAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let sequence = 0;
  function localDate(year, month, day) {
    const date = new Date(0);
    date.setFullYear(year, month, day);
    date.setHours(12, 0, 0, 0);
    return date;
  }
  function isoDate(date) {
    return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match || Number(match[1]) < 1) return null;
    const date = localDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isoDate(date) === match[0] ? date : null;
  }
  function monthDays(year, month) {
    const first = localDate(year, month, 1), start = 1 - ((first.getDay() + 6) % 7);
    return Array.from({length:42}, (_, index) => {
      const date = localDate(year, month, start + index);
      return {value:isoDate(date),day:date.getDate(),month:date.getMonth(),year:date.getFullYear(),outside:date.getMonth() !== first.getMonth()};
    });
  }
  function create(options) {
    const config = options || {}, input = config.input;
    const doc = config.document || input && input.ownerDocument;
    if (!doc || !input) throw new TypeError('Date picker requires a document and input');
    const win = doc.defaultView;
    const anchor = config.anchor || input.closest('.visit-date') || input;
    const popup = doc.createElement('div');
    const popupId = 'lp-date-picker-' + (++sequence);
    popup.id = popupId;
    popup.className = 'lp-date-picker';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Выберите дату визита');
    popup.hidden = true;
    const header = doc.createElement('div');
    header.className = 'lp-date-picker-header';
    const previous = doc.createElement('button'), next = doc.createElement('button'), title = doc.createElement('span');
    previous.type = next.type = 'button';
    previous.className = next.className = 'lp-date-picker-nav';
    previous.textContent = '«'; next.textContent = '»';
    previous.setAttribute('aria-label', 'Предыдущий месяц');
    next.setAttribute('aria-label', 'Следующий месяц');
    title.className = 'lp-date-picker-title'; title.id = popupId + '-title';
    title.setAttribute('aria-live', 'polite');
    header.append(previous, title, next);
    const weekdays = doc.createElement('div');
    weekdays.className = 'lp-date-picker-weekdays';
    weekdays.setAttribute('aria-hidden', 'true');
    WEEKDAYS.forEach(label => {const day = doc.createElement('span'); day.textContent = label; weekdays.append(day);});
    const grid = doc.createElement('div');
    grid.className = 'lp-date-picker-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-labelledby', title.id);
    popup.append(header, weekdays, grid);
    doc.body.append(popup);
    const old = {hasPopup:input.getAttribute('aria-haspopup'),expanded:input.getAttribute('aria-expanded'),controls:input.getAttribute('aria-controls')};
    input.classList.add('lp-date-picker-input');
    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', popupId);
    let opened = false, destroyed = false, shown = localDate(new Date().getFullYear(), new Date().getMonth(), 1), focusedValue = '';
    const blocked = () => input.disabled || input.matches(':disabled') || input.readOnly || anchor.hidden || !!anchor.closest('[hidden]');
    const inRange = value => !!parseDate(value) && (!parseDate(input.min) || value >= input.min) && (!parseDate(input.max) || value <= input.max);
    function bounded(date) {
      const value = isoDate(date);
      if (parseDate(input.min) && value < input.min) return parseDate(input.min);
      if (parseDate(input.max) && value > input.max) return parseDate(input.max);
      return date;
    }
    function position() {
      if (!opened) return;
      const bounds = anchor.getBoundingClientRect(), box = popup.getBoundingClientRect();
      const width = win.innerWidth || doc.documentElement.clientWidth, height = win.innerHeight || doc.documentElement.clientHeight;
      const left = Math.max(4, Math.min(bounds.left, width - box.width - 4));
      const below = bounds.bottom + 5;
      const top = below + box.height <= height - 4 ? below : Math.max(4, bounds.top - box.height - 5);
      popup.style.left = left + 'px'; popup.style.top = top + 'px';
    }
    function render(moveFocus) {
      title.textContent = MONTHS[shown.getMonth()] + ' ' + shown.getFullYear();
      const days = monthDays(shown.getFullYear(), shown.getMonth());
      const validFocus = days.find(day => day.value === focusedValue && inRange(day.value));
      if (!validFocus) focusedValue = (days.find(day => !day.outside && inRange(day.value)) || days[0]).value;
      grid.replaceChildren();
      for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
        const row = doc.createElement('div'); row.className = 'lp-date-picker-week'; row.setAttribute('role', 'row');
        for (const day of days.slice(rowIndex * 7, rowIndex * 7 + 7)) {
          const cell = doc.createElement('button'); cell.type = 'button'; cell.className = 'lp-date-picker-day';
          cell.setAttribute('role', 'gridcell'); cell.dataset.date = day.value; cell.textContent = String(day.day);
          cell.setAttribute('aria-label', day.day + ' ' + MONTHS[day.month].toLocaleLowerCase('ru') + ' ' + day.year);
          cell.setAttribute('aria-selected', String(day.value === input.value));
          cell.classList.toggle('is-outside', day.outside);
          cell.classList.toggle('is-selected', day.value === input.value);
          cell.disabled = !inRange(day.value);
          cell.tabIndex = day.value === focusedValue && !cell.disabled ? 0 : -1;
          row.append(cell);
        }
        grid.append(row);
      }
      previous.disabled = shown.getFullYear() <= 1 && shown.getMonth() === 0 || !!parseDate(input.min) && isoDate(localDate(shown.getFullYear(), shown.getMonth(), 0)) < input.min;
      next.disabled = shown.getFullYear() >= 9999 && shown.getMonth() === 11 || !!parseDate(input.max) && isoDate(localDate(shown.getFullYear(), shown.getMonth() + 1, 1)) > input.max;
      if (moveFocus) grid.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
      position();
    }
    function close(restoreFocus) {
      if (!opened) return;
      opened = false; popup.hidden = true; input.setAttribute('aria-expanded', 'false');
      if (restoreFocus && !input.disabled) input.focus({preventScroll:true});
    }
    function open() {
      if (destroyed || blocked()) return false;
      const initial = bounded(parseDate(input.value) || localDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
      focusedValue = isoDate(initial); shown = localDate(initial.getFullYear(), initial.getMonth(), 1);
      opened = true; popup.hidden = false; input.setAttribute('aria-expanded', 'true');
      render(true); return true;
    }
    function toggle() {if (opened) close(true); else open();}
    function shiftMonth(amount) {
      if (blocked()) return close(false);
      if (amount < 0 && previous.disabled || amount > 0 && next.disabled) return;
      const target = parseDate(focusedValue) || shown;
      shown = localDate(shown.getFullYear(), shown.getMonth() + amount, 1);
      const last = localDate(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
      focusedValue = isoDate(bounded(localDate(shown.getFullYear(), shown.getMonth(), Math.min(target.getDate(), last))));
      render(true);
    }
    function select(value) {
      if (blocked() || !parseDate(value) || !inRange(value)) return close(false);
      const changed = input.value !== value;
      input.value = value; close(false); input.blur();
      if (changed) {
        input.dispatchEvent(new win.Event('input', {bubbles:true}));
        input.dispatchEvent(new win.Event('change', {bubbles:true}));
        if (typeof config.onChange === 'function') config.onChange(value);
      }
    }
    function anchorPointer(event) {
      if (event.button !== 0 || blocked()) return;
      event.preventDefault();
    }
    function anchorClick(event) {
      if (blocked()) return;
      event.preventDefault(); toggle();
    }
    function anchorKey(event) {
      if (blocked()) return;
      if (['Enter',' ','ArrowDown','F4'].includes(event.key)) {event.preventDefault(); open();}
      else if (event.key === 'Escape' && opened) {event.preventDefault(); close(true);}
    }
    function popupKey(event) {
      if (blocked()) return close(false);
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(true); return;}
      if (event.key === 'Tab') {close(false); return;}
      const button = event.target.closest('[data-date]');
      if (!button) return;
      const date = parseDate(button.dataset.date);
      const offsets = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      let target;
      if (Object.prototype.hasOwnProperty.call(offsets, event.key)) target = localDate(date.getFullYear(), date.getMonth(), date.getDate() + offsets[event.key]);
      else if (event.key === 'Home') target = localDate(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7);
      else if (event.key === 'End') target = localDate(date.getFullYear(), date.getMonth(), date.getDate() + 6 - (date.getDay() + 6) % 7);
      else if (event.key === 'PageUp' || event.key === 'PageDown') {event.preventDefault(); shiftMonth(event.key === 'PageUp' ? -1 : 1); return;}
      if (!target) return;
      event.preventDefault(); target = bounded(target); focusedValue = isoDate(target);
      shown = localDate(target.getFullYear(), target.getMonth(), 1); render(true);
    }
    function popupClick(event) {
      const button = event.target.closest('[data-date]');
      if (button && !button.disabled) select(button.dataset.date);
    }
    function outside(event) {if (opened && !popup.contains(event.target) && !anchor.contains(event.target)) close(false);}
    function refresh() {if (opened && blocked()) close(false); else if (opened) render(false);}
    const onPrevious = () => shiftMonth(-1), onNext = () => shiftMonth(1);
    anchor.addEventListener('pointerdown', anchorPointer, true);
    anchor.addEventListener('mousedown', anchorPointer, true);
    anchor.addEventListener('click', anchorClick, true);
    anchor.addEventListener('keydown', anchorKey, true);
    popup.addEventListener('keydown', popupKey);
    popup.addEventListener('click', popupClick);
    previous.addEventListener('click', onPrevious); next.addEventListener('click', onNext);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('scroll', position, true);
    win.addEventListener('resize', position);
    input.addEventListener('change', refresh);
    const observer = new win.MutationObserver(refresh);
    observer.observe(input, {attributes:true,attributeFilter:['disabled','readonly','min','max']});
    function destroy() {
      close(false); destroyed = true; observer.disconnect();
      anchor.removeEventListener('pointerdown', anchorPointer, true); anchor.removeEventListener('mousedown', anchorPointer, true);
      anchor.removeEventListener('click', anchorClick, true); anchor.removeEventListener('keydown', anchorKey, true);
      popup.removeEventListener('keydown', popupKey); popup.removeEventListener('click', popupClick);
      previous.removeEventListener('click', onPrevious); next.removeEventListener('click', onNext);
      doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('scroll', position, true);
      win.removeEventListener('resize', position); input.removeEventListener('change', refresh);
      popup.remove(); input.classList.remove('lp-date-picker-input');
      for (const [name,value] of [['aria-haspopup',old.hasPopup],['aria-expanded',old.expanded],['aria-controls',old.controls]]) {
        if (value === null) input.removeAttribute(name); else input.setAttribute(name,value);
      }
    }
    return {open,close:() => close(true),toggle,refresh,destroy,isOpen:() => opened};
  }
  return {create,parseDate,isoDate,monthDays};
});
