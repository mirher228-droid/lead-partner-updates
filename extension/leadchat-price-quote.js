(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadChatPriceQuote = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const text = value => typeof value === 'string' ? value : '';
  const NUMBER = '(?:\\d{1,2}(?:[ .\\u00a0\\u202f]\\d{3})|\\d{1,5})(?:[.,]\\d{1,2})?';
  const SCALE = '(?:тыс(?:яч(?:а|и|у)?)?\\.?|[кk])';
  const CURRENCY = '(?:₽|руб(?:л(?:ей|я|ь))?\\.?|р\\.?)';
  const END = '(?![\\p{L}\\p{N}]|[.,:/-]\\d|[ \\u00a0\\u202f]\\d{3})';
  const NON_MONETARY_RANGE = new RegExp('^\\s*(?:до|[–—-])\\s*' + NUMBER + '\\s*(?:лет|года?|час(?:а|ов)?|мин(?:ут[аыу]?)?|дн(?:я|ей)|км|метр(?:а|ов)?|миллиметр(?:а|ов)?|сантиметр(?:а|ов)?|м(?:\\.|²|2)?|см|мм)(?!\\p{L})','iu');
  const authorOf = message => text(message?.sender?.id) || text(message?.author?.id) || text(message?.authorId) || text(message?.author_id) || text(message?.sender_user_id) || text(message?.sender_id);
  function quoteInText(body) {
    const source = text(body).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
    const patterns = [
      new RegExp('(?:^|[^\\p{L}\\p{N}])(?<from>от)\\s*(?<amount>' + NUMBER + ')\\s*(?<scale>' + SCALE + ')?\\s*(?:' + CURRENCY + ')?' + END, 'giu'),
      new RegExp('(?:^|[^\\p{L}\\p{N}])(?:цена|цене|стоимость|стоимости|ремонт|работа|диагностика|выезд)\\s*(?::|—|–|-|составит|будет|стоит)?\\s*(?<from>от)?\\s*(?<amount>' + NUMBER + ')\\s*(?<scale>' + SCALE + ')?\\s*(?:' + CURRENCY + ')?' + END, 'giu'),
      new RegExp('(?:^|[^\\p{L}\\p{N}])(?<from>от\\s+)?(?<amount>' + NUMBER + ')\\s*(?<scale>' + SCALE + ')?\\s*' + CURRENCY + END, 'giu')
    ];
    const quotes = [];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
      const digits = match.groups.amount.replace(/[\s\u00a0\u202f]/g, '').replace(/^(\d{1,2})\.(\d{3})$/, '$1$2');
      const amount = Number(digits.replace(',', '.')) * (match.groups.scale ? 1000 : 1);
      if (!Number.isInteger(amount) || amount < 1 || amount > 30000) continue;
      const suffix = source.slice(match.index + match[0].length);
      // A number after «от» can also describe a date, time, age, address or distance.
      if (/^\s*(?:лет|года?|час(?:а|ов)?|мин(?:ут[аыу]?)?|дн(?:я|ей)|км|метр(?:а|ов)?|миллиметр(?:а|ов)?|сантиметр(?:а|ов)?|м(?:\.|²|2)?|см|мм|этаж|под[ъь]езд|дом|квартир|человек|штук|утра|вечера)(?!\p{L})/iu.test(suffix)) continue;
      if (NON_MONETARY_RANGE.test(suffix)) continue;
      const before = source.slice(Math.max(0, match.index - 24), match.index);
      if (/(?:дата|срок|возраст|этаж|адрес|телефон|номер|заявка)\s*:?\s*$/iu.test(before)) continue;
      quotes.push({amount, line: (match.groups.from ? 'от ' : '') + amount, index: match.index, end: match.index + match[0].length});
    }
    // Overlapping patterns describe the same quote. Prefer its complete «от» form.
    quotes.sort((a, b) => a.end - b.end || b.index - a.index || a.line.length - b.line.length);
    const last = quotes[quotes.length - 1];
    return last ? {amount: last.amount, line: last.line} : null;
  }
  function operatorMessage(message, context) {
    if (!message || !['out', 'outgoing'].includes(message.direction) || !['', 'operator', 'user', 'employee', 'manager'].includes(message.senderType || message.sender_type || '') || message.isInternal || message.is_internal) return false;
    const author = authorOf(message);
    const operator = text(context?.operatorId || context?.scope?.operatorId);
    // Outgoing is the operator side of a shared conversation, not proof that
    // the current employee authored it. LeadChat identifies authors by sender.id.
    return !!author && !!operator && author === operator;
  }
  function latestQuote(context) {
    const messages = (Array.isArray(context?.messages) ? context.messages : []).slice(-500)
      .map((message, index) => ({message, index, at: Date.parse(message.createdAt || message.created_at) || 0}))
      .sort((a, b) => a.at - b.at || a.index - b.index);
    let last = null;
    for (const {message} of messages) {
      if (!operatorMessage(message, context)) continue;
      const quote = quoteInText(message.body);
      if (quote) last = {...quote, messageId: text(message.id), createdAt: text(message.createdAt || message.created_at), key: JSON.stringify([message.id || '', message.createdAt || message.created_at || '', quote.line])};
    }
    return last;
  }
  function applyQuote(draft, context) {
    let current = draft, previous = draft.autoQuotedPrice;
    const history = Array.isArray(context?.messages) ? context.messages : [];
    const source = previous?.messageId && history.findLast(message => text(message?.id) === previous.messageId);
    if (source && !operatorMessage(source, context)) {
      const author = authorOf(source), operator = text(context?.operatorId || context?.scope?.operatorId);
      const disproven = ['in', 'incoming', 'note', 'system'].includes(source.direction)
        || ['client', 'customer', 'bot', 'system'].includes(source.senderType || source.sender_type)
        || source.isInternal === true || source.is_internal === true
        || !!author && !!operator && author !== operator;
      // An absent message or missing author is not contrary evidence. Remove
      // only the exact generated line once the same message is proven foreign.
      if (disproven) {
        const lines = text(draft.comments).split(/\r?\n/);
        const index = lines.findLastIndex(line => line === previous.line);
        if (index >= 0) lines.splice(index, 1);
        current = {...draft, comments: lines.join('\n')};
        delete current.autoQuotedPrice;
        previous = undefined;
      }
    }
    const quote = latestQuote(context);
    if (!quote || previous?.key === quote.key) return current;
    let lines = text(current.comments).split(/\r?\n/);
    if (previous?.line) {
      const index = lines.findLastIndex(line => line.trim() === previous.line);
      if (index >= 0) lines.splice(index, 1);
    }
    if (!lines.some(line => line.trim() === quote.line)) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(quote.line);
    }
    return {...current, comments: lines.join('\n'), autoQuotedPrice: quote};
  }
  return {quoteInText, operatorMessage, latestQuote, applyQuote};
});
