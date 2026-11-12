// Prepare and audit an exact source snapshot; does not contact GitHub or read credentials.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const destination=path.join(root,'.cache','github-upload');
fs.mkdirSync(destination,{recursive:true});
const names=execFileSync('git',['-c','core.excludesFile=','ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/g,/github_pat_[A-Za-z0-9_]{30,}/g,/AKIA[A-Z0-9]{16}/g,/sk-[A-Za-z0-9_-]{32,}/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
const entries=[];
const files=[];
for(const name of [...new Set(names)].sort()) {
  if(/^(?:\.git|\.tools|\.cache|node_modules|target|dist|private-reports|local-data)(?:\/|$)/.test(name)) throw Error(`Forbidden source path: ${name}`);
  if(/(?:^|\/)\.env(?:\.|$)|\.(?:exe|dll|pdb|dmp|sqlite|pem|key)$/i.test(name)) throw Error(`Forbidden source artifact: ${name}`);
  const bytes=fs.readFileSync(path.join(root,name));
  if(bytes.length>2*1024*1024) throw Error(`Unexpected large source file: ${name}`);
  const binary=/\.(png|ico)$/i.test(name);
  const sha=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  files.push({path:name,bytes:bytes.length,sha,binary});
  if(binary) entries.push({path:name,mode:'100644',type:'blob',sha,base64:bytes.toString('base64')});
  else {
    const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    for(const p of patterns) {p.lastIndex=0;if(p.test(content))throw Error(`Potential credential found in ${name}; value withheld`);}
    entries.push({path:name,mode:'100644',type:'blob',content});
  }
}
let batch=[],count=0,size=0;
for(const e of entries.filter(e=>e.content!==undefined)) {
  const bytes=Buffer.byteLength(JSON.stringify(e),'utf8');
  if(batch.length&&size+bytes>100000){fs.writeFileSync(path.join(destination,`text-${count++}.json`),JSON.stringify(batch));batch=[];size=0;}
  batch.push(e);size+=bytes;
}
if(batch.length)fs.writeFileSync(path.join(destination,`text-${count++}.json`),JSON.stringify(batch));
const binaries=entries.filter(e=>e.base64!==undefined);
fs.writeFileSync(path.join(destination,'binary.json'),JSON.stringify(binaries));
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({schemaVersion:1,repository:'Wkey999/sentinel-pc',textBatches:count,files},null,2));
console.log(JSON.stringify({files:files.length,sourceBytes:files.reduce((n,f)=>n+f.bytes,0),textBatches:count,binaries:binaries.map(f=>({path:f.path,sha:f.sha})),credentialPatterns:'no matches'},null,2));
