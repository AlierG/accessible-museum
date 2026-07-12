# 部署到 Render（静态网站）

这个游戏是纯静态页面（HTML/CSS/JS），联机走 PeerJS 的浏览器点对点连接，
**不需要后端服务器**，所以用 Render 的免费 **Static Site** 即可。

## 一、把代码放到 GitHub

Render 从 Git 仓库拉代码，所以先把本文件夹推到 GitHub：

```bash
cd /Users/amaka/accessible-museum-game
git init
git add .
git commit -m "有障碍博物馆桌游模拟器"
# 在 GitHub 上先建一个空仓库（不要勾选 README），拿到它的地址后：
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 没有 GitHub 账号就先注册一个（github.com）。建仓库时选 Private 或 Public 都行。

## 二、在 Render 上创建静态网站

1. 打开 https://render.com 并用 GitHub 账号登录/注册。
2. 点右上角 **New +** → **Static Site**。
3. 选择刚才推上去的那个仓库（第一次需要授权 Render 访问 GitHub）。
4. 填写设置：
   - **Name**：随意，例如 `accessible-museum`
   - **Branch**：`main`
   - **Build Command**：**留空**（纯静态，不用构建）
   - **Publish Directory**：填 `.`（一个点，表示仓库根目录，因为 index.html 在根目录）
5. 点 **Create Static Site**，等一两分钟部署完成。
6. 你会得到一个网址，形如 `https://accessible-museum.onrender.com`。

> 也可以用蓝图：New + → **Blueprint** → 选本仓库，会自动读取 `render.yaml`。

## 三、联机游玩

1. 把网址发给 4 位玩家。
2. 一人点顶部 **联机房间** → 输入房间号 → **创建房间(房主)**。
   房主那台设备负责运算，保持页面开着别关。
3. 其他人打开同一网址 → **联机房间** → 输入**相同房间号** →
   先选自己使用的玩家（红/蓝/绿/黄）→ **加入房间**。
4. 房主点 **开始新游戏**，大家就能一起玩了。

## 常见问题

- **改了卡牌数值想更新线上版本**：本地改完后
  `git add . && git commit -m "调整数值" && git push`，
  Render 会自动重新部署（每次 push 都会）。
- **免费版会休眠吗**：静态网站不休眠，随时可访问（会休眠的是免费的后端 Web Service，我们没用到）。
- **联机连不上**：确认大家用的是 `https://` 的线上网址（不是本地文件），
  且房间号完全一致、房主页面没关。PeerJS 用公共信令服务器，个别网络（严格的公司/校园防火墙）
  可能连不通，换网络或用手机热点通常能解决。
- **本地也能玩**：不联机时就是「本地模式」，四人共用一台设备轮流操作。
