/* =========================================================================
   병동 (The Ward) — 협동 공포 게임 서버
   Express(정적) + ws(WebSocket). 권위적 적 AI + 방/초대코드 + 스토리.
   ========================================================================= */
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- 유틸 ----------
const MW = 23, MH = 23;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; }
function uid(){ return Math.random().toString(36).slice(2,10); }
function roomCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<5;i++) s+=c[(Math.random()*c.length)|0]; return s;
}

// ---------- 스토리: 발견되는 기록 ----------
const NOTES = [
  { title:'정전 1일차 · 당직 일지',
    body:'오후 11시 14분, 전원이 나갔다. 비상 발전기도 응답하지 않는다.\n관리부는 "외부 정비"라고만 했다. 하지만 정문은 안에서 잠겼다.\n환자 중 일부가… 평소와 다르다. 눈을 마주치지 않으려 한다.' },
  { title:'격리 병동 · 간호 기록',
    body:'B동 환자 6명에게서 같은 증상. 동공 확장, 통증 무반응, 야간에 배회.\n진정제가 듣지 않는다. 한 명은 벽을 향해 몇 시간째 서 있다.\n원장은 "B-7 임상은 예정대로 진행한다"고 통보했다.' },
  { title:'찢어진 처방전',
    body:'…B-7: 의식 억제 신경제. 3상 미승인. 동의서 없음.\n피험자 사망 시 "기저질환"으로 처리할 것.\n— 이건 치료가 아니야. 우리가 무슨 짓을 한 거지?' },
  { title:'봉쇄 프로토콜 메모',
    body:'코드 블랙. B-7 피험자 전원 통제 불능.\n해결책: 전 구역 정전 → 봉쇄문 강제 잠금 → 외부 차단.\n발전기 퓨즈 3기를 분리해 두었다. 누구도 나갈 수 없도록.' },
  { title:'직원 휴게실 · 벽의 글씨',
    body:'손전등을 끄고 다녀. 빛을 보면 따라온다.\n뛰지 마. 소리를 들어.\n— 우리 중 셋이 어제 사라졌다. 비명도 없이.' },
  { title:'마지막 음성 메모 · 전사(轉寫)',
    body:'누가 이걸 듣는다면. 퓨즈를 다시 끼워. 봉쇄문이 열려.\n저들은 환자가 아니야. 우리가 만든 거야. B-7이.\n밖으로 나가서… 이걸 세상에 알려줘. 부탁이야. 제발—' }
];

