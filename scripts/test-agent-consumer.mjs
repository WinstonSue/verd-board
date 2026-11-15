import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packPublicPackages, root } from './pack-public.mjs';
import { readSchemaArtifacts } from './schema-artifacts.mjs';

const previewOnly = process.argv.indexOf('--preview-only');
const reuse = process.argv.findIndex((arg) =>
  ['--preview-only', '--verify-only'].includes(arg),
);
const directory =
  reuse >= 0
    ? path.resolve(process.argv[reuse + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'verd-agent-consumer-'));
function run(command, args, cwd = directory) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}
if (reuse < 0) {
  const packages = packPublicPackages(path.join(directory, 'tarballs'));
  const archives = Object.fromEntries(
    packages.map((p) => [p.name, `file:${p.archive}`]),
  );
  fs.writeFileSync(
    path.join(directory, '.npmrc'),
    fs
      .readFileSync(path.join(root, '.npmrc'), 'utf8')
      .split('\n')
      .filter((line) => /^(registry|@sue:registry|@ylib:registry)=/.test(line))
      .join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(directory, 'pnpm-workspace.yaml'),
    `packages: []\noverrides: ${JSON.stringify({ ...archives, ...readSchemaArtifacts() })}\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name: 'agent-tarball-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@sue/verd-board-agent': archives['@sue/verd-board-agent'],
          '@sue/verd-board-agent-patterns':
            archives['@sue/verd-board-agent-patterns'],
          '@sue/verd-board-workspace': archives['@sue/verd-board-workspace'],
        },
      },
      null,
      2,
    ),
  );
  console.log('Installing real archives in ' + directory);
  run('pnpm', [
    'install',
    '--ignore-scripts',
    ...(process.env.VERD_AGENT_CONSUMER_OFFLINE ? ['--offline'] : []),
  ]);
}
// Inspect installed production dependencies, including nested peer/optional branches.
const installed = JSON.parse(
  run('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json']),
);
const checkInstalled = (entry) => {
  for (const group of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, dependency] of Object.entries(entry[group] ?? {})) {
      if (['@sue/verd-board-app', '@sue/verd-board-ui'].includes(name))
        throw new Error(
          'Standalone Agent installed product dependency: ' + name,
        );
      checkInstalled(dependency);
    }
  }
};
installed.forEach(checkInstalled);
// Execute inside the outside-repository installation, using only public package entries.
const verifyPath = path.join(directory, 'verify.mjs');
fs.writeFileSync(
  verifyPath,
  `
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readNativeSnapshot, prepareAuthoringBatch, applyPreparedBatch, validateNativeWorkspace } from '@sue/verd-board-agent';
import { patterns, patternWorkspaceUrl, loadPatternGuide, loadPatternGuides } from '@sue/verd-board-agent-patterns/agent';
import { recommendationWorkspaceUrl } from '@sue/verd-board-agent-patterns/recommendations';
import { fileURLToPath } from 'node:url';
for (const name of ['@sue/verd-board-app', '@sue/verd-board-ui']) {
  await assert.rejects(fs.access(path.join(process.cwd(), 'node_modules', name)), {code:'ENOENT'});
}
const base = process.cwd(), root = path.join(base, 'content-'+Date.now());
const cli = path.join(base, 'node_modules/.bin/verd');
const run = args => { const r=spawnSync(cli,args,{encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout); };
await fs.mkdir(root,{recursive:true});
const doctorBefore = await fs.readdir(root);
const unreadyDoctor = spawnSync(cli,['doctor','--workspace',root,'--json'],{encoding:'utf8'});
assert.equal(unreadyDoctor.status,1,unreadyDoctor.stderr);
assert.equal(JSON.parse(unreadyDoctor.stdout).ready,false);
assert.equal(unreadyDoctor.stderr,'');
assert.deepEqual(await fs.readdir(root),doctorBefore);

assert.ok(run(['describe','--json']).document.nodes.frameReference);
assert.equal(run(['patterns','--json']).length,13);
assert.ok((await fs.readFile(run(['skill']).path,'utf8')).includes('verd plan'));
const bundledEntries=(await readNativeSnapshot(fileURLToPath(patternWorkspaceUrl))).entries;
assert.deepEqual(bundledEntries.map(entry=>entry.path).sort(), [...new Set(patterns.flatMap(pattern=>pattern.templatePaths))].sort());
assert.equal((await loadPatternGuide()).path,'skills/verd-authoring/references/writing.md');
for(const pattern of patterns) {
 const guide=await loadPatternGuide(pattern.id);
 assert.equal(guide.path,pattern.guidePath);
 assert.equal(guide.source,await fs.readFile(new URL(guide.path,patternWorkspaceUrl),'utf8'));
 assert.equal((await loadPatternGuides(pattern.id)).at(-1).path,guide.path);
}
const bundledDiagnostics=validateNativeWorkspace(bundledEntries);
assert.ok(bundledDiagnostics.every(d=>d.code==='workflow.port-direction' && d.severity==='warning'));
const assertValid = diagnostics => { assert.equal(diagnostics.length,bundledDiagnostics.length); assert.ok(diagnostics.every(d=>d.code==='workflow.port-direction' && d.severity==='warning')); };
assert.ok(run(['rules','--json']).runtime['workflow.port-direction']);
const reversed=JSON.parse(await fs.readFile(new URL('workflow-process/模板.verd.json',patternWorkspaceUrl),'utf8'));
const reversedEdge=Object.values(reversed.cells).find(cell=>cell.cellType==='edge');
reversed.cells[reversedEdge.source.cellId].ports.find(port=>port.id===reversedEdge.source.portId).side='top';
const reversedDiagnostics=validateNativeWorkspace([{path:'reverse.verd.json',file:reversed}]);
assert.ok(reversedDiagnostics.some(d=>d.code==='workflow.port-direction' && d.severity==='warning'));
assert.ok(!validateNativeWorkspace([{path:'reverse.verd.json',file:reversed}],{profile:'runtime'}).some(d=>d.code==='workflow.port-direction'));
const previews = [];
if (process.argv.includes('--preview')) {
  for (const p of patterns) for (const [index, template] of p.templatePaths.entries()) {
    const source=JSON.parse(await fs.readFile(new URL(template,patternWorkspaceUrl),'utf8'));
    const id=source.format==='verd-document'?source.id:source.frame.id;
    const out=path.join(base,p.id+'-'+index+'.png');
    const rendered=run(['preview',id,'--workspace',fileURLToPath(patternWorkspaceUrl),'--out',out,'--json']);
    assert.ok((await fs.stat(out)).size>1000);
    previews.push({pattern:p.id,template,...rendered});
  }
  console.log(JSON.stringify({previews})); process.exit(0);
}
// Recommendation changes cannot become executable defaults or change instantiated content.
const defaults=Object.fromEntries(['describe','rules','patterns','skill'].map(command=>[command,run([command,'--json'])]));
const recommendationFile=new URL('rich-document/模板.verd-doc.json',recommendationWorkspaceUrl);
const recommendationOriginal=await fs.readFile(recommendationFile,'utf8');
const independenceSnapshot=await readNativeSnapshot(root);
const instantiate=()=>prepareAuthoringBatch(independenceSnapshot,[{type:'pattern.instantiate',patternId:'rich-document'}]);
const canonical=plan=>{
 let json=JSON.stringify(plan.files.map(entry=>({...entry,path:entry.path.replace(/^[a-f0-9]{8}-/, '')})));
 for(const [oldId,newId] of Object.entries(plan.idMap).sort((a,b)=>b[1].length-a[1].length))json=json.split(newId).join(oldId);
 return JSON.parse(json);
};
const agentTemplateBefore=canonical(await instantiate());
try {
 await fs.writeFile(recommendationFile,JSON.stringify({format:'user-advice',text:'Changed recommendation only'}));
 for(const command of Object.keys(defaults))assert.deepEqual(run([command,'--json']),defaults[command]);
 assert.deepEqual(canonical(await instantiate()),agentTemplateBefore);
} finally {await fs.writeFile(recommendationFile,recommendationOriginal);}
const initial=await readNativeSnapshot(root);
const plan=await prepareAuthoringBatch(initial,patterns.map(p=>({type:'pattern.instantiate',patternId:p.id,dir:p.id})));
assertValid(plan.diagnostics);
assert.equal((await applyPreparedBatch(root,plan)).outcome,'applied');
assert.equal((await applyPreparedBatch(root,plan)).transactionId,plan.transactionId);
assertValid(validateNativeWorkspace((await readNativeSnapshot(root)).entries));
const basis=await readNativeSnapshot(root);
const make=title=>prepareAuthoringBatch(basis,[{type:'file.create',kind:'document',title,id:title,path:title+'.verd-doc.json'}]);
const a=await make('A'),b=await make('B');
await fs.writeFile(path.join(base,'a.json'),JSON.stringify(a));await fs.writeFile(path.join(base,'b.json'),JSON.stringify(b));
const invoke=plan=>new Promise(resolve=>{const p=spawn(cli,['apply','--workspace',root,'--plan',plan],{stdio:['ignore','pipe','pipe']});let err='';p.stderr.on('data',d=>err+=d);p.on('exit',code=>resolve({code,err}));});
const results=await Promise.all([invoke(path.join(base,'a.json')),invoke(path.join(base,'b.json'))]);
assert.deepEqual(results.map(r=>r.code).sort(),[0,3],JSON.stringify(results));
const copied=path.join(base,'library-'+Date.now());run(['patterns','workspace','--dest',copied]);
assertValid(validateNativeWorkspace((await readNativeSnapshot(copied)).entries));
assert.notEqual(spawnSync(cli,['patterns','workspace','--dest',copied]).status,0);
// A live Desktop-style session retains its unsaved draft when the CLI publishes newer bytes.
const snapshot=await readNativeSnapshot(root),doc=snapshot.entries.find(e=>e.file.format==='verd-document');
const worker=spawn(process.execPath,['--input-type=module','-e',\
  "import {createFsWorkspaceHost} from '@sue/verd-board-agent/node';import {openWorkspaceSession} from '@sue/verd-board-workspace';"+\
  "const h=createFsWorkspaceHost({defaultRoot:()=>process.env.TEST_ROOT});const key=await h.openWorkspace({path:process.env.TEST_ROOT});const s=await openWorkspaceSession(h,key,{delayMs:60000});"+\
  "const f=structuredClone(s.getState().documents.get(process.env.TEST_DOC).file);f.title='Desktop unsaved';await s.apply({type:'file',file:f});console.log('ready');process.stdin.once('data',async()=>{const saved=await s.flush();console.log(JSON.stringify({saved,dirty:s.getState().dirty}));s.dispose();await h.closeWorkspace(key);process.exit(saved?1:0);});"\
],{cwd:base,env:{...process.env,TEST_ROOT:root,TEST_DOC:doc.file.id},stdio:['pipe','pipe','pipe']});
let stdout='';await new Promise((resolve,reject)=>{worker.stdout.on('data',data=>{stdout+=data;if(stdout.includes('ready'))resolve();});worker.on('error',reject);worker.on('exit',code=>{if(!stdout.includes('ready'))reject(new Error('Desktop worker exited '+code));});});
const changed=await prepareAuthoringBatch(await readNativeSnapshot(root),[{type:'document.splice',fileId:doc.file.id,index:0,deleteCount:0,blocks:[{type:'paragraph',content:[{type:'text',text:'CLI current'}]}]}]);
await applyPreparedBatch(root,changed);worker.stdin.write('flush');
await new Promise((resolve,reject)=>worker.on('exit',code=>code===0?resolve():reject(new Error(stdout))));
assert.ok(stdout.includes('"saved":false'));
assert.ok((await readNativeSnapshot(root)).entries.find(e=>e.file.id===doc.file.id).file.text.plainText.startsWith('CLI current'));
assertValid(validateNativeWorkspace((await readNativeSnapshot(root)).entries));
const dead=spawn(process.execPath,['--input-type=module','-e',  "import {withWorkspaceLock} from '@sue/verd-board-agent/node';await withWorkspaceLock(process.env.TEST_ROOT,async()=>{console.log('locked');await new Promise(()=>setInterval(()=>{},1000));});"],{cwd:base,env:{...process.env,NODE_OPTIONS:'',TEST_ROOT:root},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{dead.stdout.once('data',resolve);dead.on('error',reject);dead.on('exit',code=>reject(new Error('Lock worker exited '+code)));});
const died=new Promise(resolve=>dead.once('exit',resolve));dead.kill('SIGKILL');await died;
assertValid(validateNativeWorkspace((await readNativeSnapshot(root)).entries));
console.log(JSON.stringify({patterns:patterns.length,files:(await readNativeSnapshot(root)).entries.length,concurrent:results.map(r=>r.code),desktopConflict:true,deadLockRecovered:true}));
`,
);
console.log(
  run(process.execPath, [
    verifyPath,
    ...(previewOnly >= 0 ? ['--preview'] : []),
  ]),
);
console.log('Consumer directory: ' + directory);
