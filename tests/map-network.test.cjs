'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../extension/leadchat-map-search.js');
const routes = require('../extension/leadchat-map-route.js');

// Native config-view JSON only: the real production parsers and network orchestration run.
const origin = [91.442396, 53.721152];
const destination = [91.7, 53.7];
const locality = {
  provider: 'yandex', source: 'native-address-components', title: 'Тестовый посёлок', country: 'Россия',
  regionId: '1095', hierarchy: ['225', '1095'],
  components: [{kind: 'country', name: 'Россия'}, {kind: 'province', name: 'Республика Хакасия'}, {kind: 'locality', name: 'Тестовый посёлок'}]
};
const input = {base: 'kp', city: 'Абакан', cityId: '208', destinationLocality: locality};
const script = config => '<script id="config-view" type="application/json">' + JSON.stringify(config) + '</script>';
function cityItem(title = 'Тестовск', id = '111', coordinates = origin) {
  return {id, type: 'toponym', kind: 'locality', title, coordinates, uri: 'ymapsbm1://geo?data=offline_' + id,
    compositeAddress: {country: 'Россия', province: 'Республика Хакасия', locality: title}, region: {id: '1095', hierarchy: ['225', '1095']}};
}
function mapPage(base = 'kp', item = cityItem()) {
  const constructor = 'constructor:' + maps.CONSTRUCTORS[base];
  return script({query: {um: constructor}, userMap: {id: constructor, features: [], lastUpdated: 'offline-fixture'}, searchPreloadedResults: {items: [item]}});
}
function routeConfig() {
  return {query: {mode: 'routes', rtt: 'auto', rtext: [origin, destination].map(p => p[1] + ',' + p[0]).join('~')},
    routePoints: [origin, destination].map(coords => ({coords: coords.slice()})),
    routerResponse: {type: 'auto', waypoints: [origin, destination].map((p, index) => ({index, request: p.slice(), coordinates: p.slice()})),
      viaIndexes: [], viaPoints: [], routes: [{type: 'auto', uuid: 'offline-shortest', distance: {value: 36900, text: '36,9 км'}, duration: 1800}]}};
}
function response(url, html, overrides = {}) { return {ok: true, url, text: async () => html, ...overrides}; }
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 100; i++) {if (check()) return; await flush();} assert.fail('Expected deferred network operation to begin'); }
function deferredFetch(t, html = mapPage()) {
  const calls = [];
  const fetch = (url, options) => new Promise(resolve => calls.push({url, options, reply: (body = html) => resolve(response(url, body))}));
  t.after(() => {for (const call of calls) call.reply();});
  return {calls, fetch};
}
function routeNetwork(t, {deferred = false, fail = []} = {}) {
  const calls = [], routeCalls = [];
  const fetch = async (url, options) => {
    const request = {url, options}; calls.push(request);
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://yandex.ru');
    assert.equal(parsed.pathname, '/map-widget/v1/');
    if (parsed.searchParams.get('mode') !== 'routes') {
      const item = parsed.searchParams.get('text').includes(locality.title) ? cityItem(locality.title, '222', destination) : cityItem('Абакан');
      return response(url, mapPage('kp', item));
    }
    routeCalls.push(request);
    assert.equal(parsed.searchParams.get('rtt'), 'auto');
    assert.equal(parsed.searchParams.get('rtext'), routeConfig().query.rtext);
    const result = fail.shift();
    if (result === 'http') return response(url, '', {ok: false});
    if (result === 'body') return response(url, '', {text: async () => {throw Error('Synthetic truncated body');}});
    if (result === 'captcha') return response(url, '<form class="checkbox-captcha-form"></form>');
    if (deferred) return new Promise(resolve => {request.reply = (html = script(routeConfig())) => resolve(response(url, html));});
    return response(url, script(routeConfig()));
  };
  t.after(() => {for (const call of routeCalls) call.reply?.();});
  return {calls, routeCalls, fetch};
}