// ---------- 맵 생성 ----------
function generateMaze(){
  const map = Array.from({length:MH}, ()=>Array(MW).fill(1));
  const stack=[[1,1]]; map[1][1]=0;
  const dirs=[[0,-2],[0,2],[-2,0],[2,0]];
  while(stack.length){
    const [cx,cy]=stack[stack.length-1]; const opts=[];
    for(const [dx,dy] of dirs){ const nx=cx+dx,ny=cy+dy;
      if(nx>0&&nx<MW-1&&ny>0&&ny<MH-1&&map[ny][nx]===1) opts.push([dx,dy]); }
    if(opts.length){ const [dx,dy]=opts[(Math.random()*opts.length)|0];
      map[cy+dy/2][cx+dx/2]=0; map[cy+dy][cx+dx]=0; stack.push([cx+dx,cy+dy]); }
    else stack.pop();
  }
  for(let r=0;r<6;r++){ const rx=2+((Math.random()*(MW-6))|0),ry=2+((Math.random()*(MH-6))|0);
    const rw=2+((Math.random()*2)|0),rh=2+((Math.random()*2)|0);
    for(let y=ry;y<Math.min(ry+rh,MH-1);y++)for(let x=rx;x<Math.min(rx+rw,MW-1);x++)map[y][x]=0; }
  for(let i=0;i<14;i++){ const x=2+((Math.random()*(MW-4))|0),y=2+((Math.random()*(MH-4))|0);
    if(map[y][x]===1){ const h=map[y][x-1]===0&&map[y][x+1]===0,v=map[y-1][x]===0&&map[y+1][x]===0; if(h||v)map[y][x]=0; } }
  return map;
}
function bfsFrom(map,sx,sy){
  const dist=Array.from({length:MH},()=>Array(MW).fill(-1));
  const q=[[sx,sy]]; dist[sy][sx]=0; let head=0;
  while(head<q.length){ const [x,y]=q[head++]; const d=dist[y][x];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<MW&&ny>=0&&ny<MH&&map[ny][nx]===0&&dist[ny][nx]<0){ dist[ny][nx]=d+1; q.push([nx,ny]); } } }
  return dist;
}
function bfsPath(map,sx,sy,tx,ty){
  if(sx===tx&&sy===ty) return [];
  const prev=Array.from({length:MH},()=>Array(MW).fill(null));
  const seen=Array.from({length:MH},()=>Array(MW).fill(false));
  const q=[[sx,sy]]; seen[sy][sx]=true; let head=0;
  while(head<q.length){ const [x,y]=q[head++];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<MW&&ny>=0&&ny<MH&&map[ny][nx]===0&&!seen[ny][nx]){
        seen[ny][nx]=true; prev[ny][nx]=[x,y];
        if(nx===tx&&ny===ty){ const p=[]; let cur=[tx,ty];
          while(cur&&!(cur[0]===sx&&cur[1]===sy)){ p.push(cur); cur=prev[cur[1]][cur[0]]; }
          p.reverse(); return p; }
        q.push([nx,ny]); } } }
  return [];
}
function losMap(map,ax,ay,bx,by){
  const dx=bx-ax, dy=by-ay; const d=Math.hypot(dx,dy); const steps=Math.ceil(d*8);
  for(let i=1;i<steps;i++){ const t=i/steps; const mx=Math.floor(ax+dx*t), my=Math.floor(ay+dy*t);
    if(mx<0||mx>=MW||my<0||my>=MH||map[my][mx]!==0) return false; }
  return true;
}

// =========================================================================
//  방 (Room)
// =========================================================================
class Room {
  constructor(code){
    this.code = code;
    this.players = new Map();   // id -> player
    this.hostId = null;
    this.state = 'lobby';       // lobby | playing | ended
    this.time = 0;
    this.notesRead = new Set(); // 방 전체가 읽은 노트 id
  }
  alivePlayers(){ return [...this.players.values()].filter(p=>p.alive && !p.escaped); }
  count(){ return this.players.size; }

  addPlayer(ws, name){
    const id = ws.pid;
    const p = { id, ws, name: (name||'생존자').slice(0,12), ready:false,
      x:1.5, y:1.5, dirX:1, dirY:0, light:0, running:false, pitch:0,
      alive:true, escaped:false, crossActiveT:0, notes:new Set() };
    this.players.set(id, p);
    if(!this.hostId) this.hostId = id;
    ws.room = this;
  }
  removePlayer(id){
    this.players.delete(id);
    if(id===this.hostId){ const n=[...this.players.keys()][0]; this.hostId = n||null; }
    if(this.players.size===0) rooms.delete(this.code);
    else { this.sendLobby(); if(this.state==='playing' && this.alivePlayers().length===0) this.end(); }
  }

  sendLobby(){
    const list = [...this.players.values()].map(p=>({ id:p.id, name:p.name, host:p.id===this.hostId }));
    this.broadcast({ t:'lobby', code:this.code, players:list, hostId:this.hostId });
  }

