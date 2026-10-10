# MyCard YGOPro 实时观战统计：接手说明

这份文档是给后续接手这套代码的人看的。目标不是解析本地 `.yrp` 文件，而是连接萌卡 MyCard / YGOPro 实时对局服务，采集对局数据并统计卡牌胜率。

## 1. 最重要的结论

萌卡官方服务器的普通观战流可以实时收到对局消息，但服务端会主动把**起手抽牌的卡号抹成 `0`**。

真实抓到的数据长这样：

```text
YGOProMsgDraw { player: 0, count: 5, cards: [0, 0, 0, 0, 0] }
```

所以，只用普通观战客户端连接官方服务器，无法得到严格的“某张卡是否在起手”。这不是解析代码的问题，而是服务端隐私处理。

当前程序提供三条数据路径：

1. 官方普通观战：能拿到胜者、先后手、公开区域卡号、起手是否被隐藏。
2. 官方卡组统计接口：能拿到卡组级先手/后手胜率。
3. 自有 srvpro 服务器：打开完整手牌开关后，能拿到真实起手卡号，从而计算单卡上手胜率。

## 2. 工程结构

```text
D:\Code\ygo\tongji
├─ package.json
├─ pnpm-lock.yaml
├─ cards.cdb                 本地卡片数据库，用于卡号转卡名
├─ README.md                 用户使用说明
├─ HANDOFF.md                本说明
├─ src
│  ├─ index.js               CLI 入口
│  └─ lib
│     ├─ constants.js        服务器地址、协议版本、路径常量
│     ├─ protocol.js         加入密码算法、数据包构造与解析
│     ├─ room-list.js        萌卡房间列表 WebSocket 客户端
│     ├─ mycard.js           MyCard 登录 token 与 API 请求
│     ├─ spectator.js        YGOPro TCP 观战连接
│     ├─ duel-collector.js   对局事件到结构化记录的转换
│     ├─ stats.js            先手/后手、胜率聚合
│     ├─ cards.js            本地 cards.cdb 卡名查询
│     └─ storage.js          JSONL 保存和读取
├─ test
│  ├─ protocol.test.js
│  └─ stats.test.js
└─ .ref                      调查时保留的参考源码，不是运行依赖
```

`.ref/` 不是程序运行依赖。里面是之前调研时克隆的 `srvpro`、`ygopro-server`、`mycard-assistant` 等参考代码，需要追协议细节时可以查看；不需要时可以删除。

## 3. 环境与依赖

- Node.js 18 以上，当前在 Node 24 下验证。
- 包管理使用 pnpm。本机没有全局 npm 时，可以使用 Codex 自带的：

```powershell
C:\Users\20305\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs
```

- 核心依赖：
  - `ygopro-msg-encode`：YGOPro CTOS / STOC / MSG 二进制协议编解码。
  - `sql.js`：读取本地 `cards.cdb`。
  - `ygopro-yrp-encode`：目前保留，必要时可解析 `.yrp`。

安装依赖：

```powershell
node .\node_modules\pnpm\bin\pnpm.cjs install
```

## 4. 当前可用命令

```powershell
# 当前已开始的官方对局
node src/index.js rooms

# 当前登录身份和 u16Secret
node src/index.js auth

# 官方卡组先手/后手胜率
node src/index.js analytics --type week --limit 20

# 观战一个官方房间
node src/index.js watch "M#roomId" --timeout 30

# 自动轮换观战官方已开始房间
node src/index.js watch-auto --seconds 3600 --parallel 2

# 从 JSONL 结果重新计算卡牌胜率
node src/index.js stats data/auto-watch.jsonl

# 自有服务器观战，使用普通房间密码
node src/index.js watch "RoomName" --host 127.0.0.1 --port 7911 --password "密码" --name "stat-bot"
```

## 5. 关键服务器与接口

### 5.1 萌卡房间列表

```text
wss://tiramisu.moecube.com:8923/?filter=started
```

连接后会收到一条 JSON 文本消息：

