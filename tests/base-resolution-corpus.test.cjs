'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../extension/leadpartner-rules.js');
const context = require('../extension/leadchat-request-context.js');

// Human-labelled phrases from the existing business categories, not generated from regex aliases.
// Empty base means insufficient/contradictory evidence: do not invent a category for a brand.
const services = [
  ['kp', 'Ремонт компьютеров с выездом'], ['kp', 'Компьютерная помощь на дому'],
  ['kp', 'Чистка ноутбука от пыли'], ['kp', 'Ремонт MacBook'], ['kp', 'Настройка Windows 11'],
  ['kp', 'Восстановление данных с жесткого диска'], ['kp', 'Установка драйверов'],
  ['kp', 'Заправка картриджей'], ['kp', 'Ремонт принтера HP'], ['kp', 'Настройка МФУ'],
  ['kp', 'Ремонт сканера'], ['kp', 'Ремонт системного блока'], ['kp', 'Замена термопасты'],
  ['kp', 'Ремонт телевизоров Samsung'], ['kp', 'Мастер по ремонту ТВ'], ['kp', 'Smart TV ремонт'],
  ['mnc', 'Сантехник на дом'], ['mnc', 'Замена смесителя'], ['mnc', 'Прочистка канализации'],
  ['mnc', 'Установка унитаза'], ['mnc', 'Замена сифона'], ['mnc', 'Электрик на дом'],
  ['mnc', 'Замена розетки'], ['mnc', 'Установка люстры'], ['mnc', 'Замена автоматического выключателя'],
  ['mnc', 'Сборка мебели'], ['mnc', 'Разборка шкафа'], ['mnc', 'Собрать кухню'],
  ['mnc', 'Навеска полок'], ['mnc', 'Установка карниза'], ['mnc', 'Замена дверной ручки'],
  ['bt', 'Ремонт стиральной машины Bosch'], ['bt', 'Ремонт стиралки'], ['bt', 'Ремонт посудомойки'],
  ['bt', 'Ремонт холодильника Samsung'], ['bt', 'Ремонт морозильной камеры'],
  ['bt', 'Ремонт кофемашины'], ['bt', 'Ремонт кофеварки'], ['bt', 'Ремонт духового шкафа'],
  ['bt', 'Установка варочной панели'], ['bt', 'Ремонт сушильного шкафа'],
  ['bt', 'Ремонт микроволновой печи'], ['bt', 'Ремонт пылесоса'], ['bt', 'Ремонт водонагревателя'],
  ['bt', 'Ремонт утюга'], ['bt', 'Ремонт блендера']
];
const negatives = [
  'Ремонт Samsung', 'Сервис LG', 'Philips Service', 'Electrolux', 'Электролюкс',
  'Оконный мастер', 'Мастер рядом', 'Ремонт на дому', 'Windowsill Service', 'TVS Service',
  'Компаньон сервис', 'Сантехносервис', 'РозеткаPRO', 'СМ новая модель', 'Поддержка клиента'
];
const ambiguities = [
  'Ремонт компьютеров и холодильников', 'Сантехника и ремонт стиральных машин',
  'Ремонт принтеров и сборка мебели', 'Электрик и ремонт ноутбуков',
  'Сборка мебели и ремонт кофемашин', 'Холодильники, компьютеры и электрика'
];
const explicitPrefixes = [
  ['КП', 'kp'], ['KP', 'kp'], ['КP', 'kp'], ['KП', 'kp'],
  ['БТ', 'bt'], ['BT', 'bt'], ['БT', 'bt'], ['BТ', 'bt'], ['ＢＴ', 'bt'],
  ['МНЧ', 'mnc'], ['MNC', 'mnc'], ['MНЧ', 'mnc'], ['МHЧ', 'mnc']
];
function raw(header, title) {
  return {conversationId:'offline-corpus',conversationUrl:'https://chat.partner-lead-centre.ru/chats/offline-corpus',
    operatorId:'offline-operator',client:{id:'offline-client',name:'Тест'},account:{id:'offline-account',title:header},
    item:{id:'offline-ad',title},messages:[]};
}

