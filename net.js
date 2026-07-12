/* =========================================================================
 * net.js  —  联机同步层（基于 PeerJS）
 * -------------------------------------------------------------------------
 * 设计：主机权威（host authoritative）。
 *   - 房主(host)持有唯一真实的游戏状态；所有玩家的操作都发给房主执行。
 *   - 房主执行后，把最新完整状态广播给所有人。
 *   - 客人(guest)只发送「意图(action)」，并渲染房主回传的状态。
 *
 * 房间号 = PeerJS 的 id 前缀。房主用固定 id，客人连到该 id。
 *
 * 如果 PeerJS(CDN) 不可用，Net 保持 mode='local'，游戏在本地热座运行，
 * 所有人共用一台设备轮流操作，功能完全一致。
 * ========================================================================= */

const Net = {
  mode: 'local',          // 'local' | 'host' | 'guest'
  room: null,
  peer: null,
  conns: [],              // host: 到各客人的连接；guest: [到房主的连接]
  myPlayerId: null,       // 本机绑定的玩家(单机时为 null，表示可操作所有人)
  onAction: null,         // host: 收到客人 action 时的回调 (action)=>{}
  onState:  null,         // guest: 收到状态时的回调 (state)=>{}
  onPeers:  null,         // 连接数变化回调
  _prefix: 'accmuseum-',  // 房间号前缀，尽量避免与他人 id 冲突

  available(){ return typeof Peer !== 'undefined'; },

  /* 房主创建房间 */
  host(room){
    if(!this.available()) return Promise.reject('PeerJS 不可用');
    this.mode='host'; this.room=room;
    return new Promise((res,rej)=>{
      this.peer = new Peer(this._prefix+room);
      this.peer.on('open', id=>{ res(id); });
      this.peer.on('error', e=>{ rej(e); });
      this.peer.on('connection', conn=>{
        conn.on('open', ()=>{
          this.conns.push(conn);
          this._firePeers();
          // 新客人接入，立即推送当前状态
          if(this._lastState) conn.send({t:'state', state:this._lastState});
        });
        conn.on('data', msg=>{
          if(msg.t==='action' && this.onAction) this.onAction(msg.action, conn);
        });
        conn.on('close', ()=>{
          this.conns = this.conns.filter(c=>c!==conn);
          this._firePeers();
        });
      });
    });
  },

  /* 客人加入房间 */
  join(room){
    if(!this.available()) return Promise.reject('PeerJS 不可用');
    this.mode='guest'; this.room=room;
    return new Promise((res,rej)=>{
      this.peer = new Peer();  // 随机 id
      this.peer.on('open', ()=>{
        const conn = this.peer.connect(this._prefix+room, {reliable:true});
        this.conns=[conn];
        conn.on('open', ()=>{ this._firePeers(); res(); });
        conn.on('data', msg=>{
          if(msg.t==='state' && this.onState) this.onState(msg.state);
        });
        conn.on('error', e=>rej(e));
        setTimeout(()=>{ if(conn.open!==true) rej('连接超时，请确认房间号或房主是否在线'); }, 8000);
      });
      this.peer.on('error', e=>rej(e));
    });
  },

  _lastState:null,
  /* 房主广播状态 */
  broadcast(state){
    this._lastState=state;
    this.conns.forEach(c=>{ try{ c.send({t:'state', state}); }catch(e){} });
  },

  /* 客人发送操作意图 */
  sendAction(action){
    if(this.mode==='guest' && this.conns[0]){ try{ this.conns[0].send({t:'action', action}); }catch(e){} }
  },

  peerCount(){ return this.conns.length; },
  _firePeers(){ if(this.onPeers) this.onPeers(this.peerCount()); },

  leave(){
    try{ this.conns.forEach(c=>c.close()); }catch(e){}
    try{ this.peer && this.peer.destroy(); }catch(e){}
    this.conns=[]; this.peer=null; this.mode='local'; this.room=null; this._lastState=null;
  }
};

window.Net = Net;
