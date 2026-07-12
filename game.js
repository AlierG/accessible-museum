/* =========================================================================
 * game.js — 有障碍博物馆：游戏引擎 + 界面
 * =========================================================================
 * 组成：
 *   A. 配置/卡牌的加载与保存（localStorage，可编辑）
 *   B. 游戏状态与核心规则（阶段、顺位、移动、抽卡、上下楼、胜负）
 *   C. 渲染（地图、进度条、牌堆、玩家面板、日志）
 *   D. 交互（点击房间移动、抽卡结算、弹窗）
 *   E. 联机接线（主机权威）
 *   F. 配置编辑器 & 规则说明书
 * ========================================================================= */

'use strict';

/* ============ A. 配置加载 / 保存 ============ */
const LS_KEY = 'accmuseum_config_v1';

function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

function loadData(){
  const def = deepClone(window.GAME_DEFAULTS);
  try{
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if(saved && saved.config) return saved;
  }catch(e){}
  return def;
}
function saveData(data){
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}
function resetData(){
  localStorage.removeItem(LS_KEY);
  return deepClone(window.GAME_DEFAULTS);
}

let DATA = loadData();     // {config, cards, activities}
let CFG  = DATA.config;    // 快捷引用

/* ============ 工具 ============ */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function el(tag, cls, html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function playerById(id){ return G.players.find(p=>p.id===id); }
function roomDef(rid){ return CFG.rooms[rid]; }

/* 把一张事件卡的 effect 归一化为对某玩家类型的 {auto,stam,joy} */
function effectFor(effect, ptype){
  if(!effect) return {auto:0,stam:0,joy:0};
  if(effect.wheelchair || effect.blind){
    const e = effect[ptype] || {};
    return { auto:e.auto||0, stam:e.stam||0, joy:e.joy||0 };
  }
  return { auto:effect.auto||0, stam:effect.stam||0, joy:effect.joy||0 };
}
function sumEffects(list){ return list.reduce((a,e)=>({auto:a.auto+e.auto,stam:a.stam+e.stam,joy:a.joy+e.joy}),{auto:0,stam:0,joy:0}); }

/* ============ 音效（WebAudio 合成，无需外部文件） ============ */
const SFX = {
  ctx:null, muted:false,
  ensure(){ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return this.ctx; },
  tone(freq, dur, type, gain, delay){
    if(this.muted) return;
    const ctx=this.ensure(); if(!ctx) return;
    const t0=ctx.currentTime+(delay||0);
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type||'sine'; o.frequency.setValueAtTime(freq,t0);
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(gain||0.15,t0+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0+dur+0.02);
  },
  move(){ this.tone(320,0.12,'triangle',0.12); },
  draw(){ this.tone(520,0.08,'square',0.08); this.tone(660,0.08,'square',0.08,0.06); },
  good(){ this.tone(523,0.12,'sine',0.16); this.tone(784,0.16,'sine',0.16,0.1); },
  bad(){ this.tone(300,0.18,'sawtooth',0.14); this.tone(180,0.22,'sawtooth',0.14,0.12); },
  complete(){ [523,659,784,1047].forEach((f,i)=>this.tone(f,0.18,'sine',0.16,i*0.09)); },
  win(){ [523,659,784,1047,1319].forEach((f,i)=>this.tone(f,0.25,'triangle',0.18,i*0.12)); },
};

/* ============ 属性变化飘字动画 ============ */
// 在某玩家的地图 token 上方飘出 自主/体力/愉悦 的增减
function floatStatChange(playerId, delta){
  const parts=[];
  if(delta.auto) parts.push({k:'自主',v:delta.auto,c:'#7a5c2e'});
  if(delta.stam) parts.push({k:'体力',v:delta.stam,c:'#2f6fd0'});
  if(delta.joy)  parts.push({k:'愉悦',v:delta.joy,c:'#c0397a'});
  if(!parts.length) return;
  const tokenEl=document.querySelector(`.token[data-pid="${playerId}"]`);
  const stage=document.getElementById('mapStage');
  if(!tokenEl||!stage) return;
  const sr=stage.getBoundingClientRect(), tr=tokenEl.getBoundingClientRect();
  // 多个属性同时变化时，垂直堆叠 + 依次延迟，避免文字互相遮挡
  const cx = tr.left-sr.left+tr.width/2;
  const cy = tr.top-sr.top;
  parts.forEach((pt,i)=>{
    const f=document.createElement('div');
    f.className='float-stat';
    f.style.color=pt.c;
    f.textContent=`${pt.k}${pt.v>=0?'+':''}${pt.v}`;
    f.style.left=cx+'px';
    f.style.top=(cy - i*20)+'px';   // 每条上移一行，堆叠不重叠
    f.style.animationDelay=(i*0.14)+'s';
    stage.appendChild(f);
    setTimeout(()=>f.remove(),1700+i*160);
  });
}
// 完成任务打勾动画
function celebrateFinish(playerId){
  const tokenEl=document.querySelector(`.token[data-pid="${playerId}"]`);
  const stage=document.getElementById('mapStage');
  if(!tokenEl||!stage) return;
  const sr=stage.getBoundingClientRect(), tr=tokenEl.getBoundingClientRect();
  const c=document.createElement('div');
  c.className='finish-burst'; c.textContent='✔';
  c.style.left=(tr.left-sr.left+tr.width/2)+'px';
  c.style.top=(tr.top-sr.top+tr.height/2)+'px';
  stage.appendChild(c);
  setTimeout(()=>c.remove(),1400);
}

/* ============ B. 游戏状态 ============ */
let G = null;   // 当前游戏状态（房主权威；客人只读渲染）

function freshDecks(){
  // 为每种牌堆建立洗好的抽牌堆（记录索引，抽完自动重洗）
  const mk = arr => shuffle(arr.map((_,i)=>i));
  return {
    toilet_seat:  mk(DATA.cards.toilet_seat),
    toilet_sink:  mk(DATA.cards.toilet_sink),
    toilet_extra: mk(DATA.cards.toilet_extra),
    gallery:      mk(DATA.cards.gallery),
    lift:         mk(DATA.cards.lift),
    stairs:       mk(DATA.cards.stairs),
  };
}
function drawIndex(deckName){
  if(!G.decks[deckName] || G.decks[deckName].length===0){
    G.decks[deckName] = shuffle(DATA.cards[deckName].map((_,i)=>i));
  }
  return G.decks[deckName].shift();
}

function newGame(){
  const players = deepClone(CFG.players).map(p=>({
    ...p,
    auto: CFG.rules.startAuto,
    stam: CFG.rules.startStam,
    joy:  CFG.rules.startJoy,
    room: 'lobby',
    transit: null,     // 上下楼通行状态 {dir:'up'|'down'}
    visits: { hall1:0, hall2:0, hall3:0, activity:0, toilet:0 }, // 任务计数
    finished: false,   // 已完成参观任务（可加入最终比较）
    finishRank: null,  // 第几个完成（0-based），用于先后奖励
    pendingRelocate: false, // 完成后本回合仍占位，下次轮到才移往大厅
  }));

  // 开场随机回合顺序 + 先后手体力奖励
  const order = shuffle(players.map(p=>p.id));
  order.forEach((pid,i)=>{
    const p = players.find(x=>x.id===pid);
    p.stam += (CFG.rules.turnOrderStamBonus[i]||0);
  });

  G = {
    players,
    phaseIndex: 0,               // 0..4
    order,                       // 当前阶段行动顺位（玩家id数组）
    prevOrder: order.slice(),    // 上一阶段顺序（体力相同时保持）
    round: 0,                    // 本阶段第几轮(0/1)，每阶段每人行动2次
    turnPos: 0,                  // 当前轮到 order 中的第几个
    acted: {},                   // 本轮已行动的玩家id -> true
    decks: freshDecks(),
    activity: null,              // 本阶段活动区的活动卡(含 index)
    lastCards: {},               // 各牌堆最近抽到的卡(展示用)
    log: [],
    over: false,
    pendingStair: null,          // 上下楼选择的暂存
  };
  startPhase(true);
  // 初始化 FX 快照，避免开局第一次渲染就飘一堆字
  _statSnap={}; _finSnap={};
  G.players.forEach(p=>{ _statSnap[p.id]={auto:p.auto,stam:p.stam,joy:p.joy}; _finSnap[p.id]=false; });
  logMsg('sys', `游戏开始！随机先手顺序：${order.map(id=>playerById(id).name).join(' → ')}`);
  pushAndRender();
}

/* 开始一个阶段 */
function startPhase(isFirst){
  const rules = CFG.rules;
  // 每阶段抽活动卡
  const aIdx = Math.floor(Math.random()*DATA.activities.length);
  G.activity = { ...deepClone(DATA.activities[aIdx]), index:aIdx };

  if(!isFirst){
    // 非首阶段：每人 +体力
    G.players.forEach(p=>{ if(!p.finished) p.stam += rules.stamPerPhase; });
    // 按体力从高到低排顺位；相同则沿用上一阶段顺序
    const prev = G.prevOrder;
    G.order = G.players.map(p=>p.id).sort((a,b)=>{
      const pa=playerById(a), pb=playerById(b);
      if(pb.stam!==pa.stam) return pb.stam-pa.stam;
      return prev.indexOf(a)-prev.indexOf(b);
    });
    logMsg('sys', `【${CFG.phases[G.phaseIndex]}】开始。每人+${rules.stamPerPhase}体力。顺位：${G.order.map(id=>playerById(id).name).join(' → ')}`);
  }
  G.prevOrder = G.order.slice();
  G.round = 0;
  G.turnPos = 0;
  G.acted = {};
  skipFinishedToNext();
}

/* 当前应行动的玩家id（跳过已完成任务的玩家） */
function currentPlayerId(){
  if(!G || G.over) return null;
  return G.order[G.turnPos] || null;
}
function skipFinishedToNext(){
  // 跳过已完成参观任务的玩家（他们不再行动）；
  // 但轮到他的这一次，先把「占位中」的完成者送到大厅结算并腾出位置。
  let guard=0;
  while(G.turnPos < G.order.length && playerById(G.order[G.turnPos]).finished){
    relocateFinishedIfDue(playerById(G.order[G.turnPos]));
    G.turnPos++;
    if(++guard>20) break;
  }
}

/* 完成者「下次轮到他」时移动到大厅等待（不减属性），腾出原占位 */
function relocateFinishedIfDue(p){
  if(p.finished && p.pendingRelocate){
    p.pendingRelocate = false;
    p.room = 'lobby'; p.transit = null;
    logMsg('sys', `${p.name} 移动到【大厅】，等待其他小伙伴完成参观。`);
  }
}

/* 推进到下一位/下一轮/下一阶段 */
function advanceTurn(){
  const actedId = G.order[G.turnPos];
  if(actedId) G.acted[actedId]=true;
  G.turnPos++;
  skipFinishedToNext();

  if(G.turnPos >= G.order.length){
    // 本轮结束
    if(G.round === 0){
      G.round = 1;
      G.turnPos = 0;
      G.acted = {};
      skipFinishedToNext();
      logMsg('sys', `【${CFG.phases[G.phaseIndex]}】第二轮行动开始。`);
    }else{
      // 阶段结束
      if(G.phaseIndex >= CFG.phases.length-1){
        endGame();
        return;
      }
      G.phaseIndex++;
      startPhase(false);
    }
  }
  // 若所有人都已完成任务，直接结束
  if(!G.over && G.players.every(p=>p.finished)){ endGame(); return; }
  // 新玩家回合开始：处理下楼到达大厅
  if(!G.over) onTurnBegin();
}

/* ============ 移动 & 上下楼判定 ============ */

// 返回从 from 到 to 是否相邻可直接走
function isAdjacent(from,to){ return (CFG.adjacency[from]||[]).includes(to); }

// 房间当前占用人数（不含指定玩家自己）
function occupancy(rid, exceptId){
  return G.players.filter(p=>p.room===rid && p.id!==exceptId).length;
}
function capacityOf(rid){
  if(rid==='activity') return G.activity ? G.activity.capacity : CFG.rooms.activity.capacity;
  return CFG.rooms[rid].capacity;
}
function roomIsFull(rid, forId){ return occupancy(rid,forId) >= capacityOf(rid); }

/* ============ 抽卡结算 ============ */

// 结算一次房间访问：返回 {ok, effects, over(体力不足被送休息室)}
function resolveRoomVisit(p, rid){
  const def = roomDef(rid);
  const ptype = p.type;
  let drawn = [];        // 展示用卡列表
  let total = {auto:0,stam:0,joy:0};

  if(rid==='toilet'){
    ['toilet_seat','toilet_sink','toilet_extra'].forEach(dn=>{
      const idx = drawIndex(dn);
      const card = DATA.cards[dn][idx];
      G.lastCards[dn] = {idx, ...card};
      const e = effectFor(card.effect, ptype);
      drawn.push({deck:dn, card, eff:e});
      total = sumEffects([total,e]);
    });
  }else if(def.needsCard==='gallery' || def.needsCard==='lift' || def.needsCard==='stairs'){
    const dn = def.needsCard;
    const idx = drawIndex(dn);
    const card = DATA.cards[dn][idx];
    G.lastCards[dn] = {idx, ...card};
    const e = effectFor(card.effect, ptype);
    drawn.push({deck:dn, card, eff:e});
    total = e;
  }
  // 无需抽卡的房间(大厅/休息/活动)：total 保持 0

  // 加上房间固定奖励（reward 也可能按类型不同，这里统一走 effectFor）
  const reward = effectFor(def.reward, ptype);

  return { drawn, total, reward, def };
}

/* ============ 移动费用（按距离表） ============ */
function moveCostBetween(from, to){
  const m = CFG.moveCost[from];
  return (m && (to in m)) ? m[to] : null;   // 不在表里 = 无法直接前往（如楼上/过路点）
}
/* 某玩家当前可点击前往的目的地：{roomId: true|'full'|'ascend'} */
function reachableDests(p){
  const out = {};
  if(p.transit) return out;               // 通行中不能再移动
  if(p.room==='hall3') return out;         // 楼上离开用「下楼」按钮
  const m = CFG.moveCost[p.room] || {};
  Object.keys(m).forEach(to=>{
    out[to] = (CFG.rooms[to].capacity<99 && roomIsFull(to,p.id)) ? 'full' : true;
  });
  out.hall3 = roomIsFull('hall3', p.id) ? 'full' : 'ascend';  // 楼上：点击后选择上楼方式
  return out;
}

/* ============ 执行一次玩家行动（房主权威） ============ */
/* action = {type, playerId, to?, mode?}
 *   'move'      按距离表移动到某个一楼房间
 *   'callRest'  呼叫工作人员送休息室（-自主度，不耗体力）
 *   'ascend'    上楼去第三展厅：token 停在电梯/楼梯，占用本回合；mode=lift|staffLift|guideStair|selfStair
 *   'arriveUp'  上楼后的下一回合：抵达第三展厅（不额外耗体力）；若满则等待
 *   'descend'   从第三展厅下楼：token 停在电梯/楼梯，占用本回合；下一回合在大厅开始
 */
function applyAction(action){
  if(!G || G.over) return {error:'游戏未进行'};
  const p = playerById(action.playerId);
  if(!p) return {error:'无此玩家'};
  if(p.id !== currentPlayerId()) return {error:'还没轮到该玩家'};
  if(p.finished) return {error:'该玩家已完成参观'};

  if(action.type==='arriveUp') return arriveUp(p);
  if(action.type==='ascend')   return applyAscend(p, action.mode);
  if(action.type==='descend')  return applyDescend(p, action.mode);

  if(p.transit) return {error:'正在电梯/楼梯上，本回合无法移动'};

  /* ---- 呼叫工作人员送休息室 ---- */
  if(action.type==='callRest'){
    if(roomIsFull('rest', p.id)) return {error:'休息区已满'};
    p.auto -= CFG.rules.callStaffAutoCost;
    p.room = 'rest';
    logMsg('move', `${p.name} 呼叫工作人员送往【休息区】（自主度-${CFG.rules.callStaffAutoCost}，不耗体力）`);
    return finishVisit(p, 'rest');
  }

  /* ---- 普通移动（按距离表） ---- */
  if(action.type==='move'){
    const to = action.to;
    const block = taskLimitBlock(p, to);
    if(block) return {error:block};
    const cost = moveCostBetween(p.room, to);
    if(cost==null) return {error:'无法直接前往该房间'};
    if(CFG.rooms[to].capacity<99 && roomIsFull(to, p.id)) return {error:`【${roomDef(to).name}】已满`};
    return doMoveAndVisit(p, to, cost);
  }

  return {error:'未知操作'};
}

/* 普通移动到 to 并结算，支付 cost 体力 */
function doMoveAndVisit(p, to, cost){
  if(p.stam < cost){                       // 体力不足以支付移动本身 -> 送休息室
    return forceRest(p);
  }
  p.stam -= cost;
  p.room = to;
  logMsg('move', `${p.name} 移动到【${roomDef(to).name}】（体力-${cost}）`);
  return finishVisit(p, to);
}

/* 计算某种上/下楼方式的代价与所停过路点 */
function stairPlan(p, mode){
  const r = CFG.rules;
  if(p.type==='wheelchair'){
    if(mode==='lift')      return {stam:r.liftRideStam, auto:0, on:'lift',   label:'乘无障碍电梯'};
    if(mode==='staffLift') return {stam:0, auto:r.liftStairWheelchairAutoCost, on:'stairs', label:'叫工作人员从楼梯抬'};
  }else{
    if(mode==='lift')      return {stam:r.liftRideStam, auto:0, on:'lift',   label:'乘无障碍电梯'};
    if(mode==='guideStair')return {stam:r.stairGuideBlindStam, auto:r.stairGuideBlindAutoCost, on:'stairs', label:'工作人员带领走楼梯'};
    if(mode==='selfStair') return {stam:r.stairSelfBlindStam, auto:0, on:'stairs', label:'自行走楼梯'};
  }
  return null;
}

/* 上楼：token 停在电梯/楼梯，本回合结束；下一回合再抵达第三展厅 */
function applyAscend(p, mode){
  if(p.transit) return {error:'已在通行中'};
  if(roomIsFull('hall3', p.id)) return {error:'【第三展厅】已满'};
  const plan = stairPlan(p, mode);
  if(!plan) return {error:'无效的上楼方式'};
  if(plan.on==='lift' && roomIsFull('lift', p.id)) return {error:'【无障碍电梯】被占用'};
  if(plan.stam>0 && p.stam < plan.stam) return forceRest(p);
  p.stam -= plan.stam; p.auto -= plan.auto;
  p.room = plan.on; p.transit = {dir:'up'};
  const costTxt = [plan.stam?`体力-${plan.stam}`:'', plan.auto?`自主度-${plan.auto}`:''].filter(Boolean).join('，');
  logMsg('move', `${p.name}（${p.type==='wheelchair'?'轮椅':'视障'}）${plan.label}上楼，停在【${roomDef(plan.on).name}】（${costTxt||'无消耗'}）。下一回合抵达第三展厅。`);
  G._pendingAdvance = true;
  return {ok:true, drawn:[], transit:'up'};
}

/* 上楼后的下一回合：抵达第三展厅（不额外耗体力）；若已满则再等一回合 */
function arriveUp(p){
  if(!p.transit || p.transit.dir!=='up') return {error:'没有待抵达的上楼行程'};
  if(roomIsFull('hall3', p.id)){
    logMsg('bad', `【第三展厅】仍满员，${p.name} 只能在【${roomDef(p.room).name}】上再等待一回合。`);
    G._pendingAdvance = true;
    return {ok:true, drawn:[], waited:true};
  }
  p.room = 'hall3'; p.transit = null;
  logMsg('move', `${p.name} 抵达【第三展厅】（上楼不额外耗体力）`);
  return finishVisit(p, 'hall3');
}

/* 下楼：token 停在电梯/楼梯，本回合结束；下一回合在大厅开始（见 onTurnBegin） */
function applyDescend(p, mode){
  if(p.room!=='hall3') return {error:'只有在第三展厅才能下楼'};
  const plan = stairPlan(p, mode);
  if(!plan) return {error:'无效的下楼方式'};
  if(plan.on==='lift' && roomIsFull('lift', p.id)) return {error:'【无障碍电梯】被占用'};
  if(plan.stam>0 && p.stam < plan.stam) return forceRest(p);
  p.stam -= plan.stam; p.auto -= plan.auto;
  p.room = plan.on; p.transit = {dir:'down'};
  const costTxt = [plan.stam?`体力-${plan.stam}`:'', plan.auto?`自主度-${plan.auto}`:''].filter(Boolean).join('，');
  logMsg('move', `${p.name}（${p.type==='wheelchair'?'轮椅':'视障'}）${plan.label}下楼，停在【${roomDef(plan.on).name}】（${costTxt||'无消耗'}）。下一回合在大厅开始。`);
  G._pendingAdvance = true;
  return {ok:true, drawn:[], transit:'down'};
}

/* 每当轮到某玩家开始其回合时调用：处理「下楼后到达大厅」 */
function onTurnBegin(){
  const pid = currentPlayerId();
  if(!pid) return;
  const p = playerById(pid);
  if(p.transit && p.transit.dir==='down'){
    p.room = 'lobby'; p.transit = null;
    logMsg('move', `${p.name} 下楼到达【大厅】，正常开始本回合。`);
  }
}

/* 体力不足被强制送休息室 */
function forceRest(p){
  const autoCost = CFG.rules.callStaffAutoCost;
  p.auto -= autoCost;
  p.room = 'rest';
  const notice = `体力透支，工作人员赶紧把 ${p.name} 送进休息区（自主度-${autoCost}）`;
  logMsg('bad', notice);
  G._forceRestNotice = notice;   // 由 dispatch 弹出醒目提示
  // 送休息室也给休息室奖励
  return finishVisit(p, 'rest', [], true);
}

/* 完成一次房间访问的结算：抽卡→若体力不足支付事件则送休息室→否则加奖励与任务计数 */
function finishVisit(p, rid, _unused, forcedRest){
  const res = resolveRoomVisit(p, rid);
  const needStam = -Math.min(0, res.total.stam);   // 事件造成的体力扣减总额

  // 若事件扣减体力后体力会 <0，且无法支付 -> 送休息室（本回合算作去了休息室）
  if(res.total.stam < 0 && p.stam + res.total.stam < 0 && rid!=='rest'){
    const notice = `${p.name} 在【${roomDef(rid).name}】体力透支，工作人员赶紧把你送进休息区（自主度-${CFG.rules.callStaffAutoCost}）`;
    logMsg('bad', notice);
    G._forceRestNotice = notice;
    p.auto -= CFG.rules.callStaffAutoCost;
    p.room = 'rest';
    // 展示已抽到的卡，但不结算奖励
    const restRes = resolveRoomVisit(p, 'rest');
    applyStats(p, restRes.total);
    applyStats(p, restRes.reward);
    p.visits.toilet = p.visits.toilet; // 不计数
    afterAction(p, res.drawn, true);
    return {ok:true, drawn:res.drawn, forcedRest:true};
  }

  // 正常结算：事件 + 房间奖励
  applyStats(p, res.total);
  applyStats(p, res.reward);

  // 任务计数
  if(['hall1','hall2','hall3','activity','toilet'].includes(rid)){
    p.visits[rid] = (p.visits[rid]||0) + 1;
  }

  // 活动区：附加活动卡奖励 + 记录小游戏
  if(rid==='activity' && G.activity){
    const aEff = effectFor(G.activity.reward, p.type);
    applyStats(p, aEff);
    res.activity = G.activity;
  }

  logStat(p, rid, res);
  checkFinished(p);
  afterAction(p, res.drawn, false, res);
  return {ok:true, drawn:res.drawn, reward:res.reward, total:res.total, activity:res.activity};
}

function applyStats(p, e){ p.auto+=e.auto; p.stam+=e.stam; p.joy+=e.joy; if(p.stam<0)p.stam=0; }

function logStat(p, rid, res){
  const t=res.total, r=res.reward;
  const net = { auto:t.auto+r.auto, stam:t.stam+r.stam, joy:t.joy+r.joy };
  const cls = (net.auto+net.joy>=0)?'good':'bad';
  logMsg(cls, `${p.name} 访问【${roomDef(rid).name}】结算：自主${fmt(net.auto)} 体力${fmt(net.stam)} 愉悦${fmt(net.joy)}`);
}
function fmt(n){ return n>=0?`+${n}`:`${n}`; }

/* ============ 胜利/完成判定 ============ */
function checkFinished(p){
  const t = CFG.tasks;
  const ok =
    p.visits.hall1>=t.galleriesEach &&
    p.visits.hall2>=t.galleriesEach &&
    p.visits.hall3>=t.galleriesEach &&
    p.visits.activity===t.activityExactly &&
    p.visits.toilet>=t.toiletMin && p.visits.toilet<=t.toiletMax;
  if(ok && !p.finished){
    p.finished = true;
    // 完成先后奖励愉悦度
    const rank = G.players.filter(x=>x.finished).length - 1;   // 0-based：第几个完成
    p.finishRank = rank;
    const bonus = (CFG.rules.finishOrderJoyBonus||[])[rank] || 0;
    if(bonus) p.joy += bonus;
    // 注意：本回合仍留在原地占位（充当其他玩家的障碍）；
    // 下次轮到他时才会被送到大厅结算（见 relocateFinishedIfDue）。
    p.pendingRelocate = true;
    logMsg('sys', `🎉 ${p.name} 第${rank+1}个完成全部参观任务！愉悦度+${bonus}。本回合仍在【${roomDef(p.room).name}】占位，下次轮到他时移往大厅等待。`);
  }
  return ok;
}

/* 一次行动收尾：推进回合（抽卡展示由 UI 负责，然后调用 continueAfterCard） */
function afterAction(p, drawn, forced, res){
  G._pendingAdvance = true;
}

/* 卡片看完后推进（本地/主机） */
function continueAfterCard(){
  if(G._pendingAdvance){ G._pendingAdvance=false; advanceTurn(); }
  pushAndRender();
}

/* ============ FX：通过「渲染前后状态对比」自动触发飘字/音效 ============ */
let _statSnap = {};     // pid -> {auto,stam,joy}
let _finSnap = {};      // pid -> bool
function playFX(){
  const snap={}, fin={};
  let anyGood=false, anyBad=false, anyFinish=false;
  G.players.forEach(p=>{
    snap[p.id]={auto:p.auto,stam:p.stam,joy:p.joy};
    fin[p.id]=!!p.finished;
    const prev=_statSnap[p.id];
    if(prev){
      const d={auto:p.auto-prev.auto, stam:p.stam-prev.stam, joy:p.joy-prev.joy};
      if(d.auto||d.stam||d.joy){
        floatStatChange(p.id, d);
        if((d.auto+d.joy)>0) anyGood=true; else if((d.auto+d.joy)<0) anyBad=true;
      }
    }
    if(fin[p.id] && !_finSnap[p.id]){ anyFinish=true; celebrateFinish(p.id); }
  });
  if(anyFinish) SFX.complete();
  else if(anyGood && !anyBad) SFX.good();
  else if(anyBad) SFX.bad();
  _statSnap=snap; _finSnap=fin;
}

function endGame(){
  G.over = true;
  logMsg('sys', '🏛️ 博物馆闭馆，游戏结束！');
  pushAndRender();
  setTimeout(showWinner, 300);
}

/* ============ 日志 ============ */
function logMsg(cls, text){
  if(!G) return;
  G.log.push({cls, text});
  if(G.log.length>200) G.log.shift();
}

/* ============ C. 渲染 ============ */
function pushAndRender(){
  // 房主：广播状态给客人
  if(Net.mode==='host'){ Net.broadcast(serializeState()); }
  render();
}
function serializeState(){ return deepClone({players:G.players, phaseIndex:G.phaseIndex, order:G.order, prevOrder:G.prevOrder, round:G.round, turnPos:G.turnPos, acted:G.acted, activity:G.activity, lastCards:G.lastCards, log:G.log, over:G.over}); }
function applyRemoteState(state){
  // 客人：用房主状态覆盖本地（decks 等无需）
  if(!G) G={};
  Object.assign(G, deepClone(state));
  G.decks = G.decks||{};
  render();
}

function render(){
  if(!G){ return; }
  renderProgress();
  renderTurnOrder();
  renderMap();
  renderSide();
  renderDecks();
  renderLog();
  playFX();          // 对比状态，触发飘字/音效
}

function renderProgress(){
  const track = $('#phaseTrack'); track.innerHTML='';
  CFG.phases.forEach((ph,i)=>{
    const step = el('div','phase-step'+(i<G.phaseIndex?' done':'')+(i===G.phaseIndex&&!G.over?' active':''));
    step.appendChild(el('span','dot'));
    step.appendChild(el('span',null,`${ph}`));
    if(i===G.phaseIndex && !G.over) step.appendChild(el('span',null,`　·　第${G.round+1}/2轮`));
    track.appendChild(step);
  });
  // 闭馆
  const close = el('div','phase-step'+(G.over?' active':''));
  close.appendChild(el('span','dot'));
  close.appendChild(el('span',null,'闭馆'));
  track.appendChild(close);

  const cur = currentPlayerId();
  $('#phaseInfo').innerHTML = G.over ? '游戏已结束。' :
    `当前阶段：<b>${CFG.phases[G.phaseIndex]}</b><br>本阶段活动区：<b>${G.activity?G.activity.title:'—'}</b>`;
}

function renderTurnOrder(){
  const ol = $('#turnOrder'); ol.innerHTML='';
  const cur = currentPlayerId();
  G.order.forEach((pid)=>{
    const p = playerById(pid);
    const li = el('li', pid===cur?'now':'');
    const seat = el('span','seat'+(G.acted[pid]?' acted':''));
    seat.style.background = p.color; seat.textContent=p.icon;
    li.appendChild(seat);
    li.appendChild(el('span',null,`${p.name}　体力${p.stam}${p.finished?'　✔已完成':''}`));
    ol.appendChild(li);
  });
}

function renderMap(){
  const host = $('#hotspots'); host.innerHTML='';
  const cur = currentPlayerId();
  const curP = cur?playerById(cur):null;
  const iAmActive = canControl(cur);

  Object.entries(CFG.rooms).forEach(([rid,def])=>{
    const h = def.hot;
    const spot = el('div','hotspot');
    spot.style.left=h.left+'%'; spot.style.top=h.top+'%'; spot.style.width=h.width+'%'; spot.style.height=h.height+'%';

    // 标签
    const cap = def.capacity>=99?'∞':(rid==='activity'&&G.activity?G.activity.capacity:def.capacity);
    const label = el('div','room-label', `${def.name}<span class="cap">(${occupancy(rid,null)}/${cap})</span>`);
    spot.appendChild(label);
    spot.dataset.tip = roomTip(rid,def);

    // 活动区：在版图上显示当前活动的详情
    if(rid==='activity' && G.activity){
      const a=G.activity;
      const info = el('div','activity-info',
        `<div class="ai-title">🎪 ${a.title}</div>
         <div class="ai-line">奖励：${effTip(a.reward)}</div>
         <div class="ai-line">限 ${a.capacity} 人</div>
         <div class="ai-line ai-mini">小游戏：${a.minigame||'—'}</div>`);
      spot.appendChild(info);
    }

    // 当前玩家所在
    if(curP && curP.room===rid) spot.classList.add('here');

    // 可达高亮 + 点击
    if(curP && iAmActive && !G.over && !curP.finished){
      const canGo = computeClickTarget(curP, rid);
      if(canGo==='full') spot.classList.add('full');
      else if(canGo) { spot.classList.add('reachable'); spot.onclick=()=>onRoomClick(curP, rid); }
    }

    // tokens
    const tw = el('div','tokens-on-room');
    G.players.filter(p=>p.room===rid).forEach(p=>{
      const t=el('div','token'+(p.id===cur?' active-token':'')+(p.finished?' finished-token':''), p.icon);
      t.style.background=p.color; t.title=p.name+(p.finished?'（已完成·等待中）':''); t.dataset.pid=p.id;
      if(p.finished){ const chk=el('span','tok-check','☑️'); t.appendChild(chk); }
      tw.appendChild(t);
    });
    spot.appendChild(tw);
    host.appendChild(spot);
  });
}

function roomTip(rid,def){
  const r = effectFor(def.reward,'wheelchair');
  const rewardTxt = (def.reward && (r.auto||r.stam||r.joy)) ? `　访问奖励：自主${fmt(r.auto)} 体力${fmt(r.stam)} 愉悦${fmt(r.joy)}` : '';
  const capTxt = def.capacity>=99?'不限人数':`限${def.capacity}人`;
  let extra='';
  if(rid==='hall3') extra='　（楼上：需经电梯/楼梯，占1回合，下一回合抵达。轮椅=电梯/叫人抬；视障=电梯/带领走楼梯/自行走）';
  if(rid==='toilet') extra='　（访问需在坐便器/洗手池/附加设施各抽1张）';
  if(rid==='rest') extra='　（可呼叫工作人员送来：不耗体力，-1自主度）';
  if(def.transit) extra='　（过路点：仅上下楼时经过，不能作为目的地）';
  return `${def.name}｜${capTxt}${rewardTxt}${extra}`;
}

/* 判断点击某房间对当前玩家意味着什么：false 不可点 / 'full' 满 / true 可去 / 'ascend' 上楼 */
function computeClickTarget(p, rid){
  if(p.transit) return false;              // 通行中不能操作
  if(rid===p.room) return false;
  if(roomDef(rid).transit) return false;   // 电梯/楼梯不可作为目的地
  if(p.room==='hall3') return false;        // 楼上离开走「下楼」按钮
  if(rid==='hall3'){
    return roomIsFull('hall3',p.id) ? 'full' : 'ascend';
  }
  const dests = reachableDests(p);
  return dests[rid] || false;
}

/* 若因参观次数上限而不该再去某地，返回提示语；否则返回 null */
function taskLimitBlock(p, rid){
  const t=CFG.tasks;
  if(rid==='activity' && (p.visits.activity||0) >= t.activityExactly)
    return '活动名额有限，每人每天只能选择一个活动参加';
  if(rid==='toilet' && (p.visits.toilet||0) >= t.toiletMax)
    return '一天上这么多次厕所对身体不健康哦';
  return null;
}

/* ============ D. 交互：点击房间 ============ */
function onRoomClick(p, rid){
  if(p.transit) return;
  // 参观次数上限：提示并阻止
  const block = taskLimitBlock(p, rid);
  if(block){ toast(block); SFX.bad(); return; }
  // 第三展厅：弹出上楼方式
  if(rid==='hall3'){
    askStairChoice(p, 'up');
    return;
  }
  // 休息区：问“自己走”还是“呼叫工作人员”
  if(rid==='rest'){
    askRestChoice(p);
    return;
  }
  dispatch({type:'move', playerId:p.id, to:rid});
}

function askRestChoice(p){
  const cost = moveCostBetween(p.room,'rest');
  openModal('前往休息区', `
    <p>你可以自己前往休息区（消耗体力），也可以呼叫工作人员送你过去（不耗体力，但 -${CFG.rules.callStaffAutoCost} 自主度）。</p>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <button class="btn" id="restSelf">自己走（-${cost}体力）</button>
      <button class="btn" id="restCall">呼叫工作人员（-${CFG.rules.callStaffAutoCost}自主度）</button>
    </div>`);
  $('#restSelf').onclick=()=>{ closeModal(); dispatch({type:'move', playerId:p.id, to:'rest'}); };
  $('#restCall').onclick=()=>{ closeModal(); dispatch({type:'callRest', playerId:p.id, to:'rest'}); };
}

/* dir: 'up' 上楼去第三展厅 / 'down' 从第三展厅下楼 */
function askStairChoice(p, dir){
  const r=CFG.rules;
  const title = dir==='up' ? '前往第三展厅（上楼）' : '离开第三展厅（下楼）';
  const note  = dir==='up'
    ? '上楼占用本回合，token 停在电梯/楼梯上，<b>下一回合</b>抵达第三展厅（不额外耗体力）。若届时展厅已满，则多等一回合。'
    : '下楼占用本回合，token 停在电梯/楼梯上，<b>下一回合</b>在大厅开始。';
  let btns='';
  if(p.type==='wheelchair'){
    btns=`
      <button class="btn" id="s_lift">乘无障碍电梯（-${r.liftRideStam}体力，占用电梯1回合）</button>
      <button class="btn" id="s_staff">叫工作人员从楼梯抬（-${r.liftStairWheelchairAutoCost}自主度）</button>`;
  }else{
    btns=`
      <button class="btn" id="s_lift">乘无障碍电梯（-${r.liftRideStam}体力）</button>
      <button class="btn" id="s_guide">工作人员带领走楼梯（-${r.stairGuideBlindAutoCost}自主度，-${r.stairGuideBlindStam}体力）</button>
      <button class="btn" id="s_self">自行走楼梯（-${r.stairSelfBlindStam}体力）</button>`;
  }
  openModal(title, `
    <p>${note}</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${btns}</div>`);
  const type = dir==='up' ? 'ascend' : 'descend';
  const go=mode=>{ closeModal(); dispatch({type, playerId:p.id, mode}); };
  if($('#s_lift')) $('#s_lift').onclick=()=>go('lift');
  if($('#s_staff'))$('#s_staff').onclick=()=>go('staffLift');
  if($('#s_guide'))$('#s_guide').onclick=()=>go('guideStair');
  if($('#s_self')) $('#s_self').onclick=()=>go('selfStair');
}

/* ============ 派发操作（本地执行 或 客人上报房主） ============ */
function dispatch(action){
  SFX.ensure();   // 用户手势内解锁音频
  if(Net.mode==='guest'){ Net.sendAction(action); return; }
  const res = applyAction(action);
  if(res && res.error){ toast(res.error); return; }
  SFX.move();
  // 体力透支被送休息区：弹出醒目提示
  const notice = G._forceRestNotice; G._forceRestNotice = null;
  const afterNotice = ()=>{
    if(notice){
      SFX.bad();
      openModal('体力透支', `<p style="font-size:15px;line-height:1.8">😵 ${notice}</p>`);
      const back=$('#modalRoot .modal-back');
      if(back){ setTimeout(()=>{ if(back.parentNode) closeModal(); }, 2600); }
    }
  };
  // 展示抽到的卡（若有），看完后推进
  if(res && res.drawn && res.drawn.length){
    showCards(res, ()=>{ continueAfterCard(); afterNotice(); });
  }else{
    continueAfterCard(); afterNotice();
  }
}

/* ============ E. 卡牌展示（翻转动画） ============ */
function showCards(res, done){
  const overlay=$('#cardOverlay'), inner=$('#cardOverlayInner');
  inner.innerHTML='';
  const deckNames={toilet_seat:'坐便器区',toilet_sink:'洗手池区',toilet_extra:'附加设施区',gallery:'展厅',lift:'电梯',stairs:'楼梯'};
  res.drawn.forEach((d,index)=>{
    const kind = d.deck.startsWith('toilet')?'toilet':d.deck;
    const e=d.eff;
    const effHtml = `自主 <span class="${e.auto>=0?'up':'down'}">${fmt(e.auto)}</span>　体力 <span class="${e.stam>=0?'up':'down'}">${fmt(e.stam)}</span>　愉悦 <span class="${e.joy>=0?'up':'down'}">${fmt(e.joy)}</span>`;
    const card=el('div','flip-card');
    card.innerHTML=`
      <div class="flip-inner">
        <div class="flip-face flip-front ${kind}">${deckNames[d.deck]||''}<div class="subtxt">点击翻开</div></div>
        <div class="flip-face flip-back">
          <h4>${d.card.title}</h4>
          <div class="desc">${d.card.desc||''}</div>
          <div class="eff">${effHtml}</div>
        </div>
      </div>`;
    card.onclick=()=>card.classList.add('flipped');
    inner.appendChild(card);
    setTimeout(()=>{ card.classList.add('flipped'); SFX.draw(); }, 250+250*index); // 逐张翻开并出声
  });
  overlay.classList.remove('hidden');
  $('#cardOverlayClose').onclick=()=>{ overlay.classList.add('hidden'); done&&done(); };
}

/* ============ 右侧面板 ============ */
function renderSide(){
  const cur=currentPlayerId();
  const ct=$('#currentTurn');
  if(G.over){ ct.innerHTML='🏛️ 已闭馆'; }
  else if(cur){
    const p=playerById(cur);
    ct.innerHTML=`<span style="color:${p.color}">${p.icon} ${p.name}</span> 的回合`;
  }else ct.innerHTML='—';

  const aa=$('#actionArea'); aa.innerHTML='';
  if(!G.over && cur){
    const p=playerById(cur);
    const ctrl=canControl(cur);

    if(p.transit && p.transit.dir==='up'){
      // 上楼通行中：本回合抵达第三展厅
      aa.appendChild(el('div','hintline',`${p.name} 在【${roomDef(p.room).name}】上，本回合抵达第三展厅。`));
      if(ctrl){
        const b=el('button','btn primary','抵达第三展厅');
        b.onclick=()=>dispatch({type:'arriveUp', playerId:p.id});
        aa.appendChild(b);
      }
    }else if(p.room==='hall3'){
      // 在第三展厅：只能下楼
      aa.appendChild(el('div','hintline','你在第三展厅（楼上）。离开需下楼，占用本回合。'));
      if(ctrl){
        const b=el('button','btn primary','下楼离开');
        b.onclick=()=>askStairChoice(p,'down');
        aa.appendChild(b);
      }
    }else if(ctrl){
      aa.appendChild(el('div','hintline','点击地图上高亮的房间前往。绿框=可去，红框=已满。前往第三展厅需上楼。'));
    }else{
      aa.appendChild(el('div','hintline',`等待 ${p.name} 操作中…（联机对方设备）`));
    }

    if(Net.mode==='local'){
      const skip=el('button','btn mini-btn','跳过该玩家本回合');
      skip.onclick=()=>{ logMsg('sys',`${p.name} 跳过本回合`); advanceTurn(); pushAndRender(); };
      aa.appendChild(skip);
    }
  }

  const box=$('#playerCards'); box.innerHTML='';
  G.players.forEach(p=>{
    const c=el('div','pcard'+(p.id===cur?' turn':''));
    const head=el('div','phead');
    const tok=el('span','ptoken',p.icon); tok.style.background=p.color;
    head.appendChild(tok);
    const loc = p.transit ? `${roomDef(p.room).name}(${p.transit.dir==='up'?'上楼中':'下楼中'})` : roomDef(p.room).name;
    head.appendChild(el('span',null,`${p.name}　<small style="font-weight:400;color:#6b6252">${p.type==='wheelchair'?'轮椅':'视障'}·在${loc}</small>`));
    c.appendChild(head);
    const stats=el('div','stats');
    stats.innerHTML=`
      <div class="stat auto"><b>${p.auto}</b>自主度</div>
      <div class="stat stam"><b>${p.stam}</b>体力</div>
      <div class="stat joy"><b>${p.joy}</b>愉悦度</div>`;
    c.appendChild(stats);
    // 任务
    const t=CFG.tasks;
    const tasks=el('div','tasks');
    const chip=(label,ok)=>`<span class="task-chip${ok?' done':''}">${ok?'✔':''}${label}</span>`;
    tasks.innerHTML=
      chip(`一展${p.visits.hall1}`,p.visits.hall1>=t.galleriesEach)+
      chip(`二展${p.visits.hall2}`,p.visits.hall2>=t.galleriesEach)+
      chip(`三展${p.visits.hall3}`,p.visits.hall3>=t.galleriesEach)+
      chip(`活动${p.visits.activity}`,p.visits.activity===t.activityExactly)+
      chip(`厕所${p.visits.toilet}`,p.visits.toilet>=t.toiletMin&&p.visits.toilet<=t.toiletMax);
    c.appendChild(tasks);
    if(p.finished){
      const rankTxt = (p.finishRank!=null) ? `第${p.finishRank+1}个完成` : '已完成';
      c.appendChild(el('div','badge-win',`☑️ ${rankTxt}·在大厅等待　最终分(自主+愉悦)=${p.auto+p.joy}`));
    }
    box.appendChild(c);
  });
}

/* ============ 牌堆 ============ */
function renderDecks(){
  const decks=$('#decks'); decks.innerHTML='';
  const defs=[
    {key:'toilet',name:'无障碍厕所',sub:'3区各抽1',count:15,piles:['toilet_seat','toilet_sink','toilet_extra']},
    {key:'gallery',name:'展厅共用',sub:'三展通用',count:DATA.cards.gallery.length,piles:['gallery']},
    {key:'lift',name:'无障碍电梯',sub:'电梯门/开门',count:DATA.cards.lift.length,piles:['lift']},
    {key:'stairs',name:'无障碍楼梯',sub:'',count:DATA.cards.stairs.length,piles:['stairs']},
  ];
  defs.forEach(d=>{
    const remain = d.piles.reduce((a,pk)=>a+((G.decks&&G.decks[pk])?G.decks[pk].length:DATA.cards[pk].length),0);
    const wrap=el('div',`deck ${d.key}`);
    const last = d.key==='toilet'? (G.lastCards.toilet_seat) : G.lastCards[d.piles[0]];
    wrap.innerHTML=`
      <div class="mini-card">${last?('最近：'+last.title):(d.name)}</div>
      <div class="dname">${d.name}</div>
      <div class="dcount">${d.sub?d.sub+'·':''}剩 ${remain} 张</div>`;
    decks.appendChild(wrap);
  });
  // 活动区当前卡
  const a=G.activity;
  if(a){
    const wrap=el('div','deck gallery');
    wrap.innerHTML=`<div class="mini-card" style="background:linear-gradient(160deg,#4aa3a3,#2a8080)">活动区<br>${a.title}</div>
      <div class="dname">${a.title}</div><div class="dcount">限${a.capacity}人</div>`;
    wrap.style.cursor='pointer';
    wrap.dataset.tip = `${a.desc}｜奖励：${effTip(a.reward)}｜小游戏：${a.minigame||'—'}`;
    wrap.onclick=()=>openModal('活动区 · '+a.title, `<p>${a.desc}</p><p><b>参加奖励：</b>${effTip(a.reward)}</p><p><b>互动小游戏：</b>${a.minigame||'—'}</p><p style="color:#6b6252;font-size:12px">规则：活动区每人只能成功参加 1 次。若本回合有多名玩家在活动区，可即兴进行上面的小游戏。</p>`);
    decks.appendChild(wrap);
  }
}
function effTip(effect){
  const w=effectFor(effect,'wheelchair'), b=effectFor(effect,'blind');
  if(JSON.stringify(w)===JSON.stringify(b)) return `自主${fmt(w.auto)} 体力${fmt(w.stam)} 愉悦${fmt(w.joy)}`;
  return `轮椅[自主${fmt(w.auto)} 体力${fmt(w.stam)} 愉悦${fmt(w.joy)}] / 视障[自主${fmt(b.auto)} 体力${fmt(b.stam)} 愉悦${fmt(b.joy)}]`;
}

function renderLog(){
  const log=$('#log'); log.innerHTML='';
  G.log.slice(-60).forEach(l=>{ const d=el('div','l-'+l.cls,l.text); log.appendChild(d); });
  log.scrollTop=log.scrollHeight;
}

/* ============ 控制权 ============ */
// 本机是否可以操作玩家 pid：本地模式下随时可操作当前玩家；联机时须匹配绑定的玩家
function canControl(pid){
  if(!pid) return false;
  if(Net.mode==='local') return true;
  if(Net.mode==='host'){
    // 房主操作未被客人占用的玩家。简化：房主可操作所有“属于房主”的玩家。
    return Net.myPlayerId ? (pid===Net.myPlayerId || !isClaimed(pid)) : true;
  }
  if(Net.mode==='guest') return pid===Net.myPlayerId;
  return false;
}
function isClaimed(pid){ return (Net.claims||{})[pid] && Net.claims[pid]!==Net.selfTag; }

/* ============ 弹窗 & toast ============ */
function openModal(title, bodyHtml, wide){
  closeModal();
  const back=el('div','modal-back');
  const modal=el('div','modal');
  if(wide) modal.style.maxWidth='1000px';
  modal.innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="close">×</button></div><div class="modal-body">${bodyHtml}</div>`;
  back.appendChild(modal);
  back.onclick=e=>{ if(e.target===back) closeModal(); };
  modal.querySelector('.close').onclick=closeModal;
  $('#modalRoot').appendChild(back);
  return modal;
}
function closeModal(){ $('#modalRoot').innerHTML=''; }
function toast(msg){
  const t=el('div',null,msg);
  Object.assign(t.style,{position:'fixed',left:'50%',bottom:'40px',transform:'translateX(-50%)',background:'#c0392b',color:'#fff',padding:'10px 18px',borderRadius:'10px',zIndex:200,boxShadow:'0 4px 16px rgba(0,0,0,.3)'});
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2200);
}

/* ============ 结算/获胜 ============ */
function showWinner(){
  SFX.win();
  const finished=G.players.filter(p=>p.finished);
  const ranked=[...G.players].sort((a,b)=>{
    if(a.finished!==b.finished) return a.finished?-1:1;
    return (b.auto+b.joy)-(a.auto+a.joy);
  });
  let html='<div class="winner-box">';
  if(finished.length===0){
    html+='<div class="crown">🏛️</div><p>没有玩家在闭馆前完成全部参观任务。下次加油！</p>';
  }else{
    html+='<div class="crown">👑</div><p>完成参观任务的玩家参与最终比较（自主度 + 愉悦度）：</p>';
  }
  html+='<ul class="rank-list">';
  ranked.forEach((p,i)=>{
    const win = p.finished && i===0;
    html+=`<li class="${win?'win':''}"><span>${win?'👑 ':''}${p.icon} ${p.name} ${p.finished?'':'（未完成）'}</span><span>自主 ${p.auto} + 愉悦 ${p.joy} = <b>${p.auto+p.joy}</b></span></li>`;
  });
  html+='</ul></div>';
  openModal('闭馆结算', html);
}

/* ============ E2. 联机接线 ============ */
function updateNetChip(){
  const chip=$('#netStatus');
  if(Net.mode==='local'){ chip.className='net-chip local'; chip.textContent='本地模式'; }
  else if(Net.mode==='host'){ chip.className='net-chip host'; chip.textContent=`房主 · 房间 ${Net.room} · ${Net.peerCount()}人`; }
  else { chip.className='net-chip guest'; chip.textContent=`已加入 ${Net.room}`; }
}

function openRoomDialog(){
  if(!Net.available()){
    openModal('联机不可用', '<p>未能加载联机组件（PeerJS）。请检查网络，或直接使用<b>本地模式</b>：四位玩家共用这一台设备轮流操作，功能完全一致。</p>');
    return;
  }
  const body=`
    <div class="cfg-note">联机说明：一人当「房主」创建房间并把房间号告诉其他人；其他人「加入房间」。房主设备负责运算，断线后房间即结束。若网络受限，可回退到本地模式。</div>
    <div class="cfg-row"><label>房间号</label><input id="roomCode" value="${Net.room||('room'+Math.floor(Math.random()*900+100))}"></div>
    <div class="cfg-row"><label>我使用的玩家</label>
      <select id="claimPlayer">
        <option value="">（房主：可操作全部/未认领）</option>
        ${CFG.players.map(p=>`<option value="${p.id}">${p.name}（${p.type==='wheelchair'?'轮椅':'视障'}）</option>`).join('')}
      </select></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn primary" id="btnHost">创建房间(房主)</button>
      <button class="btn" id="btnJoin">加入房间</button>
      ${Net.mode!=='local'?'<button class="btn" id="btnLeave">断开</button>':''}
    </div>
    <div id="netMsg" style="margin-top:10px;font-size:13px;color:#6b6252"></div>`;
  openModal('联机房间', body);
  $('#btnHost').onclick=async()=>{
    const room=$('#roomCode').value.trim(); if(!room)return;
    Net.myPlayerId=$('#claimPlayer').value||null;
    $('#netMsg').textContent='正在创建房间…';
    Net.onAction=(action)=>{ const r=applyAction(action); if(r&&r.drawn&&r.drawn.length){} continueAfterCard(); };
    try{ await Net.host(room); $('#netMsg').textContent='房间已创建！把房间号告诉朋友。'; updateNetChip(); if(!G)newGame(); else pushAndRender(); closeModal(); }
    catch(e){ $('#netMsg').textContent='创建失败：'+e+'（房间号可能被占用，换一个试试）'; }
  };
  $('#btnJoin').onclick=async()=>{
    const room=$('#roomCode').value.trim(); if(!room)return;
    Net.myPlayerId=$('#claimPlayer').value||null;
    if(!Net.myPlayerId){ $('#netMsg').textContent='加入房间前请先在上面选择你使用的玩家。'; return; }
    $('#netMsg').textContent='正在加入…';
    Net.onState=(state)=>{ applyRemoteState(state); updateNetChip(); };
    try{ await Net.join(room); $('#netMsg').textContent='已加入房间！等待房主状态…'; updateNetChip(); closeModal(); }
    catch(e){ $('#netMsg').textContent='加入失败：'+e; }
  };
  if($('#btnLeave')) $('#btnLeave').onclick=()=>{ Net.leave(); updateNetChip(); closeModal(); };
}

/* ============ F. 规则说明书 ============ */
function openRules(){
  const r=CFG.rules, t=CFG.tasks;
  const html=`
  <div style="line-height:1.8;font-size:14px">
    <h3>游戏目标</h3>
    <p>四位玩家扮演坐轮椅（红、蓝 ♿）或视力障碍（绿、黄 🧑‍🦯）的参观者，游览一座无障碍程度参差不齐的博物馆。在闭馆前完成全部<b>参观任务</b>的玩家，比拼 <b>自主度 + 愉悦度</b> 的总和，高者获胜。</p>

    <h3>三个属性</h3>
    <ul>
      <li><b>自主度</b>（可为负）：初始 ${r.startAuto}。需要别人帮忙、被迫求助会下降。</li>
      <li><b>体力</b>：初始 ${r.startStam}。移动、爬楼、应付突发状况都要消耗；降到 0 就要被送去休息。</li>
      <li><b>愉悦度</b>（可为负）：初始 ${r.startJoy}。体验好坏直接影响它。</li>
    </ul>

    <h3>流程</h3>
    <p>游戏分 <b>${CFG.phases.join(' → ')}</b> 五个阶段，然后闭馆。每阶段每人行动 2 次（顺位 1234、再 1234），全程每人共 ${r.totalTurnsPerPlayer} 个回合。</p>
    <ul>
      <li>开场随机决定首个阶段的顺位。先手不加体力，第 2/3/4 位分别 +${r.turnOrderStamBonus.slice(1).join('/')} 体力。</li>
      <li>之后每个阶段开始，每人先 +${r.stamPerPhase} 体力，再按<b>体力从高到低</b>排新顺位（体力相同沿用上一阶段顺序）。左侧「行动顺位」栏随时可查，避免忘记顺序。</li>
      <li>每阶段开始抽 1 张<b>活动卡</b>放到活动区。</li>
    </ul>

    <h3>行动</h3>
    <p>轮到你时，把 token 移到想去的房间。<b>移动按距离消耗体力</b>（相邻1点、隔一间2点，以此类推，见下表），然后抽对应房间的<b>事件卡</b>看会发生什么（大厅、休息区、活动区不抽卡）。</p>
    <ul>
      <li>若体力不足以支付移动或事件扣减，直接被送到<b>休息区</b>，-${r.callStaffAutoCost} 自主度，本回合算作去了休息区。</li>
      <li>能支付事件，则算作成功访问该房间，获得房间奖励，并累计参观任务进度。</li>
      <li><b>休息区</b>：可自己走（耗体力），也可「呼叫工作人员」送来（不耗体力，-${r.callStaffAutoCost} 自主度）。</li>
    </ul>
    <p style="font-size:12px;color:#6b6252">一楼移动体力表：休息区↔厕所1、休息区↔大厅1、休息区↔一展2、休息区↔二展3、休息区↔活动区4；厕所↔大厅1、厕所↔一展2、厕所↔二展3、厕所↔活动区4；大厅↔一展1、大厅↔二展2、大厅↔活动区3；一展↔二展1、一展↔活动区2；二展↔活动区1。（均可在配置里改）</p>

    <h3>第三展厅（楼上）</h3>
    <p>去/离开第三展厅都要经无障碍电梯或楼梯，<b>占用一整回合</b>：这回合 token 停在电梯/楼梯上。</p>
    <ul>
      <li><b>上楼</b>：本回合停在电梯/楼梯，<b>下一回合</b>抵达第三展厅并抽卡（不额外耗体力）；若届时展厅已满，则再等一回合。</li>
      <li><b>下楼</b>：本回合停在电梯/楼梯，<b>下一回合</b>在大厅开始，可正常行动。</li>
      <li>轮椅：乘无障碍电梯（-${r.liftRideStam}体力，占电梯1回合）；或叫工作人员从楼梯抬（-${r.liftStairWheelchairAutoCost}自主度）。</li>
      <li>视障：乘电梯（-${r.liftRideStam}体力）；工作人员带领走楼梯（-${r.stairGuideBlindAutoCost}自主度，-${r.stairGuideBlindStam}体力）；自行走楼梯（-${r.stairSelfBlindStam}体力）。</li>
    </ul>

    <h3>房间容量</h3>
    <p>大厅/休息区不限；无障碍厕所 1 人；无障碍电梯 1 人；第一展厅 3；第二展厅 2；第三展厅 3；活动区按活动卡而定。先占先得，位置满了后来者去不了。</p>

    <h3>参观任务（获胜条件）</h3>
    <ul>
      <li>三个展厅各至少 ${t.galleriesEach} 次；</li>
      <li>活动区恰好 ${t.activityExactly} 次（名额有限，每人每天只能参加一个活动，无法重复选）；</li>
      <li>无障碍厕所至少 ${t.toiletMin} 次、最多 ${t.toiletMax} 次（超过上限系统会阻止；每次在坐便器/洗手池/附加设施各抽 1 张，三区代价求和）。</li>
    </ul>
    <p>在 ${r.totalTurnsPerPlayer} 回合内完成即可进入最终比较，<b>自主度 + 愉悦度</b> 最高者获胜。</p>
    <p style="font-size:12px;color:#6b6252">完成参观后：本回合仍留在原地占位（充当其他玩家的障碍），<b>下次轮到他时</b>才移动到大厅等待结算（不减属性）。按完成先后奖励愉悦度：${(r.finishOrderJoyBonus||[]).join(' / ')}（第1/2/3/4个完成）。</p>

    <h3>公平性说明</h3>
    <p>事件卡对轮椅使用者与视障者尽量提供不同但平衡的增减，用意是呈现无障碍设施对不同人群的真实影响，而非让某一方吃亏。你可以在「配置 / 卡牌」里自由调整所有数值来做平衡测试。</p>
  </div>`;
  openModal('游戏说明', html, true);
}

/* ============ F2. 配置 / 卡牌编辑器 ============ */
let cfgTab='rules';
function openConfig(){
  const body=`
    <div class="cfg-note">在这里修改的所有数值/卡牌会保存到本机浏览器，并在<b>下一局新游戏</b>生效（部分展示项即时生效）。改完记得点「保存」。可随时「恢复默认」。</div>
    <div class="cfg-tabs">
      <button class="btn" data-tab="rules">基础数值</button>
      <button class="btn" data-tab="rooms">房间与奖励</button>
      <button class="btn" data-tab="toilet">厕所卡</button>
      <button class="btn" data-tab="gallery">展厅卡</button>
      <button class="btn" data-tab="lift">电梯卡</button>
      <button class="btn" data-tab="stairs">楼梯卡</button>
      <button class="btn" data-tab="activities">活动卡</button>
    </div>
    <div id="cfgContent"></div>
    <div style="display:flex;gap:10px;margin-top:16px;position:sticky;bottom:0;background:var(--panel);padding-top:10px;border-top:1px solid var(--line)">
      <button class="btn primary" id="cfgSave">保存</button>
      <button class="btn" id="cfgExport">导出为文件</button>
      <button class="btn" id="cfgImport">导入文件</button>
      <button class="btn" id="cfgReset">恢复默认</button>
    </div>`;
  openModal('配置 / 卡牌', body, true);
  $$('.cfg-tabs .btn').forEach(b=>b.onclick=()=>{ cfgTab=b.dataset.tab; renderCfgTab(); });
  $('#cfgSave').onclick=()=>{ collectCfg(); saveData(DATA); CFG=DATA.config; toast('已保存'); render&&G&&render(); };
  $('#cfgReset').onclick=()=>{ if(confirm('恢复所有默认设置？将丢失自定义修改。')){ DATA=resetData(); CFG=DATA.config; renderCfgTab(); toast('已恢复默认'); } };
  $('#cfgExport').onclick=()=>{ collectCfg(); const blob=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='accmuseum-config.json'; a.click(); };
  $('#cfgImport').onclick=()=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='.json'; inp.onchange=e=>{ const f=e.target.files[0]; const rd=new FileReader(); rd.onload=()=>{ try{ DATA=JSON.parse(rd.result); CFG=DATA.config; saveData(DATA); renderCfgTab(); toast('导入成功'); }catch(err){ toast('导入失败：格式错误'); } }; rd.readAsText(f); }; inp.click(); };
  renderCfgTab();
}

function renderCfgTab(){
  $$('.cfg-tabs .btn').forEach(b=>b.classList.toggle('on', b.dataset.tab===cfgTab));
  const c=$('#cfgContent');
  if(cfgTab==='rules') c.innerHTML=cfgRulesHtml();
  else if(cfgTab==='rooms') c.innerHTML=cfgRoomsHtml();
  else if(cfgTab==='activities') c.innerHTML=cfgActivitiesHtml();
  else c.innerHTML=cfgCardsHtml(cfgTab);
}

function numRow(label,id,val){ return `<div class="cfg-row"><label>${label}</label><input type="number" id="${id}" value="${val}"></div>`; }

function cfgRulesHtml(){
  const r=CFG.rules,t=CFG.tasks;
  return `<div class="cfg-grid">
    <div><b style="font-size:13px">初始 & 阶段</b>${numRow('初始自主度','r_auto',r.startAuto)}${numRow('初始体力','r_stam',r.startStam)}${numRow('初始愉悦度','r_joy',r.startJoy)}
      ${numRow('每阶段体力','r_pp',r.stamPerPhase)}${numRow('顺位体力奖励(逗号分隔)','r_bonus0',r.turnOrderStamBonus.join(','))}
      ${numRow('完成先后愉悦奖励(逗号分隔)','r_fin',(r.finishOrderJoyBonus||[]).join(','))}</div>
    <div><b style="font-size:13px">求助 & 上下楼</b>${numRow('呼叫工作人员-自主','r_call',r.callStaffAutoCost)}${numRow('乘电梯-体力','r_lift',r.liftRideStam)}${numRow('轮椅叫抬-自主','r_wchair',r.liftStairWheelchairAutoCost)}
      ${numRow('视障带领走楼梯-自主','r_guide',r.stairGuideBlindAutoCost)}${numRow('视障带领走楼梯-体力','r_guides',r.stairGuideBlindStam)}${numRow('视障自行走楼梯-体力','r_selfs',r.stairSelfBlindStam)}</div>
    <div><b style="font-size:13px">参观任务</b>
      ${numRow('每个展厅至少','t_gal',t.galleriesEach)}${numRow('活动区恰好','t_act',t.activityExactly)}${numRow('厕所最少','t_tmin',t.toiletMin)}${numRow('厕所最多','t_tmax',t.toiletMax)}</div>
  </div>
  <div class="cfg-note" style="margin-top:12px">一楼移动体力表（双向，改一格即改双向）：</div>
  <div id="mcTable">${moveCostTableHtml()}</div>`;
}
/* 一楼移动体力表编辑（只列上三角，保证双向一致） */
function moveCostTableHtml(){
  const order=['rest','toilet','lobby','hall1','hall2','activity'];
  const nm={rest:'休息区',toilet:'厕所',lobby:'大厅',hall1:'一展',hall2:'二展',activity:'活动区'};
  let h='<div class="cfg-grid">';
  for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++){
    const a=order[i],b=order[j];
    const v=(CFG.moveCost[a]&&CFG.moveCost[a][b]!=null)?CFG.moveCost[a][b]:'';
    h+=`<div class="cfg-row"><label>${nm[a]}↔${nm[b]}</label><input type="number" id="mc_${a}_${b}" value="${v}"></div>`;
  }
  return h+'</div>';
}
function cfgRoomsHtml(){
  let h='<div class="cfg-note">房间容量与「成功访问后」的固定奖励。第三展厅在楼上。</div>';
  Object.entries(CFG.rooms).forEach(([rid,d])=>{
    const rw=d.reward||{};
    h+=`<div class="card-edit"><b>${d.name}</b>（${rid}）
      <div class="cfg-row"><label>容量(∞用99)</label><input type="number" id="rc_${rid}_cap" value="${d.capacity}">
        奖励 自主<input type="number" id="rc_${rid}_a" value="${rw.auto||0}"> 体力<input type="number" id="rc_${rid}_s" value="${rw.stam||0}"> 愉悦<input type="number" id="rc_${rid}_j" value="${rw.joy||0}"></div>
    </div>`;
  });
  return h;
}

function effGroup(prefix, e, label){
  return `<div class="grp"><b>${label}</b>自主<input type="number" id="${prefix}_a" value="${e.auto||0}"> 体力<input type="number" id="${prefix}_s" value="${e.stam||0}"> 愉悦<input type="number" id="${prefix}_j" value="${e.joy||0}"></div>`;
}
function cfgCardsHtml(deckKey){
  const map={toilet:['toilet_seat','toilet_sink','toilet_extra'],gallery:['gallery'],lift:['lift'],stairs:['stairs']};
  const names={toilet_seat:'坐便器区',toilet_sink:'洗手池区',toilet_extra:'附加设施区',gallery:'展厅（20张，三展共用）',lift:'电梯',stairs:'楼梯'};
  let h='<div class="cfg-note">每张卡可分别设置对「轮椅」和「视障」的属性增减。若两者相同，填一样的数即可。改完点底部「保存」。</div>';
  map[deckKey].forEach(pk=>{
    h+=`<h3 style="border-left:4px solid var(--accent);padding-left:8px">${names[pk]}　<button class="btn mini-btn" onclick="addCard('${pk}')">+ 新增一张</button></h3>`;
    DATA.cards[pk].forEach((card,i)=>{
      const w=effectFor(card.effect,'wheelchair'), b=effectFor(card.effect,'blind');
      h+=`<div class="card-edit" data-pile="${pk}" data-idx="${i}">
        <div class="titlerow"><input style="flex:1" id="c_${pk}_${i}_title" value="${escAttr(card.title)}" placeholder="卡名">
          <button class="btn mini-btn" onclick="delCard('${pk}',${i})">删除</button></div>
        <textarea id="c_${pk}_${i}_desc" placeholder="描述">${escHtml(card.desc||'')}</textarea>
        <div class="eff-inputs">${effGroup(`c_${pk}_${i}_w`,w,'轮椅 ♿')}${effGroup(`c_${pk}_${i}_b`,b,'视障 🧑‍🦯')}</div>
      </div>`;
    });
  });
  return h;
}
function cfgActivitiesHtml(){
  let h='<div class="cfg-note">活动卡：每阶段随机抽 1 张放到活动区。capacity=同时容纳人数。小游戏用于活动区多人互动。<button class="btn mini-btn" onclick="addActivity()">+ 新增活动</button></div>';
  DATA.activities.forEach((a,i)=>{
    const w=effectFor(a.reward,'wheelchair'), b=effectFor(a.reward,'blind');
    h+=`<div class="card-edit" data-idx="${i}">
      <div class="titlerow"><input style="flex:1" id="a_${i}_title" value="${escAttr(a.title)}" placeholder="活动名">
        容量<input type="number" style="width:60px" id="a_${i}_cap" value="${a.capacity}">
        <button class="btn mini-btn" onclick="delActivity(${i})">删除</button></div>
      <textarea id="a_${i}_desc" placeholder="活动描述">${escHtml(a.desc||'')}</textarea>
      <textarea id="a_${i}_mini" placeholder="互动小游戏说明">${escHtml(a.minigame||'')}</textarea>
      <div class="eff-inputs">${effGroup(`a_${i}_w`,w,'轮椅奖励')}${effGroup(`a_${i}_b`,b,'视障奖励')}</div>
    </div>`;
  });
  return h;
}
function escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s){ return (s||'').replace(/"/g,'&quot;'); }

/* 从表单收集回 DATA */
function collectCfg(){
  const g=id=>document.getElementById(id);
  if(cfgTab==='rules'){
    const r=CFG.rules,t=CFG.tasks;
    if(g('r_auto')){ r.startAuto=+g('r_auto').value; r.startStam=+g('r_stam').value; r.startJoy=+g('r_joy').value;
      r.stamPerPhase=+g('r_pp').value; r.callStaffAutoCost=+g('r_call').value;
      r.liftRideStam=+g('r_lift').value;
      r.liftStairWheelchairAutoCost=+g('r_wchair').value; r.stairGuideBlindAutoCost=+g('r_guide').value;
      r.stairGuideBlindStam=+g('r_guides').value; r.stairSelfBlindStam=+g('r_selfs').value;
      r.turnOrderStamBonus=g('r_bonus0').value.split(',').map(x=>+x.trim());
      if(g('r_fin')) r.finishOrderJoyBonus=g('r_fin').value.split(',').map(x=>+x.trim());
      t.galleriesEach=+g('t_gal').value; t.activityExactly=+g('t_act').value; t.toiletMin=+g('t_tmin').value; t.toiletMax=+g('t_tmax').value;
      // 移动体力表（对称写回双向）
      const order=['rest','toilet','lobby','hall1','hall2','activity'];
      for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++){
        const a=order[i],b=order[j], inp=g(`mc_${a}_${b}`);
        if(inp && inp.value!==''){ const v=+inp.value; CFG.moveCost[a]=CFG.moveCost[a]||{}; CFG.moveCost[b]=CFG.moveCost[b]||{}; CFG.moveCost[a][b]=v; CFG.moveCost[b][a]=v; }
      }
    }
  }else if(cfgTab==='rooms'){
    Object.entries(CFG.rooms).forEach(([rid,d])=>{ if(g(`rc_${rid}_cap`)){ d.capacity=+g(`rc_${rid}_cap`).value; d.reward={auto:+g(`rc_${rid}_a`).value,stam:+g(`rc_${rid}_s`).value,joy:+g(`rc_${rid}_j`).value}; } });
  }else if(cfgTab==='activities'){
    DATA.activities.forEach((a,i)=>{ if(g(`a_${i}_title`)){ a.title=g(`a_${i}_title`).value; a.capacity=+g(`a_${i}_cap`).value; a.desc=g(`a_${i}_desc`).value; a.minigame=g(`a_${i}_mini`).value;
      a.reward=collectEff(`a_${i}`); } });
  }else{
    const map={toilet:['toilet_seat','toilet_sink','toilet_extra'],gallery:['gallery'],lift:['lift'],stairs:['stairs']};
    (map[cfgTab]||[]).forEach(pk=>{ DATA.cards[pk].forEach((card,i)=>{ if(g(`c_${pk}_${i}_title`)){ card.title=g(`c_${pk}_${i}_title`).value; card.desc=g(`c_${pk}_${i}_desc`).value; card.effect=collectEff(`c_${pk}_${i}`); } }); });
  }
}
function collectEff(prefix){
  const g=id=>document.getElementById(id);
  const w={auto:+g(`${prefix}_w_a`).value,stam:+g(`${prefix}_w_s`).value,joy:+g(`${prefix}_w_j`).value};
  const b={auto:+g(`${prefix}_b_a`).value,stam:+g(`${prefix}_b_s`).value,joy:+g(`${prefix}_b_j`).value};
  if(JSON.stringify(w)===JSON.stringify(b)) return w;         // 相同则合并写法
  return {wheelchair:w, blind:b};
}
function addCard(pk){ collectCfg(); DATA.cards[pk].push({title:'新卡',desc:'',effect:{auto:0,stam:0,joy:0}}); renderCfgTab(); }
function delCard(pk,i){ collectCfg(); DATA.cards[pk].splice(i,1); renderCfgTab(); }
function addActivity(){ collectCfg(); DATA.activities.push({title:'新活动',capacity:4,reward:{auto:0,stam:0,joy:0},desc:'',minigame:''}); renderCfgTab(); }
function delActivity(i){ collectCfg(); DATA.activities.splice(i,1); renderCfgTab(); }
window.addCard=addCard; window.delCard=delCard; window.addActivity=addActivity; window.delActivity=delActivity;

/* ============ 悬浮提示 ============ */
function initTooltips(){
  const tip=$('#tooltip');
  document.addEventListener('mouseover',e=>{
    const el2=e.target.closest('[data-tip]');
    if(el2){ tip.textContent=el2.dataset.tip; tip.classList.remove('hidden'); }
  });
  document.addEventListener('mousemove',e=>{
    if(!tip.classList.contains('hidden')){ tip.style.left=Math.min(e.clientX+14,window.innerWidth-280)+'px'; tip.style.top=(e.clientY+14)+'px'; }
  });
  document.addEventListener('mouseout',e=>{ if(e.target.closest('[data-tip]')) tip.classList.add('hidden'); });
}

/* ============ 引导 ============ */
function boot(){
  $('#btnNewGame').onclick=()=>{ if(Net.mode==='guest'){ toast('客人无法开新局，请由房主开始'); return;} newGame(); };
  $('#btnRules').onclick=openRules;
  $('#btnConfig').onclick=openConfig;
  $('#btnRoom').onclick=openRoomDialog;
  $('#btnMute').onclick=()=>{ SFX.muted=!SFX.muted; $('#btnMute').textContent=SFX.muted?'🔇':'🔊'; };
  initTooltips();
  updateNetChip();
  newGame();  // 默认本地开一局
}
document.addEventListener('DOMContentLoaded', boot);

window.__engineLoaded = true;
