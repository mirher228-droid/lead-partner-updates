/* Shared, deterministic rules. No remote code or customer data leaves the browser. */
(function(root,factory){'use strict';const api=factory();root.LeadPartnerRules=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const text=v=>String(v??'').normalize('NFKC').replace(/ё/gi,'е').replace(/\s+/g,' ').trim();
  const SERVICE_FIELDS=['workTitle','adTitle','serviceTitle','profileFullTitle','profileTitle','profileName','profileComment'];
  const BASE_LABELS={kp:'КП',mnc:'МНЧ',bt:'БТ'};
  const serviceText=value=>text(value).toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069]/gu,'').replace(/[-‐‑‒–—_]+/gu,' ').replace(/\s+/gu,' ').trim();
  const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function serviceRule(base,category,forms,patterns=[]){
    const aliases=forms.split('|').map(serviceText).filter(Boolean);
    // Exact word boundaries and deliberate inflections prevent brand/name fuzzing:
    // электролюкс is not электрик; windowокон is not Windows; см is not a washer.
    const alternatives=aliases.sort((a,b)=>b.length-a.length).map(value=>escapePattern(value).replace(/ /g,'\\s+')).concat(patterns);
    return {base,category,aliases,pattern:new RegExp('(?<![\\p{L}\\p{N}])(?:'+alternatives.join('|')+')(?![\\p{L}\\p{N}])','iu')};
  }
  const TELEVISION=serviceRule('kp','Телевизоры',
    'телевизор|телевизоры|телевизора|телевизоров|телевизору|телевизоре|телевизором|телевизар|телевезор|телик|телека|телики|тв|tv|smart tv|смарт тв|televizor|televizory|televisor|television|tv repair|television repair|ремонт тв|телевизионный мастер',
    ['телевизор[а-я]*','телевизионн[а-я]*\\s+(?:мастер|ремонт|техник)[а-я]*']);
  const SERVICE_RULES=[
    TELEVISION,
    serviceRule('kp','Компьютеры',
      'компьютер|компьютеры|компьютера|компьютеров|компьютерный мастер|компьютерная помощь|компьютерщик|компютер|компютеры|компьтер|компуктер|компутер|комп|компа|компы|пк|pc|computer|computers|personal computer|desktop pc|desktop computer|computer repair|kompyuter|kompiuter|komputer|kompyutery|системный блок|системного блока|системник|системника|системные блоки|моноблок|моноблоки|моноблока|моноблоков|monoblock|monoblok|all in one pc|аймак|imac|макбук|macbook|mac book',
      ['компьютер[а-я]*','компютер[а-я]*','моноблок[а-я]*','системн[а-я]*\\s+блок[а-я]*']),
    serviceRule('kp','Ноутбуки',
      'ноутбук|ноутбуки|ноутбука|ноутбуков|ноутбуке|ноутбуку|ноутбукa|ноут|ноута|ноуты|нотбук|нотбуки|нотыбук|ноотбук|ноутбок|ноутбку|ноубук|ноутбуг|нетбук|ультрабук|нетбука|ультрабуки|ноутбучный|laptop|laptops|notebook|notebooks|netbook|ultrabook|nout|noutbuk|noutbuki|noutbook|noutbooks|nootbook|nootbooks|noutbuc|noutbuк|лаптоп|лэптоп',
      ['ноутбук[а-я]*','нотбук[а-я]*','нетбук[а-я]*','ультрабук[а-я]*']),
    serviceRule('kp','Windows и программы',
      'windows|windows 7|windows 8|windows 10|windows 11|винда|винды|винду|винде|виндой|виндос|виндосе|виндус|виндовс|виндовз|виндоус|виндоуз|виндоусе|vindovs|vindous|vindows|vinda|windos|windous|windows reinstall|переустановка винды|переустановка windows|установка windows|операционная система|переустановка системы|установка драйверов|настройка драйверов|программное обеспечение|установка программ|установка антивируса|удаление вирусов|удалить вирус|чистка от вирусов|настройка bios|прошивка bios|настройка uefi|установка linux|установка macos|восстановление данных|восстановление файлов|computer setup|software installation|virus removal'),
    serviceRule('kp','Комплектующие компьютера',
      'материнская плата|материнской платы|материнку|материнка|видеокарта|видеокарты|видеокарту|видеокарте|видео карта|оперативная память|оперативной памяти|оперативку|жесткий диск|жесткого диска|жестком диске|жесткие диски|жесткийдиск|твердотельный накопитель|ssd|hdd|hard drive|graphics card|motherboard|computer motherboard|процессор компьютера|компьютерный процессор|замена термопасты|чистка ноутбука от пыли|апгрейд компьютера|апгрейд пк|сборка пк|разборка пк'),
    serviceRule('kp','Принтеры и МФУ',
      'принтер|принтеры|принтера|принтеров|принтеру|принтере|принтером|принтерный|принтерный мастер|принтэр|принтерр|printer|printers|printer repair|printеr|printer setup|мфу|mfu|многофункциональное устройство|многофункционального устройства|многофункциональные устройства|сканер|сканера|сканеров|сканеры|scanner repair|копир|ксерокс|ксерокса|копировальный аппарат|оргтехника|орг техники|оргтехники|плоттер|плоттера',
      ['принтер[а-я]*','сканер[а-я]*','плоттер[а-я]*']),
    serviceRule('kp','Картриджи и тонер',
      'картридж|картриджи|картриджа|картриджей|картриджу|картриджем|картриджы|катридж|катриджи|картриж|картрижд|картриджд|картриджей|cartridge|cartridges|kartridzh|kartridj|kartridg|kartridzhi|тонер|тонера|тонером|toner|заправка картриджа|заправить картридж|восстановление картриджей|заправка принтера|заправка мфу|заправить тонер|тонер картридж',
      ['картридж[а-я]*','катридж[а-я]*','тонер[а-я]*']),
    serviceRule('mnc','Электрика',
      'электрик|электрика|электрики|электрику|электриков|электриком|электрике|электромонтаж|электромонтажник|электромонтажные работы|электромонтажные услуги|электропроводка|электропроводки|электропроводку|электропровод|проводка|проводки|проводку|электрощит|электрощиток|электрический щит|электрический щиток|сборка щитка|распределительный щит|замена автомата|установка автомата|замена автоматов|подключение автомата|автоматический выключатель|дифавтомат|диффавтомат|узо|реле напряжения|electrician|electrical repair|electrical wiring|elektrik|elektrika|electrik|elektromontazh',
      ['электрик[а-я]*','электромонтаж[а-я]*','электропровод[а-я]*','электрощит[а-я]*','дифавтомат[а-я]*','(?:замен[а-я]*|установ[а-я]*|подключ[а-я]*)\\s+(?:электрическ[а-я]*\\s+)?автомат[а-я]*']),
    serviceRule('mnc','Розетки и освещение',
      'розетка|розетки|розетку|розеток|розетке|разетка|выключатель|выключатели|выключателя|выключателей|выключателю|выключателе|люстра|люстры|люстру|люстр|светильник|светильники|светильника|светильников|освещение|подключение освещения|монтаж освещения|светодиодная лента|электрический патрон|распаечная коробка|rozetka|rozetki|lyustra|light fixture|socket replacement|light switch',
      ['розетк[а-я]*','выключател[а-я]*','люстр[а-я]*','светильник[а-я]*']),
    serviceRule('mnc','Сантехника',
      'сантехник|сантехника|сантехники|сантехнику|сантехников|сантехником|сантехнек|сантехнические работы|сантехнические услуги|водопровод|водоснабжение|канализация|канализации|канализацию|прочистка труб|замена труб|разводка труб|устранение засора|устранение засоров|прочистка засора|прочистка канализации|трубы водоснабжения|ремонт водопровода|порыв трубы|протечка трубы|plumber|plumbing|santehnik|santekhnik|santechnik|santehnika|smesitel|унитаз|унитаза|унитазы|унитазов|сливной бачок|сливного бачка|инсталляция унитаза|смеситель|смесители|смесителя|смесителей|смиситель|сифон|сифона|сифоны|раковина|раковины|раковину|рукомойник|мойка на кухне|кухонная мойка|кран течет|течет кран|ремонт крана|замена крана|замена кранов|шаровый кран|полотенцесушитель|полотенцесушителя|душевая кабина|душевой кабины|душевой поддон|подключение душа|установка ванны|ремонт ванны|замена ванны|монтаж ванны|faucet repair|toilet repair|drain cleaning',
      ['сантехник[а-я]*','сантехнич[а-я]*','водопровод[а-я]*','канализац[а-я]*','смесител[а-я]*','сифон[а-я]*','унитаз[а-я]*','раковин[а-я]*','полотенцесушител[а-я]*','душев[а-я]*\\s+(?:кабин[а-я]*|поддон[а-я]*)']),
    serviceRule('mnc','Мебель',
      'мебель|мебели|мебельщик|мебельщики|мебельщика|мебельный мастер|мебельная фурнитура|сборщик мебели|сборщики мебели|сборка мебели|разборка мебели|сборка мебельной стенки|мебельная петля|мебельной петли|ремонт мебельной петли|mebel|mebeli|sborka mebeli|razborka mebeli|furniture assembly|furniture disassembly|furniture repair|wardrobe assembly|bed assembly|kitchen assembly',
      ['мебель[а-я]*','(?:сборк[а-я]*|разборк[а-я]*|собрат[а-я]*|разобрат[а-я]*|собер[а-я]*|разбер[а-я]*|демонтаж[а-я]*)\\s+(?:(?!(?:духов|сушильн)[а-я]*(?:\\s|$))[а-я]+\\s+){0,3}(?:шкаф[а-я]*|кухн[а-я]*|кроват[а-я]*|диван[а-я]*|стеллаж[а-я]*|комод[а-я]*|стол[а-я]*|тумб[а-я]*|прихож[а-я]*|гардероб[а-я]*|кресл[а-я]*|табурет[а-я]*|стенк[а-я]*)']),
    serviceRule('mnc','Навеска и мелкий ремонт',
      'повесить полку|повесить полки|навесить полку|навесить полочки|навеска полок|навеска шкафов|повесить шкаф|монтаж карниза|установка карниза|повесить карниз|карнизы|повесить зеркало|навеска зеркала|повесить картину|крепление кронштейна|установка кронштейна|монтаж кронштейна|установка жалюзи|монтаж жалюзи|монтаж плинтуса|установка плинтуса|замена плинтуса|ремонт дверной ручки|замена дверной ручки|замена замка|установка замка|установка доводчика|ремонт доводчика|мелкий ремонт по дому|мелкие работы по дому|мелкие бытовые работы|мелкий бытовой ремонт|мелкие ремонтные работы|домашний мастер|мастер универсал|мастер на час|муж на час|мастер на дом на час|муж начас|мастер начас|master na chas|muzh na chas|muz na chas|handyman|home handyman',
      ['(?:повес[а-я]*|навес[а-я]*|подвес[а-я]*)\\s+(?:[а-я]+\\s+){0,2}(?:полк[а-я]*|полоч[а-я]*|шкаф[а-я]*|зеркал[а-я]*|картин[а-я]*|карниз[а-я]*)','(?:монтаж|установк[а-я]*|замен[а-я]*)\\s+(?:карниз[а-я]*|плинтус[а-я]*|жалюзи|кронштейн[а-я]*|замк[а-я]*|доводчик[а-я]*)']),
    serviceRule('bt','Стиральные машины',
      'стиральная машина|стиральной машины|стиральные машины|стиральных машин|стиральную машину|стиральная машинка|стиральной машинки|стиральные машинки|стиралка|стиралки|стиралку|стиралок|стиралке|стералка|стералки|стиральна машина|стиральная машына|машинка автомат|washing machine|washing machines|washer repair|washer dryer|stiralka|stiralki|stiralnaya mashina|stiralnaja mashina',
      ['стиралк[а-я]*','стиральн[а-я]*\\s+машин[а-я]*']),
    serviceRule('bt','Посудомоечные машины',
      'посудомоечная машина|посудомоечной машины|посудомоечные машины|посудомоечных машин|посудомоечную машину|посудомойка|посудомойки|посудомойку|посудомоек|посудомоичная машина|посудомоющая машина|посудосушильная машина|пмм|dishwasher|dishwashers|dish washer|posudomoyka|posudomoika|posudomoechnaya mashina',
      ['посудомой[а-я]*','посудомоечн[а-я]*(?:\\s+машин[а-я]*)?','посудомоичн[а-я]*\\s+машин[а-я]*']),
    serviceRule('bt','Холодильники и морозильники',
      'холодильник|холодильники|холодильника|холодильников|холодильнику|холодильнике|холодильником|холодилник|холодилники|халадильник|холодос|холодоса|холодосы|холодильное оборудование|холодильная камера|морозилка|морозилки|морозилку|морозильник|морозильника|морозильники|морозильная камера|морозильной камеры|морозильные камеры|морозильный ларь|refrigerator|refrigerators|fridge|fridges|freezer|freezers|holodilnik|kholodilnik|holodilniki|morozilka|morozilnik|холодильник no frost',
      ['холодильник[а-я]*','холодилник[а-я]*','морозил(?:к|ьник)[а-я]*','морозильн[а-я]*\\s+(?:камер[а-я]*|лар[а-я]*)']),
    serviceRule('bt','Кофемашины и кофеварки',
      'кофемашина|кофемашины|кофемашину|кофемашин|кофемашинке|кофемашинка|кофе машина|кофе машины|кофе машину|кофеварка|кофеварки|кофеварку|кофемолка|кофемолки|кофемолку|кофемошина|кофемошины|coffee machine|coffee machines|coffee maker|coffee makers|espresso machine|espresso maker|coffee grinder|kofemashina|kofemashiny|kofevarka|kofemolka',
      ['кофемашин[а-я]*','кофевар[а-я]*','кофемол[а-я]*','кофе\\s+машин[а-я]*']),
    serviceRule('bt','Плиты и духовки',
      'варочная панель|варочной панели|варочные панели|варочная поверхность|варочной поверхности|варочные поверхности|индукционная плита|индукционной плиты|индукционная панель|электроплита|электроплиты|электроплиту|электрическая плита|газовая плита|газовой плиты|кухонная плита|кухонной плиты|ремонт плиты|ремонт плит|подключение плиты|установка плиты|духовка|духовки|духовку|духовок|духовой шкаф|духового шкафа|духовые шкафы|духовой шкафчик|cooker|cooker repair|cooking hob|hob repair|oven|oven repair|induction hob|electric stove|gas stove|dukhovka|duhovka|varochnaya panel',
      ['варочн[а-я]*\\s+(?:панел[а-я]*|поверхност[а-я]*)','электроплит[а-я]*','духовк[а-я]*','духов[а-я]*\\s+шкаф[а-я]*','(?:газов[а-я]*|электрическ[а-я]*|кухонн[а-я]*|индукционн[а-я]*)\\s+плит[а-я]*']),
    serviceRule('bt','Сушильные машины',
      'сушильная машина|сушильной машины|сушильные машины|сушильных машин|сушильную машину|сушильный автомат|сушильного автомата|сушильный шкаф|сушильного шкафа|сушилка для белья|tumble dryer|clothes dryer|dryer repair|sushilnaya mashina|sushilnaja mashina',
      ['сушильн[а-я]*\\s+(?:машин[а-я]*|автомат[а-я]*|шкаф[а-я]*)']),
    serviceRule('bt','Другая бытовая техника',
      'микроволновка|микроволновки|микроволновку|микроволновая печь|микроволновой печи|свч|microwave|mikrovolnovka|бойлер|бойлера|бойлеры|boiler repair|водонагреватель|водонагревателя|водонагреватели|water heater|пылесос|пылесоса|пылесосы|робот пылесос|vacuum cleaner|robot vacuum|кухонная вытяжка|кухонной вытяжки|ремонт вытяжки|ремонт вытяжек|ремонт утюга|утюг|утюга|парогенератор|парогенератора|отпариватель|отпаривателя|мультиварка|мультиварки|мясорубка|мясорубки|блендер|блендера|кухонный комбайн|кухонного комбайна|электрочайник|электрочайника|тостер|тостера|фритюрница|фритюрницы|соковыжималка|соковыжималки',
      ['микроволнов[а-я]*','бойлер[а-я]*','водонагревател[а-я]*','пылесос[а-я]*','парогенератор[а-я]*','отпаривател[а-я]*','мультиварк[а-я]*','мясорубк[а-я]*','блендер[а-я]*'])
  ];
  function serviceMatches(context,fields,rules=SERVICE_RULES){
    const matches=[];
    for(const field of fields){const value=serviceText(context?.[field]);if(!value)continue;
      for(const rule of rules){const match=rule.pattern.exec(value);if(match&&!matches.some(item=>item.base===rule.base&&item.category===rule.category&&item.term===match[0]))matches.push({base:rule.base,category:rule.category,term:match[0],field});}
    }
    return matches;
  }
  function televisionService(context){return serviceMatches(context,SERVICE_FIELDS,[TELEVISION]).length>0;}
  function headerBaseMatches(context,requireSeparator=false){
    // Use the original account heading when present; truncated copies must not
    // turn a БТ/МНЧ identity into an apparently single-base identity.
    const field=['profileFullTitle','profileTitle','profileName'].find(key=>text(context?.[key]));
    if(!field)return [];
    const value=serviceText(context[field]),separator=value.search(/[·•|]/u);
    if(requireSeparator&&separator<0)return [];
    const prefix=separator<0?value:value.slice(0,separator),matches=[];
    for(const match of prefix.matchAll(/(?<![\p{L}\p{N}])(?:[кk][пp]|[мm][нh]ч|mnc|[бb][тt])(?![\p{L}\p{N}])/giu)){
      const term=match[0],base=/^[кk][пp]$/iu.test(term)?'kp':/^(?:[мm][нh]ч|mnc)$/iu.test(term)?'mnc':'bt';
      matches.push({base,category:'База в шапке',term,field});
    }
    return matches;
  }
  function baseCandidates(context={}){return [...new Set(headerBaseMatches(context).map(item=>item.base))];}
  function explicitPrefixMatches(context){return headerBaseMatches(context,true);}
  function resolveBase(context={},choices){
    const explicit=explicitPrefixMatches(context),explicitBases=[...new Set(explicit.map(item=>item.base))];
    if(explicitBases.length===1){const base=explicitBases[0];return {base,reason:'База явно указана в шапке: '+BASE_LABELS[base]+'.',reasonCode:'explicit-prefix',matched:explicit,conflict:false,requiresManual:false};}
    // A multi-base prefix still needs service meaning; TV keeps its accepted
    // semantic priority only when there is no unique explicit identity label.
    const televisions=serviceMatches(context,SERVICE_FIELDS,[TELEVISION]);
    if(televisions.length)return {base:'kp',reason:'Телевизоры — КП: «'+televisions[0].term+'».',reasonCode:'television',matched:televisions,conflict:false,requiresManual:false};
    // A concrete current ad/service wins over the broader account title.
    let matched=serviceMatches(context,['workTitle','adTitle','serviceTitle']);
    if(!matched.length)matched=serviceMatches(context,['profileFullTitle','profileTitle','profileName','profileComment']);
    const bases=[...new Set(matched.map(item=>item.base))];
    if(bases.length===1){const first=matched[0];return {base:bases[0],reason:first.category+' — '+BASE_LABELS[bases[0]]+': «'+first.term+'».',reasonCode:'service',matched,conflict:false,requiresManual:false};}
    if(bases.length>1)return {base:'',reason:'Несколько направлений: '+bases.map(base=>BASE_LABELS[base]+' («'+matched.find(item=>item.base===base).term+'»)').join(', ')+'. Выберите базу вручную.',reasonCode:'conflict',matched,conflict:true,requiresManual:true};
    const hints=Array.isArray(choices)?choices:Array.isArray(context?.baseCandidates)&&context.baseCandidates.length?context.baseCandidates:[context?.base];
    const allowed=[...new Set(hints.filter(value=>['kp','mnc','bt'].includes(value)))];
    if(allowed.length===1)return {base:allowed[0],reason:'База указана в шапке: '+BASE_LABELS[allowed[0]]+'.',reasonCode:'native-hint',matched:[],conflict:false,requiresManual:false};
    return {base:'',reason:'Недостаточно данных об услуге. Выберите базу вручную.',reasonCode:'unknown',matched:[],conflict:false,requiresManual:true};
  }
  function sourceKey(value){
    return text(value).toUpperCase().replace(/^(?:723\s+(?:ПАРТ(?:НЕР)?\s+)?)?БЕЛЫЙ\s+/u,'')
      .replace(/^748\s+ПАРТ(?:НЕР)?\s*[:\-]?\s*/u,'748 ')
      .replace(/ИСТОЧНИК(?:\s+ИСТОЧНИК)+/gu,'ИСТОЧНИК')
      .replace(/([А-ЯA-Z])\s+(?=\d)/gu,'$1').replace(/ИСТОЧНИК\s*(?:NO|№|#)?\s*3$/u,'ИСТОЧНИК3')
      .replace(/^748 АВИТО(?:\s+ДБ)?$/u,'748 АВИТО ДБ');
  }
  function specialSource(raw,partner){
    let key=sourceKey(raw);const p=text(partner).match(/(?:^|\s)0*748(?:\s|$)/u);
    if(p&&!key.startsWith('748 '))key='748 '+key;
    if(key==='748 ИСТОЧНИК3')return {code:'748 Источник №3',url:'https://clck.ru/3WTHy6'};
    if(key==='748 АВИТО ДБ')return {code:'748 Авито ДБ',url:'https://clck.ru/3UDZEu'};
    return null;
  }
  const lines=value=>String(value??'').replace(/\r\n?/g,'\n').split('\n');
  const WHITE_LINE='🔴БЕЛАЯ ЗАЯВКА🔴';
  function partnerNumber(value){const found=text(value).toLowerCase().match(/^(?:(?:парт|партнер)\s*(?:no\.?|[:№-])?\s*)?(\d+)(?=$|[^\d])/u);return found?found[1].replace(/^0+(?=\d)/u,''):'';}
  function whiteComment(value,partner){const body=lines(value).filter(v=>v.trim()!==WHITE_LINE).join('\n').trim();return partnerNumber(partner)==='723'?[WHITE_LINE,body].filter(Boolean).join('\n'):body;}
  function keepLines(value,required){const next=lines(value);for(const line of required||[])if(line&&!next.some(v=>v.trim()===line.trim()))next.push(line);return next.filter((v,i,a)=>v.trim()||i>0&&i<a.length-1).join('\n').trim();}
  function preserveBinding(previous,draft){
    const out={...draft};
    out.partnerId=previous.partnerId||'';
    out.partnerComment=String(previous.partnerComment??'');
    const urlLines=lines(previous.comments).filter(v=>/^https:\/\/\S+$/u.test(v.trim())||v.trim()===WHITE_LINE);
    const replacement=String(draft.sourceUrl||'').trim();
    out.comments=keepLines(lines(draft.comments).filter(v=>!replacement||v.trim()!==replacement||urlLines.some(old=>old.trim()===replacement)).join('\n'),urlLines);
    const dialogs=lines(previous.commentsService).filter(v=>/^https?:\/\/(?:chat\.partner-lead-centre\.ru|188-225-34-82\.sslip\.io|72-56-68-159\.sslip\.io)\/chats\/[A-Za-z0-9_-]+\/?$/u.test(v.trim()));
    const old=new Set(dialogs.map(v=>v.trim()));
    out.commentsService=keepLines(lines(draft.commentsService).filter(v=>!/^https?:\/\/\S+\/chats\/[A-Za-z0-9_-]+\/?$/u.test(v.trim())||old.has(v.trim())).join('\n'),dialogs);
    if(dialogs.length)out.commentsService=serviceComment(out.commentsService,dialogs[0].trim());
    return out;
  }
  function cancellationKind(status){const s=text(status);return /^(?:НФ|Не оформ|Не принят)/iu.test(s)?'nf':/^(?:Отмен|Отказ)/iu.test(s)?'cancel':'';}
  function requestReadOnly(status){
    const s=text(status).replace(/^Статус:\s*/iu,'');
    return /^(?:Готов(?:а|о|ы)?|НФ|Не\s*оформлен(?:а|о)?|(?:Отмена|Отменена|Отменен|Отменено)\s*(?:КЦ|ОФ|филиал(?:а|ом)?)|КЦ|ОФ|Отказ(?:а(?:лись|лась|лся|но|на|ны|н)?|ы)?)(?=$|[\s:—–-])/iu.test(s);
  }
  function removeCancellation(value,kind,reason){
    const normalizedReason=text(reason).toLowerCase();
    return lines(value).filter(line=>{
      const v=text(line).toLowerCase();if(!v)return true;
      if(kind==='nf'&&/^(?:нф|не оформлена)(?:\s*[:—-]?\s*(?:клиент\s+)?не знает когда сможет принять мастера[.!]?)?$/u.test(v))return false;
      if(kind==='nf'&&/^(?:клиент\s+)?не знает когда сможет принять мастера[.!]?$/u.test(v))return false;
      if(kind==='cancel'&&/^(?:отмена(?:\s+(?:кц|оф|филиала))?\s*[:—-]?\s*)?(?:клиент\s+)?(?:решил(?:а)?\s+проблему\s+самостоятельно|сделали\s+сами)(?:\s*\/[^\n]*)?[.!]?$/u.test(v))return false;
      if(kind==='cancel'&&/^(?:отмена\s+(?:кц|оф|филиала))$/u.test(v))return false;
      if(normalizedReason){const prefix=kind==='nf'?/^(?:нф|не оформлена)(?=$|\s|[:—-])\s*[:—-]?\s*/u:/^отмена(?:\s+(?:кц|оф|филиала))?(?=$|\s|[:—-])\s*[:—-]?\s*/u;if(v===normalizedReason||v.replace(prefix,'')===normalizedReason)return false;}
      return true;
    }).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function tagVisitHistory(before,after,options={}){
    before=String(before??'');after=String(after??'');if(!after||before===after)return {value:after,changed:false};
    // Preserve every old byte; accept only one clearly appended/prepended entry.
    if(before&&!after.startsWith(before)&&!after.endsWith(before))return {value:after,changed:false,unknown:true};
    const appended=!before||after.startsWith(before),fresh=before?(appended?after.slice(before.length):after.slice(0,-before.length)):after;
    const rows=fresh.split(/(\r?\n)/);const candidates=[];
    for(let i=0;i<rows.length;i+=2)if(rows[i].trim())candidates.push(i);
    if(candidates.length!==1)return {value:after,changed:false,unknown:true};
    const i=candidates[0];
    if(options.panel){
      // Only our panel annotates its newly added row. Preserve native defaults
      // and all pre-existing history, including their original spelling.
      rows[i]=rows[i].replace(/(?:\s+(?:\(с\s+авито\)|с\s+авито))+\s*$/iu,'').replace(/\s*$/u,'')+' с Авито';
    }else{
      if(/\(с Авито\)\s*$/iu.test(rows[i]))return {value:after,changed:false};
      rows[i]=rows[i].replace(/\s*$/u,'')+' (с Авито)';
    }
    const value=appended?before+rows.join(''):rows.join('')+before;
    return {value,changed:value!==after};
  }
  function cityMatches(items,query){const key=text(query).toLowerCase();return (items||[]).filter(v=>!v.disabled&&text(v.label??v.text??v.name).toLowerCase().includes(key));}
  function cityAlias(label){
    let bare=String(label??'');for(let n=0;n<10&&/\([^()]*\)/u.test(bare);n++)bare=bare.replace(/\([^()]*\)/gu,' ');
    const key=text(bare).toLocaleLowerCase('ru').replace(/^(?:г\.?|город)\s+/u,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    return ({'среднеуральск':'Екатеринбург','апрелевка':'Подольск (МСК)','апарелевка':'Подольск (МСК)','апревлека':'Подольск (МСК)'})[key] || '';
  }
  function routeCity(cities,label){
    const key=value=>text(value).toLocaleLowerCase('ru').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' ').replace(/^(?:г\.?|город)\s+/u,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
    const bare=value=>{let result=String(value??'');for(let n=0;n<10&&/\([^()]*\)/u.test(result);n++)result=result.replace(/\([^()]*\)/gu,' ');return key(result);};
    const wanted=key(label);if(!wanted)return null;
    const items=(Array.isArray(cities)?cities:[]).filter(item=>item&&!item.disabled&&String(item.id??item.value??'').trim());
    const title=item=>item.label??item.text??item.name??'';
    function exact(value){
      const full=items.filter(item=>key(title(item))===key(value));
      if(full.length)return {found:true,match:full.length===1?full[0]:null};
      const same=items.filter(item=>bare(title(item))===bare(value));
      return {found:same.length>0,match:same.length===1?same[0]:null};
    }
    const actual=exact(label);if(actual.found)return actual.match;
    // Business routing supplied by the owner, not a geographic distance guess.
    const target=cityAlias(label);
    return target?exact(target).match:null;
  }
  function withFreeVisit(value,messages){
    const confirmed=(messages||[]).some(message=>{
      if(message?.direction!=='out'||message.isInternal||message.is_internal===true||['client','customer','note','internal','system'].includes(message.senderType||message.sender_type||''))return false;
      return String(message.body||'').split(/[\n;.!]/u).some(part=>{
        const clause=text(part).toLowerCase();
        if(/[?]/u.test(clause)||/(?:^|\s)(?:не|если|возможно|может)(?:\s|$)/u.test(clause))return false;
        return /(?:^|[^\p{L}])выезд(?:\s+по\s+городу)?(?:\s+будет)?\s+бесплатн(?:ый|ым|о)(?=$|[^\p{L}])|(?:^|[^\p{L}])бесплатн(?:ый|ым)\s+выезд(?=$|[^\p{L}])/u.test(clause);
      });
    });
    return confirmed?keepLines(value,['Выезд бесплатный']):String(value??'');
  }
  function serviceComment(value,dialogUrl){
    let url;try{url=new URL(dialogUrl);if(!['http:','https:'].includes(url.protocol)||!['188-225-34-82.sslip.io','72-56-68-159.sslip.io','chat.partner-lead-centre.ru'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!/^\/chats\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname))return String(value??'');}catch(_){return String(value??'');}
    const isDialog=line=>/^https?:\/\/(?:188-225-34-82\.sslip\.io|72-56-68-159\.sslip\.io|chat\.partner-lead-centre\.ru)\/chats\/[A-Za-z0-9_-]+\/?$/u.test(line.trim());
    const remaining=lines(value).filter(line=>!isDialog(line));
    while(remaining.length&&remaining.at(-1)==='')remaining.pop();
    return [remaining[0]||'',url.href,...remaining.slice(1)].join('\n');
  }
  return Object.freeze({text,televisionService,resolveBase,baseCandidates,sourceKey,specialSource,keepLines,preserveBinding,cancellationKind,requestReadOnly,removeCancellation,tagVisitHistory,cityMatches,routeCity,cityAlias,partnerNumber,whiteComment,withFreeVisit,serviceComment,WHITE_LINE});
});
