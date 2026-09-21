import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const elements=new Map();
const element=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',style:{},classList:{add(){},remove(){}},firstElementChild:{inert:false},focus(){},remove(){},getBoundingClientRect(){return {top:0}},scrollIntoView(){},addEventListener(){},insertAdjacentHTML(_,html){this.innerHTML+=html}});return elements.get(selector)};
const stored=new Map([['sprachraum.sessions.v1',JSON.stringify({version:1,last:'release',sessions:{release:{id:'release',topic:'releases',lesson:'release',tab:'reading',pages:{},drafts:{'reading:0':'Earlier reading note','writing:0':'Earlier short announcement'},saved:[],tones:{},checks:{},reveals:{}}}})]]);
const context={document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){},body:{style:{}}},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},setTimeout:()=>0,clearTimeout(){},addEventListener(){},console,TextEncoder};context.window=context;vm.createContext(context);
for(const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','pronunciation.js','collaboration.js','app.js'])vm.runInContext(fs.readFileSync(`dist/${file}`,'utf8')+(file==='pronunciation.js'?'\nPRONUNCIATION.mount=()=>{};':''),context,{filename:file});
const run=code=>vm.runInContext(code,context);
const areaNames=['reading','vocabulary','grammar','expression','speaking','writing'];
let pageCount=0;const counts={};
for(const [id,lesson]of Object.entries(context.LESSONS)){
  const reading=lesson.reading[0];assert.equal(reading.kind,'article');assert.equal(reading.paragraphs.length,8);
  const n=reading.paragraphs.join(' ').split(/\s+/).length;assert(n>=650&&n<=850);counts[id]=n;
  assert.equal(lesson.reading[1].tasks.length,4);
  for(const question of lesson.reading[1].tasks)for(const para of question.paragraphs)assert(para>=1&&para<=reading.paragraphs.length);
  const ids=new Set();
  run(`start(${JSON.stringify(lesson.label)},${JSON.stringify(id)})`);
  for(const area of areaNames){
    for(let i=0;i<lesson[area].length;i++){
      const p=lesson[area][i];assert(p.title&&p.question&&p.coach&&p.source);assert(context.SOURCE_PATTERNS[p.source]);assert(!ids.has(p.id));ids.add(p.id);
      run(`navigate(${JSON.stringify(area)},${i})`);
      assert(elements.get('#app').innerHTML.includes(p.title.replaceAll('&','&amp;')));
      const material=run('material(pages()[pageIndex()])');
      assert(!material.includes('undefined'));assert(!material.includes('NaN'));
      if(p.reuse)assert(lesson.writing.some(w=>w.id===p.reuse));
      if(p.kind==='article')assert.equal((material.match(/class="paragraph-number"/g)||[]).length,p.paragraphs.length+(p.reference?.length||0));
      pageCount++;
    }
  }
}
run("start('releases');navigate('reading',0);state.drafts[key()]='New long-reading note';persist()");
assert.equal(run("state.drafts['reading:0']"),'Earlier reading note');assert.equal(run('state.drafts[key()]'),'New long-reading note');assert.match(run("draftLabel('reading:0')"),/earlier activity/);
run("navigate('writing',0);state.drafts[key()]='A new longer draft with a distinct conclusion.';navigate('writing',1)");
assert.match(run('material(pages()[pageIndex()])'),/A new longer draft with a distinct conclusion/);
assert(!run('material(pages()[pageIndex()])').includes('Earlier short announcement'));
run("state.drafts[key()]='<script>test</script>'");assert.match(run('material(pages()[pageIndex()])'),/&lt;script&gt;test&lt;\/script&gt;/);
assert(!run('material(pages()[pageIndex()])').includes('<script>test</script>'));
run("openDrawer('notes')");assert(!elements.get('#app').innerHTML.includes('page NaN'));assert(elements.get('#app').innerHTML.includes('Earlier reading note'));
assert.equal(run("countWords('Eine präzise Formulierung hilft.')"),4);
const html=fs.readFileSync('dist/index.html','utf8');for(const match of html.matchAll(/(?:src|href)="([^\"]+)"/g)){if(!match[1].startsWith('data:')&&!match[1].startsWith('http'))assert(fs.existsSync('dist/'+match[1]));}
console.log(JSON.stringify({activityPages:pageCount,readingWords:counts,paragraphReferences:'valid',oldDrafts:'preserved separately',revisionDraftReuse:'passed',escapedWriting:'passed',entryAssets:'valid'},null,2));
