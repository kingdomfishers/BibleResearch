// Run with PLAYWRIGHT_MODULE set to a Playwright installation and an Edge executable.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const executablePath=[process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath});
const base=process.env.BASE_URL||'http://localhost:3000';
const output='.artifacts/translation-ui'; await mkdir(output,{recursive:true});
const env=Object.fromEntries((await readFile('.env','utf8')).split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{
  const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];
}));
const response=await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY}});
assert(response.ok); const settings=await response.json();
const passed=[],pending=[],errors=[],networkFailures=[],fixtureUsers=new Set();
const newPage=async(context)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>{
    if(r.url().includes('/rest/v1/rpc/get_verse_translations_v1'))networkFailures.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText});
  });
  return page;
};
const live=async page=>{
  try{await page.waitForFunction(()=>document.querySelector('.source-badge')?.textContent==='Live database');}
  catch(error){
    const reader=await page.locator('.reader-card').innerText();
    await page.locator('.reader-card').screenshot({path:`${output}/failed-reader.png`});
    throw new Error(`Live verse did not load: ${reader}`,{cause:error});
  }
};
const token=(page,position)=>page.locator(`.word-token[data-position="${position}"]`);
const value=(page,position)=>token(page,position).locator('select').inputValue();
const status=(page,position,text)=>token(page,position).getByRole('status').filter({hasText:text}).waitFor();
const rememberUser=async page=>{
  const id=await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.endsWith('-auth-token'));
    return key?JSON.parse(localStorage.getItem(key))?.user?.id:null;
  });
  assert(id);fixtureUsers.add(id);
  await writeFile(`${output}/fixture-users.json`,JSON.stringify([...fixtureUsers]));
};
try{
  const a=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await newPage(a);await page.goto(`${base}/#1-1-1`);await live(page);
  assert.equal(await page.locator('.word-grid select').count(),7);
  assert.deepEqual(await page.locator('.word-grid select').evaluateAll(nodes=>nodes.map(n=>n.selectedOptions[0]?.text)),
    ['in beginning','he created','God','[object marker]','the heavens','and','the earth']);
  const geometry=await page.locator('.word-token').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));
  assert(geometry[0]>geometry[6]);
  await token(page,2).getByRole('button',{name:/Inspect/}).click();
  await page.locator('.strongs').waitFor();assert.match(await page.locator('dialog').innerText(),/H1254/);
  await page.keyboard.press('Escape');
  assert.deepEqual(await token(page,7).locator('option').allTextContents(),['the earth','the land','the ground']);
  await page.locator('.reader-card').screenshot({path:`${output}/desktop.png`});
  passed.push('Live source grammar, untranslated particles, all form options, RTL, original inspector');

  if(settings.external?.anonymous_users){
    await token(page,7).locator('select').selectOption('the/ land');await status(page,7,'Saved');await rememberUser(page);
    await page.reload();await live(page);assert.equal(await value(page,7),'the/ land');
    await page.goto(`${base}/#43-1-1`);await live(page);
    assert.equal(await page.locator('.word-grid').getAttribute('dir'),'ltr');
    // The same Greek verb occurs three times. Overrides must use occurrence positions.
    await token(page,3).locator('select').selectOption('was being');await status(page,3,'Saved');
    assert.equal(await value(page,9),'was');assert.equal(await value(page,15),'was');
    await page.reload();await live(page);assert.equal(await value(page,3),'was being');assert.equal(await value(page,9),'was');
    const b=await browser.newContext();const other=await newPage(b);
    await other.goto(`${base}/#1-1-1`);await live(other);assert.equal(await value(other,7),'the/ earth');
    await token(other,7).locator('select').selectOption('the/ ground');await status(other,7,'Saved');await rememberUser(other);
    await page.goto(`${base}/#1-1-1`);await live(page);assert.equal(await value(page,7),'the/ land');
    await token(page,7).getByRole('button',{name:/Reset/}).click();await status(page,7,'Source restored');
    await page.reload();await live(page);assert.equal(await value(page,7),'the/ earth');
    await other.reload();await live(other);assert.equal(await value(other,7),'the/ ground');
    await token(other,7).getByRole('button',{name:/Reset/}).click();await status(other,7,'Source restored');
    await b.close();
    passed.push('Live anonymous session, reload/navigation persistence, repeated occurrence isolation, two-reader privacy, reset');

    await page.route('**/rest/v1/rpc/save_word_translation_v1',route=>route.fulfill({status:503,json:{message:'Simulated save failure'}}));
    await token(page,7).locator('select').selectOption('the/ land');await status(page,7,'could not be saved');
    assert.equal(await value(page,7),'the/ earth');
    await page.unrouteAll({behavior:'wait'});
    // A response to an old passage cannot paint over the new passage.
    await page.route('**/rest/v1/rpc/save_word_translation_v1',async route=>{
      await new Promise(resolve=>setTimeout(resolve,800));await route.fulfill({json:{saved:true,english:'the/ land',source_english:'the/ earth'}});
    });
    await token(page,7).locator('select').selectOption('the/ land');
    await page.locator('a[href="#43-1-1"]').click();await live(page);
    assert.equal(await page.locator('.word-grid select').count(),17);
    await page.unrouteAll({behavior:'wait'});
    passed.push('Failed-save rollback and navigation during an in-flight save');
  }else{
    pending.push('Enable anonymous sign-ins, then rerun live save/reload/reset and two-browser persistence checks');
    await token(page,7).locator('select').selectOption('the/ land');await status(page,7,'not enabled');
    assert.equal(await value(page,7),'the/ earth');
    passed.push('Disabled private saving is visible and does not claim a saved choice');
    await page.goto(`${base}/#43-1-1`);await live(page);
  }
  assert.equal(await page.locator('.word-grid').getAttribute('dir'),'ltr');
  assert.equal(await page.locator('.word-grid select').count(),17);
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/#1-1-1`);await live(page);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await token(page,7).locator('select').evaluate(el=>getComputedStyle(el).direction),'ltr');
  await token(page,7).locator('select').focus();assert.equal(await token(page,7).locator('select').evaluate(el=>document.activeElement===el),true);
  await page.locator('.reader-card').screenshot({path:`${output}/mobile.png`});
  passed.push('Greek LTR, mobile width, English direction and native keyboard focus');

  const offlineContext=await browser.newContext();const offline=await newPage(offlineContext);
  await offline.route('**/src/api/supabase.ts*',route=>route.fulfill({contentType:'application/javascript',body:
    'export const supabase=null;export const restoreReaderSession=async()=>null;export const ensureReaderSession=async()=>{};'}));
  await offline.goto(`${base}/#1-1-1`);
  await offline.waitForFunction(()=>document.querySelector('.reader-card')?.getAttribute('aria-busy')==='false');
  assert.equal(await offline.locator('.word-grid select').count(),7);
  assert.equal(await offline.locator('.word-grid select:disabled').count(),7);
  assert.equal(await offline.locator('.translation-status').first().innerText(),'Sample');
  assert.equal(await token(offline,1).locator('select').inputValue(),'in beginning');
  assert.equal(await token(offline,2).locator('select').inputValue(),'he created');
  passed.push('Offline fixture English remains visible and never claims cloud persistence');
  assert.deepEqual(errors,[]);
}finally{
  for(const context of browser.contexts())for(const page of context.pages()){
    await page.unrouteAll({behavior:'wait'});
    if(!page.url().startsWith(base))continue;
    try{
      const id=await page.evaluate(async({url,key})=>{
        const storageKey=Object.keys(localStorage).find(k=>k.endsWith('-auth-token'));
        const session=storageKey?JSON.parse(localStorage.getItem(storageKey)):null;
        if(!session?.user?.is_anonymous)return null;
        await fetch(`${url}/auth/v1/logout`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${session.access_token}`}});
        return session.user.id;
      },{url:env.VITE_SUPABASE_URL,key:env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY});
      if(id)fixtureUsers.add(id);
    }catch{}
  }
  await browser.close();
  // Delete only the anonymous identities created by this test, via an administrator.
  const ids=[...fixtureUsers].filter(id=>/^[a-f0-9-]{36}$/.test(id));
  const idsSql=ids.map(id=>`'${id}'::uuid`).join(',');
  await writeFile(`${output}/cleanup.sql`,ids.length?`begin; delete from auth.sessions where user_id in (select id from auth.users where is_anonymous and id in (${idsSql})); delete from auth.users where is_anonymous and id in (${idsSql}); commit;`:'select 0 as fixture_users;');
  await writeFile(`${output}/report.json`,JSON.stringify({passed,pending,errors,networkFailures},null,2));
  console.log(JSON.stringify({passed,pending,errors,networkFailures},null,2));
}
if(pending.length)process.exitCode=2;
