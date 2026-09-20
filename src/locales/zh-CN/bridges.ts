export default {
  matrix: {
    notices: {
      invited: `TomoriBot 加入了这个房间。
完成设置：
1. 在 Discord 里想接通的频道运行 {link_command}。
2. 从 {room_id_path} 复制这个房间的 Internal Room ID 并粘贴进去。

注意：
- 这个房间必须保持未加密。
- 接通之后，你就可以在这里正常聊天了。
- Matrix 里只有两条文字指令：{kill_command} 和 {refresh_command}。

完整的指南和限制清单请到 Discord 用 {help_command} 查看。`,
      linked: `这个房间现在已经和 Discord 频道 {channel_name} 接通。
快速上手：
- 直接在这里聊天就能和 TomoriBot 对话。
- Matrix 里只有两条文字指令：{kill_command} 和 {refresh_command}。
- 从 Matrix 用不了斜杠指令、私信，也不能置顶消息。
- 自定义表情和 Markdown 的显示并不稳定，嵌入会以纯文本转发。
- Matrix 用户的个人记忆会退回使用服务器记忆。

完整的指南和当前的限制请到 Discord 用 {help_command} 查看。`,
    },
  },
};
