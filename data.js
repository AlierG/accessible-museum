/* =========================================================================
 * 有障碍博物馆  —  默认配置与卡牌数据
 * -------------------------------------------------------------------------
 * 这个文件里的所有内容都可以在网页右侧的「配置」面板里修改并保存。
 * 保存后会写入浏览器 localStorage，覆盖这里的默认值。
 * 想恢复出厂设置，在配置面板点「恢复默认」即可。
 *
 * 术语：
 *   auto  = 自主度   （可负）
 *   stam  = 体力
 *   joy   = 愉悦度   （可负）
 *
 * 玩家类型：
 *   wheelchair = 轮椅使用者（红、蓝）
 *   blind      = 视力障碍者（绿、黄）
 *
 * 事件卡的属性增减写法：
 *   effect: { auto: 0, stam: 0, joy: 0 }              // 所有人相同
 *   effect: { wheelchair:{...}, blind:{...} }          // 两类人不同
 * ========================================================================= */

const DEFAULT_CONFIG = {

  /* ---------- 基础数值（调平衡主要改这里） ---------- */
  rules: {
    startAuto: 3,          // 初始自主度
    startStam: 3,          // 初始体力
    startJoy: 1,           // 初始愉悦度

    // 开场先后手体力奖励：第1个行动+0，第2个+1，第3个+2，第4个+3
    turnOrderStamBonus: [0, 1, 2, 3],

    // 每个新阶段开始时每人获得的体力（第一个阶段不给，见规则）
    stamPerPhase: 2,

    callStaffAutoCost: 1,  // 呼叫工作人员送去休息室 -自主度（不耗体力）

    // ---- 上下楼（经无障碍电梯/楼梯，占用一整回合） ----
    liftRideStam: 1,       // 乘电梯上/下楼消耗体力
    // 轮椅：叫工作人员从楼梯抬 -自主度（不耗体力）
    liftStairWheelchairAutoCost: 2,
    // 视障：工作人员带领走楼梯 -自主度 + 体力
    stairGuideBlindAutoCost: 1,
    stairGuideBlindStam: 1,
    // 视障：自行走楼梯消耗体力
    stairSelfBlindStam: 2,

    totalTurnsPerPlayer: 10,   // 每人总回合数（提示用）

    // 完成全部参观任务的先后奖励愉悦度：第1个完成+3，第2个+2，第3个+1，第4个+0
    finishOrderJoyBonus: [3, 2, 1, 0],
  },

  /* ---------- 玩家 ---------- */
  players: [
    { id: 'red',    name: '红',  type: 'wheelchair', icon: '♿', color: '#e0483d' },
    { id: 'blue',   name: '蓝',  type: 'wheelchair', icon: '♿', color: '#2f6fd0' },
    { id: 'green',  name: '绿',  type: 'blind',      icon: '🧑‍🦯', color: '#3aa35a' },
    { id: 'yellow', name: '黄',  type: 'blind',      icon: '🧑‍🦯', color: '#e6b422' },
  ],

  /* ---------- 阶段 ---------- */
  phases: ['上午', '中午', '下午', '傍晚', '夜场'],

  /* ---------- 地图房间 ----------
   * capacity: 同时容纳 token 数（活动区由活动卡决定，这里写默认）
   * reward:   成功「访问」该房间后获得的固定奖励（在事件结算之后叠加）
   * needsCard:是否需要抽事件卡
   * upstairs: 是否在楼上（影响上下楼规则）
   * hot:      在地图图片上的热区坐标（百分比 left/top/width/height）
   */
  rooms: {
    lobby:    { name: '大厅',       capacity: 99, needsCard: false, reward: { auto:0, stam:0, joy:0 }, upstairs:false, hot:{left:38,top:40,width:24,height:45} },
    toilet:   { name: '无障碍厕所', capacity: 1,  needsCard: 'toilet', reward: { auto:0, stam:0, joy:1 }, upstairs:false, hot:{left:0,top:0,width:22,height:36} },
    rest:     { name: '休息区',     capacity: 99, needsCard: false, reward: { auto:0, stam:5, joy:2 }, upstairs:false, hot:{left:0,top:45,width:22,height:52} },
    hall1:    { name: '第一展厅',   capacity: 3,  needsCard: 'gallery', reward: { auto:0, stam:1, joy:3 }, upstairs:false, hot:{left:63,top:62,width:37,height:37} },
    hall2:    { name: '第二展厅',   capacity: 2,  needsCard: 'gallery', reward: { auto:0, stam:1, joy:2 }, upstairs:false, hot:{left:63,top:36,width:37,height:24} },
    hall3:    { name: '第三展厅',   capacity: 3,  needsCard: 'gallery', reward: { auto:0, stam:1, joy:4 }, upstairs:true,  hot:{left:31,top:0,width:33,height:34} },
    lift:     { name: '无障碍电梯', capacity: 1,  needsCard: 'lift',   reward: { auto:0, stam:0, joy:0 }, upstairs:false, transit:true, hot:{left:33,top:20,width:14,height:18} },
    stairs:   { name: '无障碍楼梯', capacity: 99, needsCard: 'stairs', reward: { auto:0, stam:0, joy:0 }, upstairs:false, transit:true, hot:{left:47,top:15,width:16,height:20} },
    activity: { name: '活动区',     capacity: 4,  needsCard: false, reward: { auto:0, stam:0, joy:0 }, upstairs:false, hot:{left:64,top:0,width:36,height:34} },
  },
  /* 电梯/楼梯是「过路点」，不能作为直接前往的目的地：
   * 只有上/下楼时 token 会临时停在上面消耗那一回合（见引擎 transit 逻辑）。 */

  /* ---------- 移动体力消耗表（双向、按距离） ----------
   * 一楼各房间之间可直接前往，消耗对应体力。第三展厅(hall3)不在此表中，
   * 上下楼必须经无障碍电梯/楼梯（见引擎的上下楼逻辑），单独计算。
   * 电梯(lift)/楼梯(stairs)不是可直接前往的目的地，只在上下楼时经过。
   */
  moveCost: {
    rest:     { toilet:1, lobby:1, hall1:2, hall2:3, activity:4 },
    toilet:   { rest:1, lobby:1, hall1:2, hall2:3, activity:4 },
    lobby:    { rest:1, toilet:1, hall1:1, hall2:2, activity:3 },
    hall1:    { rest:2, toilet:2, lobby:1, hall2:1, activity:2 },
    hall2:    { rest:3, toilet:3, lobby:2, hall1:1, activity:1 },
    activity: { rest:4, toilet:4, lobby:3, hall1:2, hall2:1 },
  },

  /* ---------- 参观任务（获胜条件） ---------- */
  tasks: {
    galleriesEach: 1,   // 三个展厅各至少访问 1 次
    activityExactly: 1, // 活动区恰好 1 次
    toiletMin: 1,       // 无障碍厕所至少 1 次
    toiletMax: 3,       // 最多 3 次
  },
};

