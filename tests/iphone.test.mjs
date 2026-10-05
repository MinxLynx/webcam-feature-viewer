import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { previewSize, cameraConstraints, FramePacer } from '../public/media-platform.js';
import { lanAddresses, startIPhone, certificates } from '../iphone-server.mjs';

test('large portrait and landscape iPhone inputs preserve aspect and fit the canvas budget',()=>{
  assert.deepEqual(previewSize(4032,3024,true),{width:2048,height:1536});
  assert.deepEqual(previewSize(3024,4032,true),{width:1536,height:2048});
  assert.deepEqual(previewSize(480,720,true),{width:480,height:720});
  assert.deepEqual(previewSize(4032,3024,false),{width:4032,height:3024});
});
test('front/back selection overrides a stale camera device ID',()=>{
  assert.deepEqual(cameraConstraints('old-back-id','user',1280).video.facingMode,{ideal:'user'});
  assert.equal(cameraConstraints('old-back-id','user',1280).video.deviceId,undefined);
  assert.deepEqual(cameraConstraints('usb','',1920).video.deviceId,{exact:'usb'});
  assert.equal(cameraConstraints('','environment',1280).audio,false);
});
test('frame pacing preserves 30/60 fps on a display with timing jitter',()=>{
  for(const rate of [30,60]){
    const pacer=new FramePacer();let count=0;
    for(let i=0;i<600;i++)if(pacer.ready(i*1000/60+(i%3-1)*0.2,rate))count++;
    assert(Math.abs(count-rate*10)<=1,`${rate} fps: ${count} frames in 10 seconds`);
  }
  const pacer=new FramePacer();assert(pacer.ready(100,60));
  assert(!pacer.ready(105,60));assert(pacer.ready(3000,60));
  assert(!pacer.ready(3001,60),'no burst to catch up after a long pause');
  pacer.reset();assert(pacer.ready(3001,30));
  assert.deepEqual(cameraConstraints('','environment',1280).video.frameRate,{ideal:60,max:60});
  assert.deepEqual(cameraConstraints('','environment',1280,30).video.frameRate,{ideal:30,max:30});
});
test('LAN discovery excludes public and loopback addresses',()=>{
  const item=address=>({address,family:'IPv4',internal:false});
  assert.deepEqual(lanAddresses({wifi:[item('192.168.1.3'),item('10.0.0.8')],other:[item('8.8.8.8'),{...item('127.0.0.1'),internal:true}]}),['10.0.0.8','192.168.1.3']);
});
test('iPhone HTTPS verifies the actual chain and restricts setup routes to public assets',{skip:process.platform!=='win32'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'feature-lens-tls-'));
  const running=await startIPhone({directory,addresses:['127.0.0.1'],httpsPort:0,setupPort:0});
  try{
    const root=new X509Certificate(await readFile(join(directory,'root.cer')));
    const leaf=new X509Certificate(await readFile(join(directory,'server.cer')));
    assert(root.ca);assert(!leaf.ca);assert(leaf.verify(root.publicKey));assert.equal(leaf.checkIP('127.0.0.1'),'127.0.0.1');
    assert(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
    const saved=await certificates(directory,['127.0.0.1']);assert.equal(saved.ca.fingerprint256,root.fingerprint256);
    const request=path=>new Promise((resolve,reject)=>{
      https.get(running.urls[0]+path,{ca:root.toString()},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));}).on('error',reject);
    });
    const page=await request('');assert.equal(page.status,200);assert(page.body.includes('quickStart'));
    assert.equal((await request('media-platform.js')).status,200);
    assert.equal((await request('.local-https/server.pfx')).status,404);
    assert.equal((await request('root.cer')).status,404);
    const setup=await fetch(running.setupUrls[0]);assert.equal(setup.status,200);
    assert((await setup.text()).includes(running.urls[0]));
    const profile=await fetch(running.setupUrls[0]+'feature-lens.mobileconfig');
    assert.equal(profile.headers.get('content-type'),'application/x-apple-aspen-config');
    assert((await profile.text()).includes(saved.der.toString('base64')));
    for(const path of ['server.pfx','server.cer','app.js','../.local-https/server.pfx'])assert.equal((await fetch(running.setupUrls[0]+path)).status,404);
    assert.equal((await fetch(running.setupUrls[0],{method:'POST'})).status,405);
    assert.equal((await fetch(running.setupUrls[0]+'root.cer',{method:'HEAD'})).status,200);
  }finally{running.secure.closeAllConnections();running.setup.closeAllConnections();await Promise.all([new Promise(r=>running.secure.close(r)),new Promise(r=>running.setup.close(r))]);}
});
