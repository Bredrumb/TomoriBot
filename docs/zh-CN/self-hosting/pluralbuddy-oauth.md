---
title: "PluralBuddy OAuth 配置"
description: "授权你的自部署 TomoriBot 验证来自已批准 PluralBuddy 实例的消息。"
sidebar:
  order: 8
---

自部署的 TomoriBot 需要为官方服务以及每个已批准的自定义实例分别授权 PluralBuddy 应用程序。

如果你使用的是[公开部署的 bot](https://discord.com/oauth2/authorize?client_id=841644102059556915)，
则无需完成此宿主机端配置。使用
`/personal message-proxy service:pluralbuddy` 选择 PluralBuddy；参见
[消息代理支持](/features/integrations/message-proxy-support/#pluralbuddy)。

## 开始之前

- 运行与已迁移的 PostgreSQL 数据库匹配的当前 TomoriBot 版本。
- 使用一台配有浏览器且可访问该数据库及 TomoriBot 加密密钥的计算机。授权辅助脚本会监听该计算机的本地环回地址。如果数据库位于远程，请配置来自该计算机的临时受限访问。
- 选择一个未被占用的本地端口，并在开发者门户中注册一个完全一致的回调 URL，例如 `http://127.0.0.1:<port>/oauth/callback`。记录该 URL，你将在下方的每个步骤中用到它。

## 授权官方实例

1. 登录 [PluralBuddy 开发者门户](https://pluralbuddy.app/developers/applications)并创建一个 OAuth 应用程序。测试时请使用独立的应用程序。勾选 `profile` 与 `offline_access`。按上方所选完全一致地注册回调地址。保管好客户端 ID 与密钥，切勿泄露。
2. 在 TomoriBot 代码仓库中，使用官方实例 ID 与相同的回调 URL 运行辅助脚本：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. 在终端提示符处输入客户端 ID 与密钥。在该计算机的浏览器中打开输出的授权 URL，登录 PluralBuddy 并同意授权页面。辅助脚本在收到一次回调或三分钟超时后关闭，并将连接信息存入 PostgreSQL。
4. 使用相同的数据库和加密密钥启动 TomoriBot。在使用了 PluralBuddy 的 Discord 账户上运行 `/personal message-proxy service:pluralbuddy`，然后发送一条 Webhook 转发消息，检查 TomoriBot 能否识别副人格（alter）。

辅助脚本从 `.env` 或 `SECRET_FILE` JSON 包中读取数据库设置与加密密钥。请将该包存放在代码仓库外部并妥善备份加密密钥。在提示符处输入客户端密钥，不要将其保存在 `.env` 中或作为命令行参数传递。如果 PluralBuddy 撤销了连接，请使用相同的实例 ID 重新授权。

## 添加已批准的实例

使用不带路径、查询参数或片段标识符的公开 HTTPS 源地址。该实例必须同时运行代理 bot 及其匹配的 API。

1. 在可访问部署数据库的计算机上注册一个已禁用的实例：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   对于 PluralKit，服务名请使用 `pluralkit`。提供 bot 用户 ID 可以避免在未加入该 bot 的服务器中进行不必要的查询等待。
2. 对于 PluralBuddy，在该实例上注册一个独立的 OAuth 应用程序，使用与上方相同的本地环回回调规则。使用注册返回的实例 ID 进行授权：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   若要更换凭据或从已撤销的刷新令牌中恢复，请重复授权步骤。PluralKit 不需要此步骤。
3. 从对应代理 bot 发送的消息中，记录其 Discord 转发消息 ID 与发送者账户 ID。检查该实例的 API 能否解析该转发消息，然后启用它：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   对于新的分支版本（fork），在向用户开放前，请先在一次性部署中测试 bot、OAuth 交换与刷新以及 TomoriBot 查询。
4. 用户使用 `/personal message-proxy service:pluralbuddy instance:<name>` 选择已启用的实例。将 `instance` 留空则默认选择官方实例。禁用某个实例会停止新的查询，但不会更改已存储的用户资料。

如果更换了自定义代理 bot，请在重新开放该实例前更新其 Discord bot 用户 ID：

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

禁用或移除自定义实例：

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

移除操作会删除 OAuth 连接并永久阻止该源地址被再次注册。如果你未来可能恢复该实例，请改用 `disable`。既有身份与记忆仍可继续使用，且变更无需重启即可生效。

用户配置请参见[消息代理支持](/features/integrations/message-proxy-support/#pluralbuddy)，令牌存储与刷新行为请参见[消息代理架构](/architecture/integrations/message-proxy/)。