/* =========================================================================
 *  事件卡组
 *  effect 为负表示扣减。三类玩家不同时用 { wheelchair:{}, blind:{} }
 * ========================================================================= */

const DEFAULT_CARDS = {

  /* ---------- 无障碍厕所：三个区域各一套，访问时各抽 1 张，代价求和 ---------- */
  toilet_seat: [
    { title:'规范安全抓杆', desc:'坐便器两侧抓杆位置、高度都符合规范，转移轻松安全。', effect:{ wheelchair:{auto:2,stam:-1,joy:2}, blind:{auto:1,stam:0,joy:1} } },
    { title:'坐便圈松动', desc:'没有安全抓杆，坐便圈还在晃，转移时差点摔下去，只能找人帮忙。', effect:{ wheelchair:{auto:-3,stam:-3,joy:-3}, blind:{auto:-1,stam:-2,joy:-2} } },
    { title:'高度合适', desc:'坐便器高度适中，起身省力。', effect:{ auto:1, stam:0, joy:1 } },
    { title:'冲水按钮太高', desc:'冲水按钮装在高处，够不着，得费力伸手。', effect:{ wheelchair:{auto:-1,stam:-1,joy:-1}, blind:{auto:0,stam:-1,joy:-1} } },
    { title:'语音提示完善', desc:'马桶区有清晰的语音与盲文标识。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:2,stam:0,joy:2} } },
  ],
  toilet_sink: [
    { title:'低位洗手台', desc:'洗手台下方有容膝空间，轮椅可以推进去。', effect:{ wheelchair:{auto:2,stam:0,joy:1}, blind:{auto:0,stam:0,joy:1} } },
    { title:'感应水龙头', desc:'感应出水，不用拧，很方便。', effect:{ auto:1, stam:0, joy:1 } },
    { title:'镜子太高', desc:'镜子只装在站立高度，坐着照不到。', effect:{ wheelchair:{auto:-1,stam:0,joy:-2}, blind:{auto:0,stam:0,joy:0} } },
    { title:'地面湿滑', desc:'洗手池周围地面积水湿滑，移动要格外小心。', effect:{ wheelchair:{auto:-1,stam:-1,joy:-1}, blind:{auto:-2,stam:-1,joy:-2} } },
    { title:'盲文标识清晰', desc:'冷热水与皂液都有盲文和触感标识。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:2,stam:0,joy:2} } },
  ],
  toilet_extra: [
    { title:'紧急呼叫按钮', desc:'墙上有伸手可及的紧急呼叫拉绳，很安心。', effect:{ auto:1, stam:0, joy:2 } },
    { title:'挂钩与置物台', desc:'合适高度的挂钩和置物台，东西有地方放。', effect:{ wheelchair:{auto:1,stam:0,joy:1}, blind:{auto:0,stam:0,joy:1} } },
    { title:'门锁难开', desc:'门锁又紧又高，关门费了半天劲。', effect:{ wheelchair:{auto:-2,stam:-1,joy:-1}, blind:{auto:-1,stam:-1,joy:-1} } },
    { title:'空间太窄', desc:'隔间空间局促，轮椅几乎转不了身。', effect:{ wheelchair:{auto:-2,stam:-2,joy:-2}, blind:{auto:0,stam:0,joy:0} } },
    { title:'照明充足', desc:'照明明亮均匀，标识看得清。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:1,stam:0,joy:1} } },
  ],

  /* ---------- 三个展厅共用的 20 张事件卡 ---------- */
  gallery: [
    { title:'低位服务台', desc:'前台设有低位服务台，坐着也能顺畅咨询。', effect:{ wheelchair:{auto:2,stam:0,joy:1}, blind:{auto:0,stam:0,joy:1} } },
    { title:'展台容膝空间', desc:'展台下方留有容膝空间，可以贴近观看。', effect:{ wheelchair:{auto:2,stam:0,joy:2}, blind:{auto:0,stam:0,joy:1} } },
    { title:'展台过高', desc:'展台特别高，看展品很费力。', effect:{ wheelchair:{auto:-1,stam:-2,joy:-2}, blind:{auto:0,stam:-1,joy:-1} } },
    { title:'玻璃罩展品', desc:'展品被玻璃罩罩住，不能触摸，也没有视障辅助。', effect:{ wheelchair:{auto:0,stam:0,joy:-1}, blind:{auto:-2,stam:-1,joy:-3} } },
    { title:'可触摸复制品', desc:'提供可触摸的展品复制品，还有盲文说明。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:3,stam:0,joy:3} } },
    { title:'语音导览', desc:'扫码即可听到详细的语音导览讲解。', effect:{ wheelchair:{auto:1,stam:0,joy:2}, blind:{auto:2,stam:0,joy:2} } },
    { title:'字幕视频', desc:'展厅视频配有字幕，可惜没有语音描述。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:0,stam:0,joy:-1} } },
    { title:'通道被展架挡住', desc:'临时展架把通道占窄了，轮椅通行困难。', effect:{ wheelchair:{auto:-2,stam:-2,joy:-1}, blind:{auto:-1,stam:-1,joy:-1} } },
    { title:'地面导盲带', desc:'地面铺设了连续的导盲带，行走安心。', effect:{ wheelchair:{auto:0,stam:0,joy:0}, blind:{auto:2,stam:0,joy:2} } },
    { title:'休息座椅', desc:'展厅里设有休息座椅，可以缓口气。', effect:{ auto:0, stam:2, joy:1 } },
    { title:'灯光昏暗', desc:'为保护展品灯光调得很暗，看说明牌吃力。', effect:{ wheelchair:{auto:0,stam:0,joy:-1}, blind:{auto:-1,stam:-1,joy:-1} } },
    { title:'大字说明牌', desc:'说明牌采用大字号高对比设计，阅读轻松。', effect:{ wheelchair:{auto:1,stam:0,joy:1}, blind:{auto:1,stam:0,joy:2} } },
    { title:'互动展项无障碍', desc:'互动装置高度合适、有语音反馈，人人可玩。', effect:{ auto:2, stam:0, joy:2 } },
    { title:'门槛与台阶', desc:'展厅入口有一道小台阶，没有坡道。', effect:{ wheelchair:{auto:-2,stam:-2,joy:-2}, blind:{auto:-1,stam:-1,joy:0} } },
    { title:'志愿者讲解', desc:'热心志愿者主动上前提供讲解和引导。', effect:{ auto:1, stam:0, joy:2 } },
    { title:'展签位置太低', desc:'展签贴得很低，视障者的手持放大设备用不上。', effect:{ wheelchair:{auto:0,stam:0,joy:0}, blind:{auto:-1,stam:0,joy:-1} } },
    { title:'空间宽敞', desc:'展线宽敞，轮椅回转空间充足。', effect:{ wheelchair:{auto:1,stam:0,joy:2}, blind:{auto:0,stam:0,joy:1} } },
    { title:'嘈杂拥挤', desc:'团队观众涌入，又吵又挤，难以专心。', effect:{ auto:-1, stam:-1, joy:-2 } },
    { title:'气味展项', desc:'一处可闻可听的多感官展项，体验很特别。', effect:{ wheelchair:{auto:0,stam:0,joy:2}, blind:{auto:1,stam:0,joy:3} } },
    { title:'无障碍地图', desc:'入口处提供无障碍参观路线图和触感模型。', effect:{ wheelchair:{auto:2,stam:0,joy:1}, blind:{auto:2,stam:0,joy:1} } },
  ],

  /* ---------- 无障碍电梯：6 张（卡面像电梯，翻面是开门后的样子） ---------- */
  lift: [
    { title:'宽敞平层电梯', desc:'轿厢宽敞、平层准确，进出顺畅。', effect:{ wheelchair:{auto:2,stam:0,joy:1}, blind:{auto:1,stam:0,joy:1} } },
    { title:'语音报层', desc:'电梯有清晰语音报层和盲文按钮。', effect:{ wheelchair:{auto:0,stam:0,joy:1}, blind:{auto:2,stam:0,joy:2} } },
    { title:'按钮太高', desc:'楼层按钮装得偏高，坐着够按钮很吃力。', effect:{ wheelchair:{auto:-1,stam:-1,joy:-1}, blind:{auto:0,stam:0,joy:0} } },
    { title:'轿厢狭小', desc:'轿厢很小，轮椅勉强挤进去，无法转身。', effect:{ wheelchair:{auto:-2,stam:-1,joy:-2}, blind:{auto:0,stam:0,joy:-1} } },
    { title:'镜面后视', desc:'轿厢后壁有镜子，方便倒退出来时观察。', effect:{ wheelchair:{auto:1,stam:0,joy:1}, blind:{auto:0,stam:0,joy:0} } },
    { title:'电梯故障', desc:'电梯临时故障，只能等待或改走楼梯。', effect:{ auto:-1, stam:-1, joy:-2 } },
  ],

  /* ---------- 无障碍楼梯：6 张 ---------- */
  stairs: [
    { title:'双侧扶手', desc:'楼梯两侧都有连续扶手，抓握稳当。', effect:{ wheelchair:{auto:0,stam:-1,joy:0}, blind:{auto:2,stam:-1,joy:1} } },
    { title:'防滑与警示条', desc:'台阶有防滑条和边缘警示色，下脚踏实。', effect:{ wheelchair:{auto:0,stam:-1,joy:0}, blind:{auto:2,stam:-1,joy:2} } },
    { title:'盲文扶手标识', desc:'扶手端部有盲文楼层提示。', effect:{ wheelchair:{auto:0,stam:-1,joy:0}, blind:{auto:1,stam:-1,joy:2} } },
    { title:'台阶过陡', desc:'台阶又高又陡，爬得气喘吁吁。', effect:{ wheelchair:{auto:-1,stam:-3,joy:-2}, blind:{auto:-1,stam:-2,joy:-1} } },
    { title:'照明不足', desc:'楼梯间光线昏暗，看不清踏步边缘。', effect:{ wheelchair:{auto:0,stam:-2,joy:-1}, blind:{auto:-2,stam:-2,joy:-2} } },
    { title:'无休息平台', desc:'一长跑到底没有休息平台，很累。', effect:{ wheelchair:{auto:0,stam:-2,joy:-1}, blind:{auto:0,stam:-2,joy:-1} } },
  ],
};

/* =========================================================================
 *  活动卡：每个阶段开始抽 1 张放在活动区。可自由增删改。
 *  capacity : 该活动同时容纳人数
 *  reward   : 成功参加后获得（活动区参加恰好 1 次）
 *  minigame : 若本回合活动区有多人，可进行的互动小游戏说明
 * ========================================================================= */

const DEFAULT_ACTIVITIES = [
  { title:'无障碍讲座', capacity:4, reward:{ auto:1, stam:0, joy:3 },
    desc:'一场关于通用设计的讲座，配有手语翻译与实时字幕。',
    minigame:'同在活动区的玩家轮流说出一个身边的「无障碍设计」例子，说不出的人 -1 愉悦度。' },
  { title:'触觉工作坊', capacity:3, reward:{ wheelchair:{auto:1,stam:0,joy:2}, blind:{auto:2,stam:0,joy:3} },
    desc:'用黏土和拓印制作触觉展品，闭眼也能创作。',
    minigame:'蒙眼互相猜对方捏的形状，猜中最多的人 +1 愉悦度。' },
  { title:'轮椅体验赛', capacity:4, reward:{ wheelchair:{auto:2,stam:-1,joy:2}, blind:{auto:1,stam:-1,joy:2} },
    desc:'坐上轮椅走一段带坡道和窄门的体验路线。',
    minigame:'比谁能用最少步数描述从大厅到第三展厅的无障碍路线。' },
  { title:'手语歌会', capacity:4, reward:{ auto:0, stam:1, joy:3 },
    desc:'跟着老师学一首歌的手语版本，轻松又欢乐。',
    minigame:'一起用手语比划一个词，让其他玩家猜，猜中双方各 +1 愉悦度。' },
  { title:'导盲犬见面会', capacity:2, reward:{ wheelchair:{auto:0,stam:0,joy:3}, blind:{auto:2,stam:0,joy:3} },
    desc:'认识导盲犬的工作，了解如何正确与它相处。',
    minigame:'说出三条「遇到导盲犬时该做/不该做」的准则，说全的人 +1 自主度。' },
];

/* 挂到全局，供其他脚本读取 */
window.GAME_DEFAULTS = {
  config: DEFAULT_CONFIG,
  cards: DEFAULT_CARDS,
  activities: DEFAULT_ACTIVITIES,
};
