# MyCard YGOPro 观战统计器

这个项目用于连接萌卡 MyCard / YGOPro 的实时对局服务，并统计卡牌在对局中的胜率。它不是一个 `.yrp` 录像解析器。

## 先明确一个协议限制

萌卡官方服务器的普通观战流会发送 `MSG_DRAW`，但起手抽牌的卡号被服务端抹成 `0`：

```text
YGOProMsgDraw { player: 0, count: 5, cards: [0, 0, 0, 0, 0] }
```

因此，普通观战者无法拿到“某张卡是否在起手”这一信息。也就是说，**官方服务器上无法只靠观战客户端得到严格的单卡起手胜率**。

官方服务器已经公开了卡组维度的先手/后手统计，本项目也提供了查询入口：

```text
https://sapi.moecube.com:444/ygopro/analytics/deck/type?type=week&source=mycard-athletic
```

要得到“单卡上手胜率”，有两条可行路径：

1. 使用你自己或朋友控制的 srvpro 服务器，并在 `data/config/system.conf.json` 中临时打开 `test_mode.watch_public_hand: true`。这样 `watch` 模式收到的 `MSG_DRAW` 就是真实起手卡号。
2. 使用官方公开接口，得到卡组级先手/后手胜率，作为高置信度替代指标。

## 环境

- Node.js 18+（项目在 Node 24 下验证）
- 已通过 pnpm 安装 `sql.js` 和 `ygopro-msg-encode`
- 本地卡片数据库 `cards.cdb` 可用于把卡号转换成卡名

## 登录信息

`watch` 官方房间时需要一个 MyCard token，并通过 `https://api.moecube.com/accounts/authUser` 换取每 4 分钟轮换的 `u16Secret`。

程序默认从 Windows Electron 客户端的 LevelDB 本地存储扫描 JWT token。也可以手动传入：

```powershell
node src/index.js auth --token "你的JWT"
```

## 命令

```powershell
# 查看当前已开始的官方对局
node src/index.js rooms

# 查看当前登录身份和 u16Secret
node src/index.js auth

# 查询官方卡组先手/后手胜率
node src/index.js analytics --type week

# 观战一个官方房间
node src/index.js watch "M#roomId"

# 观战自有服务器房间，直接给房间密码
node src/index.js watch "RoomName" --host 127.0.0.1 --port 7911 --password "房间密码" --name "stat-bot"

# 自动轮换观战官方已开始房间
node src/index.js watch-auto --seconds 3600 --parallel 2

# 从已保存的 JSONL 结果计算卡牌胜率
node src/index.js stats data/auto-watch.jsonl
```

`watch` 和 `watch-auto` 输出 JSON 记录：

- 官方观战：能拿到胜者、先后手、公开区域出现的卡号，但起手卡不可见。
- 自有服务器且 `watch_public_hand: true`：能拿到每个玩家的起手卡，并据此计算单卡先手/后手胜率。

## 自有服务器开启完整手牌

在 srvpro 配置文件中找到：

```json
"test_mode": {
  "watch_public_hand": false
}
```

改成 `true` 后重启。然后使用 `--password` 模式连接目标房间，观战流会走服务端内部的全量录像连接，`MSG_DRAW` 中会保留真实卡号。

注意：这会让所有后进入的观战者都能看到手牌。仅应在自己控制且对局双方知情同意的服务器上使用。

## 输出示例

自动采集结束后会在 `data/auto-watch-summary.json` 中生成：

```json
{
  "totals": {
    "completedRounds": 18,
    "fullHandRounds": 12,
    "firstWinRate": 0.55,
    "secondWinRate": 0.45
  },
  "cards": [
    {
      "code": 14558127,
      "name": "灰流丽",
      "firstWins": 4,
      "firstTotal": 7,
      "secondWins": 2,
      "secondTotal": 5,
      "observedTotal": 19
    }
  ]
}
```