test('native map fixture is parsed independently with exact base and city identity', () => {
  const parsed = maps.parseMapPage(mapPage(), 'kp');
  assert.equal(parsed.items[0].id, '111');
  assert.deepEqual(parsed.items[0].coordinates, origin);
  assert.equal(parsed.lastUpdated, 'offline-fixture');
  assert.throws(() => maps.parseMapPage(mapPage('bt'), 'kp'), /другой базы/);
  assert.throws(() => maps.parseMapPage('<form class="checkbox-captcha-form"></form>', 'kp'), /проверку/);
});

test('map page cache expires at five minutes and separates base identities', async () => {
  let time = 1000, calls = 0;
  const search = maps.create({now: () => time, fetch: async (url) => {calls++; const base = new URL(url).searchParams.get('um') === 'constructor:' + maps.CONSTRUCTORS.bt ? 'bt' : 'kp'; return response(url, mapPage(base));}});
  const first = await search.inspectCity({base: 'kp', city: 'Тестовск'});
  assert.equal(first.cityIdentities[0].id, '111');
  time += 299999; await search.inspectCity({base: 'kp', city: 'Тестовск'}); assert.equal(calls, 1);
  time++; await search.inspectCity({base: 'kp', city: 'Тестовск'}); assert.equal(calls, 2);
  await search.inspectCity({base: 'bt', city: 'Тестовск'}); assert.equal(calls, 3);
});

test('map callers share a fetch; cancelling one preserves the other consumer', async t => {
  const network = deferredFetch(t), search = maps.create({fetch: network.fetch}), abort = new AbortController();
  const first = search.inspectCity({base: 'kp', city: 'Тестовск', signal: abort.signal});
  const second = search.inspectCity({base: 'kp', city: 'Тестовск'});
  await until(() => network.calls.length === 1);
  const rejected = assert.rejects(first, {name: 'AbortError'}); abort.abort(); await rejected;
  assert.equal(network.calls[0].options.signal.aborted, false);
  network.calls[0].reply(); assert.equal((await second).cityIdentities[0].id, '111');
  assert.equal(network.calls.length, 1);
});

test('last map consumer aborts fetch; an old late response cannot remove or overwrite the replacement', async t => {
  const network = deferredFetch(t), search = maps.create({fetch: network.fetch}), abort = new AbortController();
  const first = search.inspectCity({base: 'kp', city: 'Тестовск', signal: abort.signal});
  await until(() => network.calls.length === 1);
  const rejected = assert.rejects(first, {name: 'AbortError'}); abort.abort(); await rejected;
  assert.equal(network.calls[0].options.signal.aborted, true);
  const replacement = search.inspectCity({base: 'kp', city: 'Тестовск'});
  await until(() => network.calls.length === 2);
  network.calls[0].reply(mapPage('kp', cityItem('Тестовск', '999'))); await flush();
  const sharedReplacement = search.inspectCity({base: 'kp', city: 'Тестовск'}); await flush(); assert.equal(network.calls.length, 2);
  network.calls[1].reply(mapPage('kp', cityItem('Тестовск', '222')));
  assert.equal((await replacement).cityIdentities[0].id, '222');
  assert.equal((await sharedReplacement).cityIdentities[0].id, '222');
  assert.equal((await search.inspectCity({base: 'kp', city: 'Тестовск'})).cityIdentities[0].id, '222');
  assert.equal(network.calls.length, 2);
});

for (const failure of ['http', 'body', 'captcha', 'foreign-redirect']) test('map ' + failure + ' failure is not cached as a successful page', async () => {
  let calls = 0;
  const search = maps.create({fetch: async url => {
    calls++; if (calls > 1) return response(url, mapPage());
    if (failure === 'http') return response(url, '', {ok: false});
    if (failure === 'body') return response(url, '', {text: async () => {throw Error('Synthetic body failure');}});
    if (failure === 'captcha') return response(url, '<a href="/showcaptcha?offline">Verify</a>');
    return response('https://example.invalid/map-widget/v1/', mapPage());
  }});
  await assert.rejects(search.inspectCity({base: 'kp', city: 'Тестовск'}));
  assert.equal((await search.inspectCity({base: 'kp', city: 'Тестовск'})).ok, true);
  assert.equal(calls, 2);
});

