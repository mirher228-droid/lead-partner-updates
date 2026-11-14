'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../extension/leadchat-request-background.js');
function setup(){const data={};const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))};return {gate:create({storage}),data};}
const args={base:'kp',kind:'create',scope:'dialogue',clientId:'client',operationId:'operation-A'};
const saved={ok:true,state:'saved',verified:true,operationId:'operation-A',record:{id:'123',base:'kp'}};
test('late prior receipt never replaces an active new create cycle',async()=>{
 const {gate}=setup();await gate.run({...args,command:'begin'});await gate.run({...args,command:'finish',result:saved});
 await gate.run({...args,command:'new',recordId:'123',operationId:'new-cycle'});
 await gate.run({...args,command:'begin',operationId:'operation-B',cycleId:'new-cycle'});
 await gate.run({...args,command:'record',result:saved});
 const status=await gate.run({...args,command:'status'});assert.equal(status.operation.operationId,'operation-B');assert.equal(status.operation.state,'running');
});
test('same-operation rejected receipt cannot downgrade confirmed save',async()=>{
 const {gate}=setup();await gate.run({...args,command:'begin'});await gate.run({...args,command:'finish',result:saved});
 await assert.rejects(gate.run({...args,command:'record',result:{ok:false,state:'rejected',operationId:'operation-A'}}),/подтвержд/);
 assert.equal((await gate.run({...args,command:'status'})).operation.state,'saved');
});
test('uncertain create remains locked across gate restart',async()=>{
 const {gate,data}=setup();await gate.run({...args,command:'begin'});await gate.run({...args,command:'dispatch'});await gate.run({...args,command:'finish',result:{ok:false,state:'uncertain',writeStarted:true}});
 const restarted=create({storage:{get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))}});
 const blocked=await restarted.run({...args,command:'begin',operationId:'operation-B'});assert.equal(blocked.ok,false);assert.equal(blocked.operation.operationId,'operation-A');
});
