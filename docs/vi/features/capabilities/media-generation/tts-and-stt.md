---
title: "Giọng nói: TTS & STT"
sidebar:
  order: 3
---

TomoriBot có thể **nói** (text-to-speech) và **lắng nghe** (speech-to-text):

- **TTS** cho phép bot trả lời bằng tin nhắn thoại Discord nguyên bản.
- **STT** chuyển tệp âm thanh đính kèm của người dùng thành văn bản để bot sử dụng làm ngữ cảnh cuộc trò chuyện.

Cả hai đều hoạt động qua cùng một hệ thống endpoint. Con đường nhanh nhất là **ElevenLabs** (đám mây, được
hướng dẫn đầy đủ bên dưới). Nếu bạn muốn chạy giọng nói trên phần cứng của riêng mình, hãy sử dụng một engine
cục bộ và làm theo các hướng dẫn self-hosting.

## Text-to-Speech

### ElevenLabs (đám mây, dễ nhất)

1. Lấy khóa API từ [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Chạy lệnh `/providers`, chọn **Add New Provider**, chọn **ElevenLabs**, rồi dán khóa API. Quy trình này sẽ:
   - đăng ký endpoint **speech** của ElevenLabs (và cả endpoint **transcription**),
   - chọn chúng làm endpoint hoạt động,
   - có thể chỉ định ngay một giọng nói cho một persona.
3. Chỉ định giọng nói cho các persona khác trong mục Persona > Voice tại `/config`. Duyệt tìm giọng nói trong
   [ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library), nơi bạn cũng có thể tự clone giọng
   nói của riêng mình.

Chọn ElevenLabs trong `/providers`, sau đó chọn **Edit Endpoint** bất cứ khi nào bạn cần cập nhật khóa.

Lưu ý:

- Trên **gói miễn phí, chỉ các giọng nói tạo sẵn mới hoạt động**. Duyệt danh sách tại
  [danh sách giọng nói tạo sẵn](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Ký tự được tính khi bot tạo và đọc tin nhắn thoại; gói miễn phí có giới hạn hàng tháng, vì vậy hãy kiểm
  tra bảng điều khiển ElevenLabs của bạn.
- Phản hồi bằng giọng nói được kiểm soát bởi `voice_message_enabled` và yêu cầu persona đang hoạt động phải có
  một giọng nói được chỉ định.
- Mục Persona > Voice trong `/config` yêu cầu quyền Manage Server trong máy chủ và vẫn khả dụng cho chủ sở hữu
  trong không gian làm việc DM.

Trong `/help`, chọn **Features**, sau đó chọn **Speech** để xem hướng dẫn tương tự trong Discord.

### Các engine clone giọng nói cục bộ (self-hosted)

Trên một phiên bản self-hosted, bạn có thể chạy máy chủ clone giọng nói cục bộ. Quy trình chung gồm:
khởi động máy chủ wrapper, đăng ký kết nối cùng model bằng `/providers`, chọn nó trong `/providers`, tải lên
một mẫu âm thanh bằng `/config` trong mục Models > TTS Parameters & Voices, sau đó chỉ định trong
Persona > Voice tại `/config`. Mọi định dạng âm thanh đều được chấp nhận (tự động chuyển sang định dạng WAV mono);
các đoạn âm thanh dài 10-20 giây không có nhạc nền sẽ hoạt động tốt nhất.

Mỗi engine đều có hướng dẫn cài đặt riêng:

- [Chatterbox-Turbo/Nano](/vi/self-hosting/local-endpoints/text-to-speech/chatterbox/): clone giọng nói nhanh, chỉ hỗ trợ tiếng Anh kèm các thẻ sự kiện như `[laugh]`.
- [Qwen3-TTS](/vi/self-hosting/local-endpoints/text-to-speech/qwen3tts/): đa ngôn ngữ (10 ngôn ngữ), kèm chế độ
  VoiceDesign bằng ngôn ngữ tự nhiên.
- [MOSS-TTS](/vi/self-hosting/local-endpoints/text-to-speech/moss/): endpoint tự động thử nghiệm để clone đa ngôn ngữ hoặc thiết kế giọng nói tiếng Anh/tiếng Trung.
- [IrodoriTTS](/vi/self-hosting/local-endpoints/text-to-speech/irodoritts/): chuyên biệt cho tiếng Nhật, đọc emoji
  làm gợi ý cảm xúc.

Xem [bảng so sánh Text-to-Speech](/vi/self-hosting/local-endpoints/text-to-speech/) để biết danh sách đầy đủ và hướng dẫn phần cứng.

## Speech-to-Text

Các endpoint transcription chuyển tệp âm thanh đính kèm của người dùng thành văn bản cho ngữ cảnh cuộc trò chuyện
nền. Việc bản chép lời có được **đăng công khai** trong đoạn chat hay không được điều khiển riêng bởi
`/config` > Engine > Notices.

### ElevenLabs (đám mây)

Đã được đề cập ở trên: việc thêm ElevenLabs từ `/providers` sẽ đăng ký endpoint transcription cùng với
giọng nói. Sử dụng `/providers` để chọn giữa các endpoint transcription.

### Các engine cục bộ (self-hosted)

- [WhisperX](/vi/self-hosting/local-endpoints/speech-to-text/whisperx/): phương án cục bộ được khuyến nghị; ~100
  ngôn ngữ, tăng tốc bằng GPU, nhiều kích cỡ model.
- [KoboldCPP](/vi/self-hosting/local-endpoints/speech-to-text/koboldcpp/): hoạt động nếu bản build của bạn cung cấp
  endpoint transcription tương thích với OpenAI.
- [whisper.cpp](/vi/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Xem trang tổng hợp [Speech-to-Text](/vi/self-hosting/local-endpoints/speech-to-text/) để biết danh sách đầy đủ. Để xem bản tóm
tắt trên Discord, hãy chạy lệnh `/help`, sau đó chọn **Features** và **Transcription**.