  buildLevel(){
    const map = generateMaze();
    this.map = map;
    const dist = bfsFrom(map,1,1);
    const cells=[];
    for(let y=0;y<MH;y++)for(let x=0;x<MW;x++) if(map[y][x]===0&&dist[y][x]>=0) cells.push({x,y,d:dist[y][x]});
    cells.sort((a,b)=>b.d-a.d);
    const far=cells[0];
    this.exitPos={ x:far.x, y:far.y };
    const used=new Set([`${far.x},${far.y}`,'1,1']);

    // 퓨즈 3
    this.fuses=[]; let fid=0;
    const farCells=shuffle(cells.filter(c=>c.d>8));
    for(const c of farCells){ if(this.fuses.length>=3) break;
      let ok=true; for(const f of this.fuses){ if(Math.abs(f.gx-c.x)+Math.abs(f.gy-c.y)<6) ok=false; }
      if(ok&&!used.has(`${c.x},${c.y}`)){ this.fuses.push({id:fid++,gx:c.x,gy:c.y,x:c.x+0.5,y:c.y+0.5,taken:false}); used.add(`${c.x},${c.y}`); } }
    while(this.fuses.length<3&&farCells.length){ const c=farCells.pop();
      if(!used.has(`${c.x},${c.y}`)){ this.fuses.push({id:fid++,gx:c.x,gy:c.y,x:c.x+0.5,y:c.y+0.5,taken:false}); used.add(`${c.x},${c.y}`); } }

    // 배터리 6
    this.batteries=[]; let bid=0;
    const mid=shuffle(cells.filter(c=>c.d>5 && c.d<dist[far.y][far.x]));
    for(let i=0;i<6&&i<mid.length;i++){ const c=mid[i];
      if(!used.has(`${c.x},${c.y}`)){ this.batteries.push({id:bid++,x:c.x+0.5,y:c.y+0.5,taken:false}); used.add(`${c.x},${c.y}`); } }

    // 노트 (스토리) — 분산 배치
    this.notes=[]; const noteCells=shuffle(cells.filter(c=>c.d>3));
    for(let i=0;i<NOTES.length;i++){ 
      let placed=null;
      for(const c of noteCells){ if(used.has(`${c.x},${c.y}`)) continue;
        let ok=true; for(const n of this.notes){ if(Math.abs(n.gx-c.x)+Math.abs(n.gy-c.y)<4) ok=false; }
        if(ok){ placed=c; break; } }
      if(placed){ this.notes.push({id:i,gx:placed.x,gy:placed.y,x:placed.x+0.5,y:placed.y+0.5}); used.add(`${placed.x},${placed.y}`); }
    }

    // 적 2 (먼 칸)
    this.enemies=[];
    const es=shuffle(cells.filter(c=>c.d>10));
    for(let i=0;i<2 && i<es.length;i++){ const c=es[Math.min(i*2,es.length-1)];
      this.enemies.push({ x:c.x+0.5, y:c.y+0.5, gx:c.x, gy:c.y, state:'wander',
        path:[], repathT:0, lastSeen:null, searchT:0, fleeT:0, speed:1.15, growlT:rand(2,5), targetId:null }); }

    this.fusesCollected=0; this.exitActive=false; this.time=0; this.notesRead=new Set();
    // 플레이어 초기화
    let si=0; const spawns=[[1.5,1.5],[1.5,2.5],[2.5,1.5],[2.5,2.5],[1.5,3.5]];
    for(const p of this.players.values()){
      const s=spawns[si++%spawns.length];
      p.x=s[0]; p.y=s[1]; p.dirX=1; p.dirY=0; p.light=0; p.running=false; p.pitch=0;
      p.alive=true; p.escaped=false; p.crossActiveT=0; p.notes=new Set();
    }
  }

  start(){
    this.buildLevel();
    this.state='playing';
    for(const p of this.players.values()){
      this.send(p,{ t:'start', map:this.map, exitPos:this.exitPos,
        fuses:this.fuses.map(f=>({id:f.id,x:f.x,y:f.y,taken:f.taken})),
        batteries:this.batteries.map(b=>({id:b.id,x:b.x,y:b.y,taken:b.taken})),
        notes:this.notes.map(n=>({id:n.id,x:n.x,y:n.y})),
        you:{ id:p.id, x:p.x, y:p.y },
        players:[...this.players.values()].map(q=>({id:q.id,name:q.name})) });
    }
  }

