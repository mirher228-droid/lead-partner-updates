/* Compact presentation only for an explicitly marked Lead-Partner map iframe. */
(function(){
  'use strict';
  const url=new URL(location.href);
  if(window.top===window || url.origin!=='https://yandex.ru' || url.pathname!=='/map-widget/v1/' || url.searchParams.get('lp_request_map')!=='1')return;
  const cityOutline=url.searchParams.get('lp_city_outline')==='1'&&url.searchParams.get('ol')==='geo'&&/^\d{1,24}$/.test(url.searchParams.get('oid')||'');
  function mark(){document.documentElement?.setAttribute('data-leadpartner-map','compact');if(cityOutline)document.documentElement?.setAttribute('data-leadpartner-outline','city');}
  mark();
  if(!document.documentElement)document.addEventListener('DOMContentLoaded',mark,{once:true});
  // Closing a native balloon can remove its selected city outline. Presentation
  // is entirely CSS: no synthetic click, map-state mutation or delayed close.
})();