test('human-labelled common Avito service corpus follows established KP/MNC/BT categories', async t => {
  for (const [expected, title] of services) await t.test(title, () => {
    const result = rules.resolveBase({workTitle:title}, ['kp','mnc','bt']);
    assert.equal(result.base, expected); assert.equal(result.conflict, false); assert.equal(result.requiresManual, false);
  });
});

test('brand and partial-token negatives do not invent a base', async t => {
  for (const title of negatives) await t.test(title, () => {
    const result = rules.resolveBase({workTitle:title}, ['kp','mnc','bt']);
    assert.equal(result.base, ''); assert.equal(result.requiresManual, true);
  });
});

test('mixed non-TV service directions require a deliberate choice', async t => {
  for (const title of ambiguities) await t.test(title, () => {
    const result = rules.resolveBase({workTitle:title}, ['kp','mnc','bt']);
    assert.equal(result.base, ''); assert.equal(result.conflict, true); assert.equal(result.requiresManual, true);
  });
});

test('accepted explicit single-base prefix stays authoritative, including mixed Latin/Cyrillic spelling', async t => {
  for (const [prefix, expected] of explicitPrefixes) await t.test(prefix, () => {
    const header = prefix + ' · Общий канал', title = expected === 'kp' ? 'Замена смесителя' : 'Ремонт телевизора';
    const result = rules.resolveBase({profileFullTitle:header,workTitle:title}, ['kp','mnc','bt']);
    assert.equal(result.base, expected); assert.equal(result.reasonCode, 'explicit-prefix');
    const projected = context.derive(raw(header, title));
    assert.equal(projected.ok, true); assert.equal(projected.base, expected);
    assert.equal(projected.requiresBaseChoice, false);
  });
});

test('accepted TV special policy stays KP without a unique explicit prefix', async t => {
  for (const [header, title] of [
    ['КП / МНЧ / БТ · Общий канал', 'Ремонт телевизоров'],
    ['БТ / МНЧ · Общий канал', 'Ремонт телевизоров и холодильников'],
    ['Общий канал · Телевизоры', 'Ремонт холодильника'],
    ['', 'Настройка Smart TV']
  ]) await t.test(header + ' / ' + title, () => {
    const result = rules.resolveBase({profileFullTitle:header,workTitle:title}, ['kp','mnc','bt']);
    assert.equal(result.base, 'kp'); assert.equal(result.reasonCode, 'television');
  });
});

test('current concrete ad overrides broad non-TV account service wording', () => {
  const result = rules.resolveBase({profileFullTitle:'Общий сервис сантехники',workTitle:'Ремонт холодильника'}, ['kp','mnc','bt']);
  assert.equal(result.base, 'bt'); assert.equal(result.reasonCode, 'service');
});

test('account-title and work-title changes are re-derived from fresh native context', () => {
  const before = raw('БТ · Канал', 'Ремонт холодильника');
  const after = raw('МНЧ · Канал', 'Замена смесителя');
  assert.equal(context.derive(before).base, 'bt'); assert.equal(context.derive(after).base, 'mnc');
  assert.equal(context.derive(after).workTitle, after.item.title);
  assert.equal(context.derive(after).profileFullTitle, after.account.title);
});