```json
{
  "event": "init",
  "data": [
    {
      "id": "M#roomId",
      "users": [
        { "username": "玩家A", "position": 0 },
        { "username": "玩家B", "position": 1 }
      ],
      "options": {
        "mode": 1,
        "start_hand": 5,
        "no_watch": false,
        "replay_mode": 2
      },
      "arena": "athletic"
    }
  ]
}
```

### 5.2 YGOPro 游戏服务器

```text
tiramisu.moenext.com:8911
```

当前协议版本：

```text
4962
```

### 5.3 萌卡账户接口

```text
GET https://api.moecube.com/accounts/authUser
Authorization: Bearer <MyCard JWT>
```

响应里的 `u16Secret` 每 4 分钟轮换一次。程序会缓存 3 分钟，自动采集时会及时刷新。

### 5.4 官方卡组统计接口

```text
GET https://sapi.moecube.com:444/ygopro/analytics/deck/type
    ?type=week
    &source=mycard-athletic
```

返回内容包含卡组名、总局数、标签，以及：

```json
{
  "matchup": {
    "first": { "decka": "盈彩月夜", "win": "4800", "lose": "3330" },
    "second": { "deckb": "盈彩月夜", "win": "4126", "lose": "3808" }
  }
}
```

这是官方已经聚合好的**卡组级**先手/后手胜率，不是单卡胜率。

## 6. 观战协议细节

### 6.1 TCP 数据包格式

每个 CTOS / STOC 数据包格式：

```text
[uint16 LE: total_len][uint8: identifier][body]

total_len = 1 + body.length
```

`ygopro-msg-encode` 的 `toFullPayload()` 已经自动带上这个两字节长度头和协议 ID，因此可以直接 `socket.write(payload)`。

### 6.2 官方观战加入密码

官方房间的加入密码不是房间 ID 本身，而是：

```text
joinPassword = secretToken(u16Secret) + roomId
```

核心算法：

```js
function makeSecretToken(secret) {
  const b = Buffer.from([0xd0, 0x30, 0, 0, 0, 0]);
  const r = (secret % 0xffff) + 1;

  for (let t = 0; t < 6; t += 2) {
    const k = ((b[t + 1] << 8) | b[t]) ^ r;
    b[t] = k & 0xff;
    b[t + 1] = (k >>> 8) & 0xff;
  }

  return b.toString("base64");
}
```

源码位置：[src/lib/protocol.js](src/lib/protocol.js)

### 6.3 成为观战者

连接成功后按顺序发送：

```text
CTOS_PlayerInfo   name = 当前用户名
CTOS_JoinGame     version = 4962
                  gameid = 0
                  pass = secretToken + roomId
CTOS_HsToObserver
```

对自有服务器，`CTOS_JoinGame.pass` 就是房间密码。

### 6.4 重要 STOC 标识

```text
STOC_GAME_MSG        0x01
STOC_ERROR_MSG       0x02
STOC_JOIN_GAME       0x12
STOC_TYPE_CHANGE     0x13
STOC_DUEL_START      0x15
STOC_DUEL_END        0x16
STOC_REPLAY          0x17
STOC_CHAT            0x19
STOC_HS_PLAYER_ENTER 0x20
```

### 6.5 重要 Game Message

当前程序主要处理：

```text
YGOProMsgStart      对局开始，含卡组数量和换边标记
YGOProMsgWin        胜者
YGOProMsgDraw       抽牌；起手卡在官方流里被抹成 0
YGOProMsgMove       卡片移动
YGOProMsgUpdateData 区域批量更新
YGOProMsgUpdateCard 单卡更新
```

`YGOProMsgStart` 在观战视角里，`playerNumber` 的低位不是“先手玩家编号”，而是换边标记：

```text
0 = 位置 0 的玩家是先手
1 = 位置 1 的玩家是先手
```

当前代码据此计算：

```js
const swapped = msg.playerNumber === 1;
const firstPosition = swapped ? 1 : 0;
const secondPosition = swapped ? 0 : 1;
```

## 7. 为什么官方流拿不到完整手牌

从参考的 `ygopro-server` 源码可以看到，服务端对 `MSG_DRAW` 做了两套发送路径：