test('already aborted map caller starts no fetch', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  const search = maps.create({fetch: async () => {calls++; throw Error('Must not request');}});
  await assert.rejects(search.inspectCity({base: 'kp', city: 'Тестовск', signal: abort.signal}), {name: 'AbortError'});
  assert.equal(calls, 0);
});

test('driving parser selects shortest unblocked automobile alternative and preserves its own label', () => {
  const config = routeConfig();
  config.routerResponse.routes.push({type: 'auto', uuid: 'blocked', flags: {blocked: true}, distance: {value: 1000, text: '1 км'}},
    {type: 'pedestrian', uuid: 'walk', distance: {value: 2000, text: '2 км'}}, {type: 'auto', uuid: 'longer', distance: {value: 42000, text: '42 км'}});
  const parsed = routes.parseRoutePage(script(config), {origin, destination});
  assert.equal(parsed.ok, true); assert.equal(parsed.distanceMeters, 36900); assert.equal(parsed.distanceText, '36,9 км');
  assert.equal(parsed.classification, 'near'); assert.equal(parsed.proof.selectedRouteId, 'offline-shortest');
  assert.equal(parsed.proof.selection, 'minimum-distance-of-returned-driving-alternatives');
  assert.equal(parsed.proof.query.rtt, 'auto'); assert.equal(parsed.direction, 'from-city');
});

for (const [label, raw, displayed, classification] of [['36,9 км', 36949, 36900, 'near'], ['37 км', 36960, 37000, 'far'], ['37\u00a0км', 37001, 37000, 'far'], ['36 999 м', 36999, 36999, 'near']]) {
  test('37 km decision follows native selected-route label ' + label, () => {
    const config = routeConfig(); config.routerResponse.routes[0].distance = {value: raw, text: label};
    const parsed = routes.parseRoutePage(script(config), {origin, destination});
    assert.equal(parsed.ok, true); assert.equal(parsed.distanceMeters, raw); assert.equal(parsed.distanceText, label);
    assert.equal(parsed.displayDistanceMeters, displayed); assert.equal(parsed.classification, classification);
  });
}
const invalidProofs = [
  ['transit mode', c => {c.query.rtt = 'mt';}, 'unproven-route-mode-or-direction'],
  ['reverse direction', c => {c.query.rtext = [destination, origin].map(p => p[1] + ',' + p[0]).join('~');}, 'unproven-route-mode-or-direction'],
  ['wrong requested point', c => {c.routePoints[1].coords = origin;}, 'unproven-route-points'],
  ['wrong returned waypoint', c => {c.routerResponse.waypoints[1].coordinates = origin;}, 'unproven-response-endpoints'],
  ['via point', c => {c.routerResponse.viaPoints = [origin];}, 'unexpected-via-points'],
  ['negative distance', c => {c.routerResponse.routes[0].distance.value = -1;}, 'invalid-route-distance'],
  ['missing native distance label', c => {c.routerResponse.routes[0].distance.text = '<b>36,9 км</b>';}, 'unproven-route-distance-label']
];
for (const [name, modify, reason] of invalidProofs) test('route parser refuses ' + name, () => {
  const config = routeConfig(); modify(config);
  const parsed = routes.parseRoutePage(script(config), {origin, destination}); assert.equal(parsed.ok, false); assert.equal(parsed.reason, reason);
});
test('route captcha and duplicate config are unavailable rather than a guessed distance', () => {
  assert.equal(routes.parseRoutePage('<form class="checkbox-captcha-form"></form>', {origin, destination}).reason, 'yandex-verification-required');
  assert.equal(routes.parseRoutePage(script(routeConfig()) + script(routeConfig()), {origin, destination}).reason, 'route-data-unavailable');
});

test('route cache uses actual parsed locality identity, returns copies, and expires after five minutes', async t => {
  let time = 1000; const network = routeNetwork(t), router = routes.create({fetch: network.fetch, now: () => time});
  const first = await router.route(input); assert.equal(first.ok, true); assert.equal(first.originCity.id, '111'); assert.equal(first.destinationLocality.id, '222');
  first.originCity.id = 'mutated'; first.proof.waypoints[0].coordinates[0] = 0;
  time += 299999; const cached = await router.route(input); assert.equal(network.routeCalls.length, 1); assert.equal(cached.originCity.id, '111'); assert.deepEqual(cached.proof.waypoints[0].coordinates, origin);
  time++; assert.equal((await router.route(input)).ok, true); assert.equal(network.routeCalls.length, 2);
  assert.equal(network.calls.every(c => c.options.credentials === 'omit' && c.options.cache === 'no-store'), true);
});