test('compact, normalized and repeated header tags preserve native candidates and shared resolution', async t => {
  const cases = [
    ['КП/БТ · Общий канал', 'Ремонт холодильника', 'bt', ['kp','bt']],
    ['BT/MNC · Общий канал', 'Замена розетки', 'mnc', ['bt','mnc']],
    ['КП/МНЧ/БТ · Общий канал', 'Заправка картриджей', 'kp', ['kp','mnc','bt']],
    ['ＢＴ／ＭＮＣ · Общий канал', 'Ремонт кофеварки', 'bt', ['bt','mnc']],
    ['БТ/БТ · Общий канал', 'Ремонт телевизора', 'bt', ['bt']],
    ['БТ/МНЧ/БТ · Общий канал', 'Сборка мебели', 'mnc', ['bt','mnc']],
    ['Б\u200bТ/МНЧ · Общий канал', 'Ремонт стиральной машины', 'bt', ['bt','mnc']],
    ['М\u2060НЧ · Общий канал', 'Ремонт телевизора', 'mnc', ['mnc']],
    ['bt/mnc · Общий канал', 'Замена смесителя', 'mnc', ['bt','mnc']],
    ['БТ/МНЧ · Общий канал', 'Ремонт телевизора', 'kp', ['bt','mnc']],
    ['', 'Ремонт телевизора', 'kp', []],
    ['', 'Ремонт стиральной машины', 'bt', []]
  ];
  for (const [header, title, expected, candidates] of cases) await t.test(header + ' / ' + title, () => {
    const projected = context.derive(raw(header, title));
    const resolved = rules.resolveBase({profileFullTitle:header,workTitle:title}, candidates);
    assert.equal(resolved.base, expected);
    assert.deepEqual(projected.baseCandidates, candidates);
    assert.equal(projected.base, resolved.base); assert.equal(projected.requiresBaseChoice, false);
    assert.equal(projected.warnings.includes('Выберите базу заявки.'), false);
  });
});


test('unknown service without header tags keeps the manual-choice warning', () => {
  const projected = context.derive(raw('', 'Сервис Samsung'));
  assert.deepEqual(projected.baseCandidates, []);
  assert.equal(projected.base, ''); assert.equal(projected.requiresBaseChoice, true);
  assert.equal(projected.warnings.includes('Выберите базу заявки.'), true);
});

test('a bare header tag remains a hint rather than gaining explicit-prefix priority', async t => {
  for (const [header, title, expected, candidates, manual] of [
    ['БТ', 'Ремонт телевизора', 'kp', ['bt'], false],
    ['Мастер Иван БТ', 'Сантехник', 'mnc', ['bt'], false],
    ['BT', 'Осмотр', 'bt', ['bt'], false],
    ['БТ/МНЧ', 'Осмотр', '', ['bt','mnc'], true]
  ]) await t.test(header + ' / ' + title, () => {
    const info = context.profileInfo(header, title);
    assert.deepEqual(info.baseCandidates, candidates); assert.equal(info.base, expected);
    assert.equal(info.requiresBaseChoice, manual);
    assert.notEqual(rules.resolveBase({profileFullTitle:header,workTitle:title}, candidates).reasonCode, 'explicit-prefix');
  });
});

test('non-string native profile and item title values are ignored without coercion into routing evidence', () => {
  const deceptive = {toString() {return 'КП · Телевизоры';}};
  for (const value of [null, undefined, 42, {}, [], deceptive]) {
    const info = context.profileInfo(value, deceptive);
    assert.equal(info.profileTitle, ''); assert.equal(info.base, '');
    assert.deepEqual(info.baseCandidates, []); assert.equal(info.requiresBaseChoice, true);
  }
  assert.equal(context.profileInfo('БТ · Канал', deceptive).base, 'bt');
});

test('native page projection and isolated-world derivation use the fresh ad title without leaking extra fields', () => {
  const native = require('../extension/leadchat-request-context-main.js');
  const row = {id:'offline-corpus',client:{id:'offline-client',name:'Тест'},
    account:{id:'offline-account',title:'BT/MNC · Общий канал'},
    item:{id:123,title:'Ремонт холодильника',city_name:'Москва',private_metadata:'must not cross'}};
  const derive = () => context.derive({...native.projectConversation(row, row.id),
    conversationUrl:'https://chat.partner-lead-centre.ru/chats/offline-corpus',operatorId:'offline-operator'});
  assert.equal(derive().base, 'bt'); assert.deepEqual(derive().baseCandidates, ['bt','mnc']);
  assert.equal(derive().adId, '123'); assert.equal(derive().city, 'Москва');
  row.item.title = 'Замена смесителя';
  const changed = derive(); assert.equal(changed.base, 'mnc'); assert.equal(changed.workTitle, 'Замена смесителя');
  assert.equal(native.projectConversation(row, row.id).item.private_metadata, undefined);
});
