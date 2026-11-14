'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../extension/leadpartner-rules.js');

test('partner identifiers keep their number after NFKC normalizes the number sign',()=>{
  for(const value of ['Партнёр № 007','Партнер№007','ПАРТНЁР № 007','Парт № 007','Партнер No 007','Партнер No. 007'])
    assert.equal(rules.partnerNumber(value),'7',value);
});
test('existing numeric partner labels and exact boundaries remain supported',()=>{
  for(const value of ['007','7 Партнер','Партнер 007','Парт: 007','Партнер-007'])
    assert.equal(rules.partnerNumber(value),'7',value);
  for(const value of ['Сервис 007','No 007','Партнер неизвестен 007','Партнер None007','Партнер № нет 007',''])
    assert.equal(rules.partnerNumber(value),'',value);
});