  // ----- 서버 게임 루프 -----
  update(dt){
    this.time+=dt;
    for(const p of this.players.values()) p.crossActiveT=Math.max(0,p.crossActiveT-dt);

    for(const e of this.enemies){
      // 감지: 살아있는 플레이어 중 시야+거리 안, 가장 가까운
      let target=null, tD=Infinity;
      for(const p of this.alivePlayers()){
        const d=Math.hypot(p.x-e.x,p.y-e.y);
        let range = p.light===2?9 : p.light===1?6 : 3.5;
        if(p.running) range+=3.5;
        if(d<range && d<tD && losMap(this.map,e.x,e.y,p.x,p.y)){ target=p; tD=d; }
      }
      if(target && e.state!=='flee'){ e.lastSeen={x:target.x,y:target.y}; e.searchT=4; e.state='chase'; e.targetId=target.id; }

      if(e.state==='chase'){
        const t=e.lastSeen||{x:e.x,y:e.y};
        e.repathT-=dt;
        if(e.repathT<=0||e.path.length===0){ e.path=bfsPath(this.map,e.gx,e.gy,Math.floor(t.x),Math.floor(t.y)); e.repathT=0.4; }
        e.speed=1.85;
        if(!target){ e.searchT-=dt; if(e.searchT<=0){ e.state='wander'; e.lastSeen=null; e.path=[]; } }
      } else if(e.state==='wander'){
        e.speed=1.15;
        if(e.path.length===0){ const opts=[];
          for(const [dx,dy] of shuffle([[1,0],[-1,0],[0,1],[0,-1]])){ const nx=e.gx+dx,ny=e.gy+dy;
            if(nx>=0&&nx<MW&&ny>=0&&ny<MH&&this.map[ny][nx]===0) opts.push([nx,ny]); }
          if(opts.length) e.path=[opts[0]]; }
      } else if(e.state==='flee'){
        e.fleeT-=dt; e.speed=2.1;
        if(e.path.length===0){ let best=null,bd=-1;
          const ref=this.nearestPlayer(e); 
          for(const [dx,dy] of shuffle([[1,0],[-1,0],[0,1],[0,-1]])){ const nx=e.gx+dx,ny=e.gy+dy;
            if(nx>=0&&nx<MW&&ny>=0&&ny<MH&&this.map[ny][nx]===0){ const dd=ref?Math.hypot(nx-ref.x,ny-ref.y):Math.random(); if(dd>bd){bd=dd;best=[nx,ny];} } }
          if(best) e.path=[best]; }
        if(e.fleeT<=0){ e.state='wander'; e.path=[]; }
      }

      // 경로 이동
      if(e.path.length){
        const n=e.path[0]; const cx=n[0]+0.5, cy=n[1]+0.5;
        const dx=cx-e.x, dy=cy-e.y; const d=Math.hypot(dx,dy); const step=e.speed*dt;
        if(d<=step){ e.x=cx; e.y=cy; e.gx=n[0]; e.gy=n[1]; e.path.shift(); }
        else { e.x+=dx/d*step; e.y+=dy/d*step; }
      }

      // 잡힘
      for(const p of this.alivePlayers()){
        if(p.crossActiveT>0) continue;
        if(Math.hypot(p.x-e.x,p.y-e.y)<0.45){ this.kill(p); }
      }
    }

    // 종료: 살아있는 사람 없음
    if(this.state==='playing' && this.alivePlayers().length===0) this.end();
  }
  nearestPlayer(e){ let best=null,bd=Infinity; for(const p of this.alivePlayers()){ const d=Math.hypot(p.x-e.x,p.y-e.y); if(d<bd){bd=d;best=p;} } return best; }

  kill(p){
    if(!p.alive||p.escaped) return;
    p.alive=false;
    this.send(p,{ t:'event', kind:'death' });
    this.broadcast({ t:'event', kind:'playerDown', id:p.id, name:p.name });
  }

  useCross(p){
    if(p.crossActiveT>0 || !p.alive) return;
    p.crossActiveT=2.6;
    let n=0;
    for(const e of this.enemies){
      const d=Math.hypot(e.x-p.x,e.y-p.y);
      if(d<6.5 && losMap(this.map,p.x,p.y,e.x,e.y)){ e.state='flee'; e.fleeT=3.4; e.path=[]; n++; }
    }
    this.send(p,{ t:'event', kind:'cross', hit:n });
  }

