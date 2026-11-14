'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {territory}=require('../extension/leadchat-map-search.js');
const shape=coordinates=>({type:'polygon',title:'Москва',geometry:{type:'Polygon',coordinates}});
const square=[[37,55],[38,55],[38,56],[37,56],[37,55]];
for(const [name,ring] of [
 ['identical vertices',[[37,55],[37,55],[37,55]]],
 ['collinear vertices',[[37,55],[38,55],[39,55]]],
 ['closed diagonal line',[[37,55],[38,56],[39,57],[37,55]]]
])test('collapsed boundary '+name+' cannot prove an address is outside',()=>{
 assert.equal(territory([shape([ring])],'Москва',[37.5,55.5],true).state,'unknown');
});
test('a valid exterior with a degenerate hole is unproven',()=>{
 assert.equal(territory([shape([square,[[37.2,55.2],[37.2,55.2],[37.2,55.2]]])],'Москва',[37.5,55.5],true).state,'unknown');
});
test('a collapsed relevant sibling prevents a false outside result',()=>{
 assert.equal(territory([shape([square]),shape([[[40,58],[40,58],[40,58]]])],'Москва',[39,57],true).state,'unknown');
});
test('nondegenerate boundary keeps inside and outside classifications in either winding',()=>{
 for(const ring of [square,[...square].reverse()]){
  assert.equal(territory([shape([ring])],'Москва',[37.5,55.5],true).state,'inside');
  assert.equal(territory([shape([ring])],'Москва',[39,57],true).state,'outside');
 }
});
test('small valid local-area ring is not lost to absolute coordinate cancellation',()=>{
 const ring=[[137,55],[137.0000001,55],[137.0000001,55.0000001],[137,55.0000001],[137,55]];
 assert.equal(territory([shape([ring])],'Москва',[138,56],true).state,'outside');
});
test('collapsed polygon within a multipolygon or geometry collection stays unproven',()=>{
 for(const geometry of [
  {type:'MultiPolygon',coordinates:[[square],[[[40,58],[40,58],[40,58]]]]},
  {type:'GeometryCollection',geometries:[{type:'Polygon',coordinates:[square]},{type:'Polygon',coordinates:[[[40,58],[40,58],[40,58]]]}]}
 ])assert.equal(territory([{type:'polygon',title:'Москва',geometry}],'Москва',[39,57],true).state,'unknown');
});
