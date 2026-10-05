# SINGULAR 主网发布清单

## 当前合约（BNB Chain，chain ID 56）

- Pool Manager：`0xe7cbe024811788ed6158c10d3399ab8738ef421d`
- Chainlink VRF Provider：`0x4773f2e6ad78103ba47d5219a1a945378a49c840`
- Fee Vault：`0xD842BA07dacE4ca7e320B4FD8F2b253061c2ba23`

公开网站入口为 `/`，应用为 `/mainnet-app/`，管理员后台为 `/admin-mainnet.html`。旧合约历史领取入口仍保留在 `/legacy-app/`。后台网址不是权限保护；创建奖池及费用操作受链上固定管理员权限约束，每笔交易都需要管理员钱包独立确认。

## 需要管理员钱包创建的四档奖池

| 奖金 | 票价 | 容量 | 协议费 | 首票后时长 |
| --- | --- | ---: | --- | ---: |
| 0.05 BNB | 0.01 BNB | 6 | 0.01 BNB | 10 分钟 |
| 0.1 BNB | 0.01 BNB | 11 | 0.01 BNB | 10 分钟 |
| 0.5 BNB | 0.01 BNB | 55 | 0.05 BNB | 20 分钟 |
| 1 BNB | 0.01 BNB | 110 | 0.1 BNB | 30 分钟 |

后台已提供上述预设。逐档选择、核对合约地址与交易参数，并由管理员钱包分别签名；页面构建或上传 Git 不会自动创建链上奖池。创建后用 BscScan 和应用确认每个池的 ID、价格、容量、奖金、费用、时长和状态。

## 上传 Git 与 Vercel

以本目录 `singular-site` 作为 Git 仓库或 Vercel Root Directory。Vercel 使用 `vercel.json`：`npm run build`，输出目录 `dist`。运行 `npm test` 和 `npm run build` 后，检查公开站点的 `/mainnet-app/`、`/admin-mainnet.html`、`/whitepaper/`、`/docs/`、`/transparency/` 和旧合约领取入口。不要把私钥、助记词、钱包会话或部署脚本中的任何密钥提交到 Git。

前端使用公开 RPC 读取链上数据，奖池详情约每 2.5 秒轮询当前池。事件 RPC 不可用时，票数仍直接从 Manager 读取，并以票据所有者账本汇总参与钱包；交易哈希与确切事件时间可能暂时不可见。网站刷新不会改变链上状态。

## 发布前仍需人工确认

1. 在 BscScan 核对三个地址的代码、管理员与 VRF 订阅关系，确认订阅余额和 consumer 授权仍有效。
2. 用管理员钱包逐笔创建四个池；不要把已创建的旧池误当作这四档。
3. 在目标域名上检查钱包自动恢复、切换、买票和退款页面。EIP-6963 浏览器扩展钱包可被识别；未安装钱包显示官方下载入口。移动端 WalletConnect 二维码尚需单独的 Project ID，当前版本不宣称已支持。
4. 公开域名及 Git 仓库由项目方发布；本地 `dist` 构建成功不等于 Vercel 已上线。

本次仅更新前端、文案和发布说明；未修改或重新部署 Solidity 合约，也未代替管理员钱包发起主网交易。