test('route sharing keeps the public request alive until the final consumer cancels', async t => {
  const network = routeNetwork(t, {deferred: true}), router = routes.create({fetch: network.fetch}), firstAbort = new AbortController(), lastAbort = new AbortController();
  const first = router.route({...input, signal: firstAbort.signal}), last = router.route({...input, signal: lastAbort.signal});
  await until(() => network.routeCalls.length === 1);
  const rejectedFirst = assert.rejects(first, {name: 'AbortError'}); firstAbort.abort(); await rejectedFirst;
  assert.equal(network.routeCalls[0].options.signal.aborted, false);
  const rejectedLast = assert.rejects(last, {name: 'AbortError'}); lastAbort.abort(); await rejectedLast;
  assert.equal(network.routeCalls[0].options.signal.aborted, true);
  network.routeCalls[0].reply();
});

test('abandoned route response cannot cache over or detach a newer same-key request', async t => {
  const network = routeNetwork(t, {deferred: true}), router = routes.create({fetch: network.fetch}), abort = new AbortController();
  const old = router.route({...input, signal: abort.signal}); await until(() => network.routeCalls.length === 1);
  const rejected = assert.rejects(old, {name: 'AbortError'}); abort.abort(); await rejected;
  const fresh = router.route(input); await until(() => network.routeCalls.length === 2);
  const stale = routeConfig(); stale.routerResponse.routes[0].distance = {value: 99000, text: '99 км'};
  network.routeCalls[0].reply(script(stale)); await flush();
  const shared = router.route(input); await flush(); assert.equal(network.routeCalls.length, 2);
  network.routeCalls[1].reply(); assert.equal((await fresh).distanceMeters, 36900); assert.equal((await shared).distanceMeters, 36900);
  assert.equal((await router.route(input)).distanceMeters, 36900); assert.equal(network.routeCalls.length, 2);
});
for (const failure of ['http', 'body', 'captcha']) test('route ' + failure + ' is not cached as known mileage', async t => {
  const network = routeNetwork(t, {fail: [failure]}), router = routes.create({fetch: network.fetch});
  const first = await router.route(input); assert.equal(first.ok, false); assert.equal(first.state, 'unavailable');
  assert.equal(first.reason, {http: 'route-http-unavailable', body: 'route-fetch-unavailable', captcha: 'yandex-verification-required'}[failure]);
  const second = await router.route(input); assert.equal(second.ok, true); assert.equal(network.routeCalls.length, 2);
});

test('ineligible branch and unproven locality do not issue route network requests', async () => {
  let calls = 0; const router = routes.create({fetch: async () => {calls++; throw Error('No request expected');}});
  assert.equal((await router.route({...input, base: 'bt'})).reason, 'ineligible-branch');
  assert.equal((await router.route({...input, destinationLocality: {...locality, source: 'untrusted'}})).reason, 'unproven-address-locality');
  assert.equal(calls, 0);
});


test('route timeout is bounded and a following request can recover without a cached failure', {timeout: 1000}, async t => {
  const network = routeNetwork(t, {deferred: true}), router = routes.create({fetch: network.fetch, timeoutMs: 10});
  const timedOut = await router.route(input);
  assert.equal(timedOut.ok, false); assert.equal(timedOut.reason, 'route-timeout');
  assert.equal(network.routeCalls[0].options.signal.aborted, true);
  const next = router.route(input); await until(() => network.routeCalls.length === 2);
  network.routeCalls[1].reply(); assert.equal((await next).ok, true);
});

test('already aborted route caller starts no city or route fetch', async () => {
  let calls = 0; const abort = new AbortController(); abort.abort();
  const router = routes.create({fetch: async () => {calls++; throw Error('No request expected');}});
  await assert.rejects(router.route({...input, signal: abort.signal}), {name: 'AbortError'});
  assert.equal(calls, 0);
});