  tryPickup(p, kind, id){
    if(!p.alive) return;
    if(kind==='fuse'){
      const f=this.fuses.find(f=>f.id===id&&!f.taken);
      if(f && Math.hypot(f.x-p.x,f.y-p.y)<0.8){ f.taken=true; this.fusesCollected++;
        this.broadcast({ t:'event', kind:'fuse', count:this.fusesCollected, by:p.name });
        if(this.fusesCollected>=3){ this.exitActive=true; this.broadcast({ t:'event', kind:'power' }); } }
    } else if(kind==='battery'){
      const b=this.batteries.find(b=>b.id===id&&!b.taken);
      if(b && Math.hypot(b.x-p.x,b.y-p.y)<0.8){ b.taken=true;
        this.send(p,{ t:'event', kind:'battery' }); 
        this.broadcast({ t:'event', kind:'batteryTaken', id:b.id }); }
    }
  }

  readNote(p, id){
    const n=this.notes.find(n=>n.id===id);
    if(!n || Math.hypot(n.x-p.x,n.y-p.y)>0.9) return;
    p.notes.add(id); this.notesRead.add(id);
    const data=NOTES[id];
    this.send(p,{ t:'note', id, title:data.title, body:data.body, read:this.notesRead.size, total:NOTES.length });
  }

  tryExit(p){
    if(!p.alive || p.escaped || !this.exitActive) return;
    if(Math.hypot((this.exitPos.x+0.5)-p.x,(this.exitPos.y+0.5)-p.y)<0.95){
      p.escaped=true; p.alive=false;
      this.broadcast({ t:'event', kind:'escaped', id:p.id, name:p.name });
      if(this.alivePlayers().length===0) this.end();
    }
  }

  end(){
    if(this.state==='ended') return;
    this.state='ended';
    const total=[...this.players.values()];
    const escaped=total.filter(p=>p.escaped);
    const read=this.notesRead.size;
    let ending = this.computeEnding(escaped.length, read, total.length);
    this.broadcast({ t:'ended', ending, escaped:escaped.map(p=>p.name),
      survivors:escaped.length, totalPlayers:total.length, notesRead:read, notesTotal:NOTES.length });
  }

  computeEnding(survivors, notesRead, totalPlayers){
    if(survivors===0){
      return { code:'death', title:'아무도 나오지 못했다',
        text:'봉쇄문은 끝내 열리지 않았다. 며칠 뒤, 실종자 명단에 너희의 이름이 조용히 추가되었다.\n병동은 또 하나의 비밀을 삼켰고, B-7의 진실은 어둠 속에 묻혔다.' };
    }
    if(notesRead>=NOTES.length){
      return { code:'true', title:'진실을 들고 나오다',
        text:`${survivors}명이 차가운 새벽 공기 속으로 걸어나왔다. 손에는 B-7의 모든 기록이 있다.\n병원은 다음 날 "화재로 전소"되었다고 발표됐다. 하지만 너희가 가진 증거는 사라지지 않는다.\n몇 달 뒤, 한 탐사보도가 세상을 뒤흔든다. 그것이 끝의 시작이었다.` };
    }
    if(notesRead>=3){
      return { code:'partial', title:'조각난 진실',
        text:`${survivors}명이 살아 돌아왔다. 무슨 일이 있었는지 절반쯤은 알 것 같다.\n경찰은 "가스 누출 사고"라 했고, 너희의 증언은 기록되지 않았다.\n밤마다 그 빛나는 눈이 떠오른다. 아직 그 안에 남아있는 무언가가.` };
    }
    return { code:'escape', title:'살아남았다, 그뿐',
      text:`${survivors}명이 탈출했다. 하지만 그곳에서 무슨 일이 있었는지는 끝내 알 수 없었다.\n악몽은 설명되지 않은 채로 남았고, 너희는 다시는 그 일을 입에 담지 않았다.` };
  }

  // ----- 스냅샷 (20Hz 방송) -----
  snapshot(){
    return { t:'snap',
      players:[...this.players.values()].map(p=>({ id:p.id, name:p.name, x:p.x, y:p.y,
        dx:p.dirX, dy:p.dirY, light:p.light, alive:p.alive, escaped:p.escaped, cross:p.crossActiveT>0 })),
      enemies:this.enemies?this.enemies.map(e=>({ x:e.x, y:e.y, st:e.state })):[],
      fusesCollected:this.fusesCollected||0, exitActive:!!this.exitActive };
  }

