export default {
  kill: {
    description: `このチャンネルで現在のストリーム応答を停止し、キュー済み応答をすべてクリアします。`,
    success_title: `ストリームを停止しました`,
    success_description: `進行中の応答ストリーム（ある場合）を停止し、このチャンネルのキュー済み応答をクリアしました。`,
    nothing_to_stop_title: `停止・クリア対象がありません`,
    nothing_to_stop_description: `このチャンネルには停止できる進行中の応答ストリームも、クリアできるキュー済み応答もありません。`,
    media_generation_billing_footer: `メディア生成の途中で停止しました。投稿はされませんが、プロバイダー側で料金が発生する場合があります。`,
  },
};
