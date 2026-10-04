import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { X509Certificate, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { application } from './server.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
export function lanAddresses(interfaces=networkInterfaces()) {
  return [...new Set(Object.entries(interfaces).filter(([name])=>!/vEthernet|WSL|VirtualBox|VMware|Loopback/i.test(name)).flatMap(([,items])=>items).filter(item=>item && item.family==='IPv4'&&!item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item=>item.address))].sort();
}
export async function certificates(directory,addresses) {
  try {
    const [pfx,der,leaf]=await Promise.all(['server.pfx','root.cer','server.cer'].map(name=>readFile(join(directory,name))));
    const ca=new X509Certificate(der),cert=new X509Certificate(leaf);
    if(Date.parse(cert.validTo)>Date.now()+86400000&&cert.verify(ca.publicKey)&&addresses.every(ip=>cert.checkIP(ip)))return {pfx,der,ca};
  } catch { /* First run, expired certificate, or a changed Wi-Fi address. */ }
  if(process.platform!=='win32')throw new Error('The iPhone launcher requires Windows PowerShell.');
  await mkdir(directory,{recursive:true});
  await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts','create-certificate.ps1'),'-OutputDirectory',directory,'-Addresses',addresses.join(',')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let error='';child.stderr.on('data',data=>error+=data);
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Certificate generation failed: ${error}`)));
  });
  const pfx=await readFile(join(directory,'server.pfx')),der=await readFile(join(directory,'root.cer'));
  return {pfx,der,ca:new X509Certificate(der)};
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function profile(der,ca) {
  const name=escape(ca.subject.replace('CN=',''));
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>local.feature-lens.${ca.fingerprint256.replaceAll(':','').toLowerCase()}</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadDisplayName</key><string>${name}</string><key>PayloadDescription</key><string>このPCのFeature LensへのHTTPS接続に使用します。不要になったらこのプロファイルを削除できます。</string>
<key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>local.feature-lens.root</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadDisplayName</key><string>${name}</string><key>PayloadContent</key><data>${der.toString('base64')}</data></dict></array></dict></plist>`;
}
export async function listenAvailable(server,port,host='0.0.0.0') {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
  for(let attempt=0;attempt<=20;attempt++){
    try {await new Promise((resolve,reject)=>{const fail=e=>{server.off('listening',ready);reject(e);};const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(port,host);});return server.address().port;}
    catch(error){if(error.code!=='EADDRINUSE'||attempt===20||port===65535)throw error;port++;}
  }
}
export async function startIPhone({directory=join(root,'.local-https'),addresses=lanAddresses(),httpsPort=Number(process.env.HTTPS_PORT||8443),setupPort=Number(process.env.SETUP_PORT||8766)}={}) {
  if(!addresses.length)throw new Error('Wi-Fi/LAN IPv4 address not found. Connect this PC to the same Wi-Fi as your iPhone.');
  const {pfx,der,ca}=await certificates(directory,addresses);
  const secure=https.createServer({pfx,passphrase:'',minVersion:'TLSv1.2'},application);
  const port=await listenAvailable(secure,httpsPort);
  const setup=http.createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    const path=new URL(req.url,'http://localhost').pathname;
    let body,type;
    if(path==='/feature-lens.mobileconfig'){body=profile(der,ca);type='application/x-apple-aspen-config';}
    else if(path==='/root.cer'){body=der;type='application/x-x509-ca-cert';}
    else if(path==='/'){
      type='text/html; charset=utf-8';
      body=`<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feature Lens — iPhone接続</title><style>body{font:16px system-ui;background:#0b1116;color:#e5ecef;max-width:760px;margin:auto;padding:24px;line-height:1.9}h1{font-size:25px}a{color:#92efd3;overflow-wrap:anywhere}.button{display:block;padding:14px;border:1px solid #80e6c8;border-radius:8px;margin:16px 0}code{overflow-wrap:anywhere}li{margin:16px 0}small{color:#aabdc4}</style><h1>Feature LensをiPhoneで使う</h1><p>PCとiPhoneを同じWi-Fiにつなぎ、iPhoneの<strong>Safari</strong>でこの案内を開いてください。</p><p>${addresses.map(ip=>`接続案内：<a href="http://${ip}:${setup.address().port}/">http://${ip}:${setup.address().port}/</a>`).join('<br>')}</p><h2>初回の設定</h2><ol><li>このPC専用の証明書をダウンロードします。<a class="button" href="/feature-lens.mobileconfig">接続用プロファイルをダウンロード</a></li><li>iPhoneの「設定」→「一般」→「VPNとデバイス管理」で <strong>${escape(ca.subject.replace('CN=',''))}</strong> を選び、インストールします。PCのこの画面と証明書名が一致することを確認してください。</li><li>「設定」→「一般」→「情報」→「証明書信頼設定」で、同じ証明書の信頼をオンにします。</li><li>Safariに戻り、下のアプリを開いて「カメラ開始」→「許可」を選びます。${addresses.map(ip=>`<a class="button" href="https://${ip}:${port}/">アプリを開く： https://${ip}:${port}/</a>`).join('')}</li></ol><p>次回はアプリのアドレスを開くだけです。Safariの共有メニューから「ホーム画面に追加」もできます。使用中はPCと起動ウィンドウを開いたままにしてください。</p><h2>接続できないとき</h2><p>Windowsのネットワーク接続確認が出たら、自宅など信頼できるプライベートネットワークでNode.jsの接続を許可してください。ゲストWi-Fiでは端末間通信が制限される場合があります。証明書の警告が出る場合は、警告を無視せず上の信頼設定を確認してください。</p><p>PCのIPアドレスが変わった場合や証明書の期限切れ時は、再起動で作られた新しいプロファイルを設定してください。古いプロファイルや不要になったプロファイルは「VPNとデバイス管理」から削除できます。</p><p><small>写真・動画はiPhone内で処理します。このサーバーはアプリと接続案内だけを配信し、ファイルのアップロードは受け付けません。証明書を発行する秘密鍵は作成後に破棄され、Windowsの信頼設定も変更しません。</small></p><p><small>証明書 SHA-256：<code>${ca.fingerprint256}</code><br>有効期限：${escape(ca.validTo)}</small></p><p><a href="https://support.apple.com/ja-jp/102390">Apple公式：証明書の信頼設定</a></p></html>`;
    }else{res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:body);
  });
  try {await listenAvailable(setup,setupPort);}catch(error){secure.close();throw error;}
  const urls=addresses.map(ip=>`https://${ip}:${port}/`),setupUrls=addresses.map(ip=>`http://${ip}:${setup.address().port}/`);
  return {secure,setup,urls,setupUrls,ca};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await startIPhone();
    console.log(`Feature Lens / iPhone\nSetup: ${result.setupUrls.join('\nSetup: ')}\nApp: ${result.urls.join('\nApp: ')}\nCertificate: ${result.ca.subject}\nSHA-256: ${result.ca.fingerprint256}\nKeep this window open. Ctrl+C to stop.`);
    await writeFile(join(root,'.local-https','connection.txt'),result.setupUrls.join('\n')+'\n'+result.urls.join('\n'));
    if(process.argv.includes('--open')){const child=spawn('explorer.exe',[`http://127.0.0.1:${result.setup.address().port}/`],{windowsHide:true,detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();}
  }catch(error){console.error(error.message);process.exitCode=1;}
}
