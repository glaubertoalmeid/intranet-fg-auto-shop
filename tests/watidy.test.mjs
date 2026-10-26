import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEvent,businessHours,schedule,phone,validPhone,wascriptPhone} from '../lib/watidy/core.mjs';
test('webhooks sem formato validado pausam; outro contato é ignorado',()=>{
 assert.equal(inspectEvent({anything:'x'},undefined,'5585999999999'),'ambiguous');
 assert.equal(inspectEvent({data:{phone:'5585999999999'}},'data.phone','5585999999999'),'test-contact');
 assert.equal(inspectEvent({data:{phone:'5585888888888'}},'data.phone','5585999999999'),'ignore');
 assert.equal(inspectEvent({phone:{}},'phone','5585999999999'),'ambiguous');
});
test('horário Fortaleza inclui almoço, sábado e domingo',()=>{
 assert.equal(businessHours(new Date('2026-10-15T11:00:00Z')),true);
 assert.equal(businessHours(new Date('2026-10-15T15:00:00Z')),false);
 assert.equal(businessHours(new Date('2026-10-17T14:59:00Z')),true);
 assert.equal(businessHours(new Date('2026-10-17T15:00:00Z')),false);
 assert.equal(businessHours(new Date('2026-10-18T12:00:00Z')),false);
});
test('cadência tem cinco tentativas distintas e número brasileiro normalizado',()=>{
 const rows=schedule(new Date('2026-10-15T12:00:00Z'));
 assert.equal(rows.length,5);assert.equal(rows[4].due,'2026-11-05T12:00:00.000Z');
 assert.equal(validPhone(phone('+55 (85) 99999-9999')),true);
 assert.equal(validPhone('9999'),false);
});
test('wascriptPhone remove o 9º dígito do celular (gotcha confirmado na API real)',()=>{
 assert.equal(wascriptPhone('5585912345678'),'558512345678');
 assert.equal(wascriptPhone('558512345678'),'558512345678');
});
