// Loopback UI fixture. Simulates Electron; never launches mining binaries or connects to the fleet.
const http = require("http");
const fs = require("fs");
const path = require("path");
const build = path.join(__dirname, "../build");
const fixture = `
localStorage.removeItem('master-server-bound');
localStorage.setItem('minemaster-miner-state', JSON.stringify({'xmrig-1':{enabled:true},'nanominer-1':{enabled:true}}));
localStorage.setItem('minemaster-config', JSON.stringify({
 'xmrig-1': {engine:'nanominer',pool:'pool.example.test:3333',user:'fixture-account',algorithm:'rx/0',coin:'XMR',threadPercentage:50,version:'fixture-v3'},
 'nanominer-1': {pool:'pool.example.test:4444',user:'fixture-account',algorithm:'etchash',coin:'ETC',rigName:'',gpus:[],version:'fixture-v3'}
}));
const connectedFixture = new URLSearchParams(location.search).get('connected') === '1';
const platform = new URLSearchParams(location.search).get('platform') === 'linux' ? 'linux' : 'win32';
const arch = new URLSearchParams(location.search).get('arch') === 'arm64' ? 'arm64' : 'x64';
const listeners = {}, states = {}, diagnostics = {};
let update = {state:'idle',supported:true,updatedAt:new Date().toISOString()};
let xmrigRepaired = false;
const emit = (name, payload) => (listeners[name] || []).forEach(fn => fn(payload));
const on = name => fn => { (listeners[name] ||= []).push(fn); return () => listeners[name] = listeners[name].filter(f => f !== fn); };
const ready = engine => ({status:'ready',engine,version:engine === 'xmrig'?'6.26.0':engine === 'srbminer'?'3.6.7':'3.10.0',path:'C:/Users/Miner/AppData/Roaming/MineMaster/miners/'+engine+'/'+engine+'.exe',expectedSha256:'a'.repeat(64),message:'Simulated verified upstream executable',observedAt:new Date().toISOString()});
const inspect = engine => engine === 'xmrig' && !xmrigRepaired ? {...ready(engine),status:'unavailable',code:'EPERM',message:'Simulated operating-system block. Review Windows Security Protection History for this exact file.'} : ready(engine);
diagnostics['xmrig-1'] = ready('nanominer');
diagnostics['nanominer-1'] = ready('nanominer');
const info = {hostname:'Workshop rig 07',gpuDetectionStatus:'complete',os:{distro:platform==='linux'?'Linux':'Windows',release:platform==='linux'?'6.8':'11',platform,arch},cpu:{brand:'AMD Ryzen 9 5950X',cores:32,physicalCores:16},memory:{total:34359738368},gpus:[{deviceId:'pci:0000:02:00.0',model:'AMD Radeon RX 6800',vram:16384}]};
const api = {
 platform,arch,getSystemInfo:async()=>info,getCpuStats:async()=>({usage:32,temperature:54,observedAt:Date.now()}),getMemoryStats:async()=>({total:34359738368,used:8589934592,usagePercent:25}),
 getGpuStats:async()=>[{deviceId:'pci:0000:02:00.0',type:'AMD',model:'AMD Radeon RX 6800',temperature:61,usage:98,vramUsed:5120,vramTotal:16384,observedAt:Date.now(),powerWatts:120}],
 getAllMinersStatus:async()=>Object.fromEntries(Object.entries(diagnostics).map(([id,d])=>[id,{running:false,...states[id],diagnostic:d,error:d.status==='unavailable'?d.message:null}])),
 startMiner:async({minerId,minerType,config})=>{
  const engine=config.engine||minerType;
  const diagnostic=diagnostics[minerId]=inspect(engine);
  if(diagnostic.status==='unavailable')return{success:false,error:diagnostic.message,diagnostic};
  const state={running:true,engine,pid:minerType==='xmrig'?1234:5678,runId:Date.now().toString(),startedAt:Date.now(),activeConfig:config,effectiveSettings:minerType==='xmrig'&&engine==='nanominer'?{cpuThreads:16,devFeePercent:2}:null}; states[minerId]=state;
  setTimeout(()=>{
   if(engine==='srbminer') emit('output',{minerId,runId:state.runId,stream:'stdout',data:'SRBMiner-MULTI 3.6.7\\nTotal: '+(minerType==='xmrig'?'7.25 kH/s':'65.00 TH/s')+'\\n'});
   else if(minerType==='xmrig' && engine==='nanominer') {
    emit('output',{minerId,runId:state.runId,stream:'file',observedAt:new Date().toISOString(),data:'nanominer v3.10.0\\nTotal: 72'});
    emit('output',{minerId,runId:state.runId,stream:'stderr',data:'Simulated pool warning\\n'});
    emit('output',{minerId,runId:state.runId,stream:'file',observedAt:new Date().toISOString(),data:'50 H/s\\n'});
   } else emit('output',{minerId,runId:state.runId,stream:'stdout',data:minerType==='xmrig'?'XMRig/6.26.0\\ncpu speed 10s/60s/15m 7250.00 n/a n/a H/s\\n':'nanominer v3.10.0\\nTotal: 61.5 Mh/s\\n'});
  },50);
  return{success:true,...state,diagnostic};
 },
 stopMiner:async({minerId})=>{states[minerId]={running:false};return{success:true};},
 diagnoseMiner:async({minerId,minerType,includeWindows})=>{
  const diagnostic=inspect(minerType);
  if(includeWindows)diagnostic.windows={status:'available',signatureStatus:'NotSigned',checkedAt:new Date().toISOString(),message:'Simulated Windows history. Historical detections do not prove a current block; no match does not prove the file is allowed.',detections:minerType==='xmrig'&&!xmrigRepaired?[{threatName:'Fixture-only detection',resource:diagnostic.path,detectedAt:new Date().toISOString(),actionSuccess:true}]:[]};
  return diagnostics[minerId]=diagnostic;
 },
 repairMiner:async({minerId,minerType})=>{
  if(Object.values(states).some(s=>s.running&&s.engine===minerType))return{success:false,error:'Stop every process using '+minerType+' before repairing its shared files.'};
  if(minerType==='xmrig')xmrigRepaired=true;
  diagnostics[minerId]=ready(minerType);return{success:true,diagnostic:diagnostics[minerId]};
 },
 openDiagnosticFolder:async()=>({success:true}),cancelUpdateInstall:async()=>({success:true}),openProtectionHistory:async()=>{},openFileReview:async()=>{},onMinerOutput:on('output'),onMinerError:on('error'),onMinerClosed:on('closed'),onUpdateStatus:on('update'),getUpdateResumeState:async()=>null,
 getUpdateStatus:async()=>update,checkForUpdate:async()=>{update={state:'downloaded',supported:true,version:'1.4.4',updatedAt:new Date().toISOString()};emit('update',update);return{success:true};},installUpdate:async()=>{update={...update,state:'downloaded',message:'Simulated installer failure; mining can be started again.'};emit('update',update);return{success:false,error:update.message};},
 invoke:async(channel)=>channel==='load-master-config'?{enabled:connectedFixture,host:'127.0.0.1',port:connectedFixture?43188:65534,autoReconnect:true}:channel==='get-mac-address'?'fixture-only':{success:true}
};
window.electronAPI=window.electron=api;
`;
const server = http.createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(fixture);
  }
  const relative = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  const file = path.resolve(build, "." + relative);
  if (!file.startsWith(build + path.sep) && file !== build) {
    res.writeHead(403);
    return res.end();
  }
  if (relative === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(
      fs
        .readFileSync(path.join(build, "index.html"), "utf8")
        .replace("<head>", '<head><script src="/fixture.js"></script>'),
    );
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    "Content-Type",
    {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
    }[path.extname(file)] || "application/octet-stream",
  );
  fs.createReadStream(file).pipe(res);
});
server.listen(
  Number(process.env.CLIENT_PREVIEW_PORT || 4319),
  "127.0.0.1",
  () =>
    console.log(
      "Simulated desktop UI: http://127.0.0.1:" + server.address().port,
    ),
);