  send(p, obj){ try{ if(p.ws.readyState===1) p.ws.send(JSON.stringify(obj)); }catch(e){} }
  broadcast(obj){ const s=JSON.stringify(obj); for(const p of this.players.values()){ try{ if(p.ws.readyState===1) p.ws.send(s); }catch(e){} } }
}

// =========================================================================
//  연결 / 메시지 처리
// =========================================================================
const rooms = new Map();

wss.on('connection', (ws)=>{
  ws.pid = uid();
  ws.isAlive = true;
  ws.on('pong', ()=>{ ws.isAlive=true; });

  ws.on('message', (raw)=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    handle(ws, m);
  });
  ws.on('close', ()=>{ if(ws.room) ws.room.removePlayer(ws.pid); });
  ws.on('error', ()=>{});
});

function handle(ws, m){
  switch(m.t){
    case 'create': {
      let code; do{ code=roomCode(); }while(rooms.has(code));
      const room=new Room(code); rooms.set(code, room);
      room.addPlayer(ws, m.name);
      ws.send(JSON.stringify({ t:'created', code, id:ws.pid }));
      room.sendLobby();
      break;
    }
    case 'join': {
      const room=rooms.get((m.code||'').toUpperCase());
      if(!room){ ws.send(JSON.stringify({ t:'error', msg:'존재하지 않는 방 코드입니다.' })); return; }
      if(room.state!=='lobby'){ ws.send(JSON.stringify({ t:'error', msg:'이미 시작된 게임입니다.' })); return; }
      if(room.count()>=5){ ws.send(JSON.stringify({ t:'error', msg:'방이 가득 찼습니다 (최대 5명).' })); return; }
      room.addPlayer(ws, m.name);
      ws.send(JSON.stringify({ t:'joined', code:room.code, id:ws.pid }));
      room.sendLobby();
      break;
    }
    case 'solo': {
      let code; do{ code=roomCode(); }while(rooms.has(code));
      const room=new Room(code); rooms.set(code, room);
      room.addPlayer(ws, m.name);
      ws.send(JSON.stringify({ t:'created', code, id:ws.pid, solo:true }));
      room.start();
      break;
    }
    case 'start': {
      const room=ws.room;
      if(room && room.hostId===ws.pid && room.state==='lobby'){ room.start(); }
      break;
    }
    case 'input': {
      const room=ws.room; if(!room||room.state!=='playing') return;
      const p=room.players.get(ws.pid); if(!p||!p.alive) return;
      p.x=m.x; p.y=m.y; p.dirX=m.dx; p.dirY=m.dy;
      p.light=m.light|0; p.running=!!m.running; p.pitch=m.pitch||0;
      break;
    }
    case 'pickup': { const room=ws.room; if(room) room.tryPickup(room.players.get(ws.pid), m.kind, m.id); break; }
    case 'note':   { const room=ws.room; if(room) room.readNote(room.players.get(ws.pid), m.id); break; }
    case 'exit':   { const room=ws.room; if(room) room.tryExit(room.players.get(ws.pid)); break; }
    case 'cross':  { const room=ws.room; if(room) room.useCross(room.players.get(ws.pid)); break; }
    case 'again':  { // 종료 후 다시 (방장만 재시작)
      const room=ws.room;
      if(room && room.hostId===ws.pid){ room.start(); }
      break;
    }
  }
}

// 끊긴 연결 정리 (핑/퐁)
setInterval(()=>{
  wss.clients.forEach(ws=>{
    if(ws.isAlive===false){ if(ws.room) ws.room.removePlayer(ws.pid); return ws.terminate(); }
    ws.isAlive=false; try{ ws.ping(); }catch(e){}
  });
}, 30000);

// 서버 게임 루프 (20Hz): 적 AI + 스냅샷 방송
let last=Date.now();
setInterval(()=>{
  const now=Date.now(); let dt=(now-last)/1000; last=now; if(dt>0.1) dt=0.1;
  for(const room of rooms.values()){
    if(room.state==='playing') room.update(dt);
    if(room.state==='playing') room.broadcast(room.snapshot());
  }
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`[병동] 서버 실행 중 · 포트 ${PORT}`));
