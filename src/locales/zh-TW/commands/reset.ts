export default {
  reset: {
    description: "將伺服器或個人設定重設為預設值。",
    config: {
      description: "將這個伺服器的設定重設為資料庫預設值。",
      confirm_title: "重設伺服器設定",
      confirm_description:
        "> 這會把伺服器設定還原成資料庫預設值。\n> 已撰寫的提示詞、備註與標籤清單都會被重設。\n\n**受影響的區段：**\n> • 人格：0 項設定（所有人格都會保留）\n> • 行為：9 項設定（系統提示詞、備註、觸發詞）\n> • 頻道：6 項設定（頻道規則、自動觸發）\n> • 權限：11 項設定（功能、權限）\n> • 模型：3 項設定（取樣器、備援；ID 會保留）\n\n**不會更動：**\n> 人格：{persona_remove}\n> 記憶：{memories} 或 {personal_memories}\n> 供應商：{providers} 或 {personal_providers}\n> 排程任務：{scheduled_task_remove}\n> 完整清除伺服器：{nuke}\n已記錄的額度用量與外部整合都會完整保留。",
      confirm_button: "重設設定",
      no_permission_title: "權限不足",
      no_permission_description: "重設這個伺服器的設定需要「管理伺服器」權限。",
      no_server_data_title: "沒有伺服器資料",
      no_server_data_description: "找不到這個伺服器的設定。",
      success_title: "設定已重設",
      success_description: "伺服器設定已重設為資料庫預設值。",
    },
    personal: {
      description: "個人設定指令。",
      config: {
        description: "將你的個人設定重設為資料庫預設值。",
        confirm_title: "重設個人設定",
        confirm_description:
          "> 這會把個人設定還原成資料庫預設值。\n\n**受影響的區段：**\n> • 個人檔案：暱稱、外觀、性別、代稱\n> • 隱私：隱私等級、跨伺服器選項\n> • 進階：回應模式、模擬他人、聚光燈\n> • 模型：0 項設定（所有供應商設定都會保留）\n\n**不會更動：**\n> 供應商：{personal_providers}\n> 記憶：{personal_memories}\n> 排程任務：{scheduled_task_remove}\n已儲存的供應商設定、自訂端點與其他個人資料都會完整保留。",
        confirm_button: "重設設定",
        success_title: "個人設定已重設",
        success_description: "個人設定與頻道聚光燈已重設為資料庫預設值。",
      },
    },
  },
};
