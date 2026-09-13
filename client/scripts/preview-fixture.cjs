// Loopback UI fixture. Simulates Electron; never launches mining binaries or connects to the fleet.
const http = require("http");
const fs = require("fs");
const path = require("path");
const build = path.join(__dirname, "../build");
const fixture = `
localStorage.removeItem('master-server-bound');
localStorage.setItem('minemaster-config', JSON.stringify({
 'xmrig-1': {pool:'pool.example.test:3333',user:'fixture-account',algorithm:'rx/0',coin:'XMR',threadPercentage:50,version:'fixture-v2'},
 'nanominer-1': {pool:'pool.example.test:4444',user:'fixture-account',algorithm:'etchash',coin:'ETC',rigName:'',gpus:[],version:'fixture-v2'}
}));
const listeners = {}, states = {}, diagnostics = {};
const emit = (name, payload) => (listeners[name] || []).forEach(fn => fn(payload));
const on = name => fn => { (listeners[name] ||= []).push(fn); return () => listeners[name] = listeners[name].filter(f => f !== fn); };
const ready = type => ({status:'ready',version:type === 'xmrig'?'6.26.0':'3.10.0',path:'C:/Users/Miner/AppData/Roaming/MineMaster/miners/'+type+'/'+type+'.exe',message:'Verified upstream executable',observedAt:new Date().toISOString()});
diagnostics['xmrig-1'] = {...ready('xmrig'),status:'unavailable',code:'EPERM',message:'The operating system blocked the CPU miner. Review Windows Security Protection History for this exact file.'};
diagnostics['nanominer-1'] = ready('nanominer');
const info = {hostname:'Workshop rig 07',gpuDetectionStatus:'complete',os:{distro:'Windows',release:'11',platform:'win32',arch:'x64'},cpu:{brand:'AMD Ryzen 9 5950X',cores:32,physicalCores:16},memory:{total:34359738368},gpus:[{deviceId:'pci:0000:02:00.0',model:'AMD Radeon RX 6800',vram:16384}]};
const api = {
 getSystemInfo:async()=>info,getCpuStats:async()=>({usage:32,temperature:54,observedAt:Date.now()}),getMemoryStats:async()=>({total:34359738368,used:8589934592,usagePercent:25}),
 getGpuStats:async()=>[{deviceId:'pci:0000:02:00.0',type:'AMD',model:'AMD Radeon RX 6800',temperature:61,usage:98,vramUsed:5120,vramTotal:16384,observedAt:Date.now(),powerWatts:120}],
 getAllMinersStatus:async()=>Object.fromEntries(Object.entries(diagnostics).map(([id,d])=>[id,{running:false,...states[id],diagnostic:d,error:d.status==='unavailable'?d.message:null}])),
 startMiner:async({minerId,minerType,config})=>{ if(diagnostics[minerId]?.status==='unavailable')return{success:false,error:diagnostics[minerId].message,diagnostic:diagnostics[minerId]}; const state={running:true,pid:minerType==='xmrig'?1234:5678,runId:Date.now().toString(),startedAt:Date.now(),activeConfig:config}; states[minerId]=state; setTimeout(()=>emit('output',{minerId,data:minerType==='xmrig'?'XMRig/6.26.0\\nnew job from pool.example.test:3333\\ncpu speed 10s/60s/15m 0.00 n/a n/a H/s\\n':'nanominer v3.10.0\\nTotal: 61.5 Mh/s\\n'}),50);return{success:true,...state,diagnostic:diagnostics[minerId]};},
 stopMiner:async({minerId})=>{states[minerId]={running:false};return{success:true};},
 diagnoseMiner:async({minerId})=>diagnostics[minerId],repairMiner:async({minerId,minerType})=>{diagnostics[minerId]=ready(minerType);return{success:true,diagnostic:diagnostics[minerId]};},
 openProtectionHistory:async()=>{},onMinerOutput:on('output'),onMinerError:on('error'),onMinerClosed:on('closed'),onUpdateStatus:on('update'),getUpdateResumeState:async()=>null,
 getUpdateStatus:async()=>({state:'idle'}),checkForUpdate:async()=>{emit('update',{state:'downloaded',version:'1.2.1'});return{success:true};},installUpdate:async()=>{emit('update',{state:'installing',version:'1.2.1'});return{success:true};},
 invoke:async(channel)=>channel==='load-master-config'?{enabled:false,host:'127.0.0.1',port:65534,autoReconnect:false}:channel==='get-mac-address'?'fixture-only':{success:true}
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
