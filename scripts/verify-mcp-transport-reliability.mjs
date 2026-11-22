// Offline adapter/concurrency regressions; all writes use a rejecting fixture.
import assert from 'node:assert/strict';
import { createApp, createDatabaseReader } from '../supabase/functions/bible-mcp/index.ts';

let active = 0, peak = 0, batches = 0;
const read = createDatabaseReader({url:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture'}, async input => {
  const url = new URL(input);
  if (url.pathname.endsWith('/words')) {
    batches++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    const ids = url.searchParams.get('id').slice(4,-1).split(',').map(Number);
    return Response.json(ids.map(id => ({id})));
  }
  if (url.pathname.endsWith('/places')) return Response.json([{id:1,biblical_name:'Corinth'}]);
  if (url.pathname.endsWith('/passage_geography')) return Response.json([{place_id:1,book:46,start_chapter:1,start_verse:1,end_chapter:16,end_verse:24,relationship_type:'audience_location'}]);
  return Response.json([]);
});
const ids=Array.from({length:751},(_,i)=>i+1);
const rows=await read({name:'get_words_batch',args:{word_ids:ids},limit:751,offset:0});
assert.deepEqual(rows.rows.map(r=>r.id),ids);assert.equal(batches,8);assert.ok(peak<=4);
const geo=await read({name:'query_places_by_name',args:{query:'Corinth'},limit:2,offset:0});
assert.equal(geo.rows[0].places[0].linked_passages[0].ref,'1 Corinthians 1:1-1 Corinthians 16:24');
assert.equal(geo.rows[0].places[0].linked_passages[0].relationship_type,'audience_location');

let writes=0;
const app=createApp({url:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture',serviceRoleKey:'private_service_key',agentKey:'right-key'},async()=>{writes++;throw Error('No fixture write is permitted');});
let seq=0;
async function call(headers,args) {
  const response=await app(new Request('https://fixture.supabase.co/functions/v1/bible-mcp/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name:'write_Note',arguments:args}})}));
  return response.text();
}
// Overlapping valid-reader calls must not lend their Authorization header to an unauthorized write.
const results=await Promise.all(Array.from({length:8},()=>call({}, {action:'create',title:'test',body:'test'})));
assert.ok(results.every(x=>/requires|key|authorization/i.test(x)&&!x.includes('private_service_key')));
assert.equal(writes,0);
console.log('PASS adapter batching: 751 forms, bounded concurrency; readable scoped geography; concurrent write refusals without service calls');