1. 发给自己：保留真实卡号。
2. 发给对手和普通观战者：把大部分卡号替换成 `0`。

服务端内部还有两个特殊连接：

```text
the Big Brother = 缓存观战流，仍是公开视角
Marshtomp      = 完整录像流，保留真实起手
```

但萌卡自己的 `srvpro` 层会拒绝外部客户端直接使用这两个特殊密码。所以普通官方观战无法绕过这个限制。

唯一能得到真实起手的正规方式，是使用自己控制的 srvpro 服务器，打开下面的配置：

```json
"test_mode": {
  "watch_public_hand": true
}
```

打开后，后进入的观战者会走服务端内部的全量录像连接，`MSG_DRAW` 中会保留真实起手卡号。

## 8. 登录信息读取

本机 MyCard Electron 客户端的 Local Storage 位于：

```text
C:\Users\20305\AppData\Roaming\MyCard\Local Storage\leveldb
```

程序会扫描 `.ldb` 和 `.log` 文件中的 JWT：

```regex
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}
```

然后按 JWT 的 `iat` 选择最新、未过期的 token。

也可以手动传入：

```powershell
node src/index.js auth --token "你的JWT"
node src/index.js watch "M#roomId" --token "你的JWT"
```

## 9. 数据流与统计口径

### 9.1 采集记录

`DuelCollector` 会把一个观战会话整理成：

```json
{
  "roomId": "M#xxx",
  "users": ["玩家A", "玩家B"],
  "hostInfo": {},
  "rounds": [
    {
      "firstPosition": 0,
      "secondPosition": 1,
      "winner": 0,
      "openingHands": {
        "0": [14558127, 23434539],
        "1": [0, 0, 0, 0, 0]
      },
      "observedCards": [
        { "code": 14558127, "count": 1, "players": [0] }
      ]
    }
  ]
}
```

说明：

- `winner: 0/1` 表示位置 0 或位置 1 的玩家赢。
- `winner: 2` 表示平局。
- `openingHands` 中的 `0/1` 是内部先手、后手编号，不是原始房间位置。
- `observedCards` 当前记录的是“这个 round 中是否出现过该卡”，不是消息次数。

### 9.2 单卡胜率

统计逻辑在 [src/lib/stats.js](src/lib/stats.js)。

对每一轮：

```text
先手牌：
  firstTotal += 1
  若持有者胜，firstWins += 1

后手牌：
  secondTotal += 1
  若持有者胜，secondWins += 1
```

最终：

```text
先手胜率 = firstWins / firstTotal
后手胜率 = secondWins / secondTotal
```

## 10. 输出文件

自动采集会生成：

```text
data/auto-watch.jsonl
data/auto-watch-summary.json
```

`JSONL` 是原始逐局记录，方便以后重算。`summary.json` 是当前汇总结果。

## 11. 后续建议

接手后可以优先做这些事：

1. **接入自有服务器完整手牌采集**。这是当前唯一能得到真正单卡上手胜率的路径。
2. **增加重连与断线重试**。当前普通 TCP 连接在异常时只记录失败，不会自动重连。
3. **把 JSONL 改成 SQLite 或 PostgreSQL**。样本量上来后，文件追加会越来越慢。
4. **把卡组识别与单卡统计结合**。可以先按卡组名分组，再做单卡先手/后手统计。
5. **补协议级测试**。目前只有 token 和统计逻辑测试，没有 mock TCP 数据包测试。
6. **做 Web 展示或定时任务**。可以让统计结果每天自动输出成网页或 CSV。
7. **注意采集频率和服务器压力**。官方接口适合低频采样，不要无限制并发观战。

## 12. 风险与合规

- 自动观战属于抓取公开对局流，建议控制并发、间隔和总时长。
- 起手卡是隐私数据。开启 `watch_public_hand: true` 只应在自己控制且双方知情的服务器上使用。
- 不要把 MyCard token、`u16Secret` 或完整手牌数据提交到公开仓库。
- 官方接口可能变化，版本号 `4962` 和接口路径都需要在后续维护中持续确认。
