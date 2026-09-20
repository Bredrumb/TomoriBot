export default {
  reset: {
    description: "Đặt lại cấu hình máy chủ hoặc cá nhân về mặc định.",
    config: {
      description: "Đặt lại cấu hình của máy chủ này về mặc định cơ sở dữ liệu.",
      confirm_title: "Đặt lại cấu hình máy chủ",
      confirm_description:
        "> Khôi phục cài đặt máy chủ về mặc định cơ sở dữ liệu.\n> Prompt, ghi chú và danh sách thẻ tự tạo sẽ được đặt lại.\n\n**Các phần bị ảnh hưởng:**\n> • Persona: 0 cài đặt (giữ nguyên toàn bộ persona)\n> • Hành vi: 9 cài đặt (system prompt, ghi chú, trigger)\n> • Kênh: 6 cài đặt (quy tắc kênh, auto-trigger)\n> • Quyền hạn: 11 cài đặt (tính năng, quyền)\n> • Model: 3 cài đặt (sampler, dự phòng; giữ ID)\n\n**Không bị ảnh hưởng:**\n> Persona: {persona_remove}\n> Bộ nhớ: {memories} hoặc {personal_memories}\n> Nhà cung cấp: {providers} hoặc {personal_providers}\n> Tác vụ đã lên lịch: {scheduled_task_remove}\n> Xóa sạch máy chủ: {nuke}\nMức hạn ngạch đã dùng và tích hợp ngoài được giữ nguyên.",
      confirm_button: "Đặt lại cấu hình",
      no_permission_title: "Quyền bị từ chối",
      no_permission_description: "Bạn cần có quyền Quản lý máy chủ để đặt lại cấu hình của máy chủ này.",
      no_server_data_title: "Không có dữ liệu máy chủ",
      no_server_data_description: "Không tìm thấy cấu hình nào cho máy chủ này.",
      success_title: "Đã đặt lại cấu hình",
      success_description: "Cấu hình máy chủ đã được đặt lại về mặc định cơ sở dữ liệu.",
    },
    personal: {
      description: "Các lệnh cấu hình cá nhân.",
      config: {
        description: "Đặt lại cấu hình cá nhân của bạn về mặc định cơ sở dữ liệu.",
        confirm_title: "Đặt lại cấu hình cá nhân",
        confirm_description:
          "> Khôi phục cài đặt cá nhân về mặc định cơ sở dữ liệu.\n\n**Các phần bị ảnh hưởng:**\n> • Hồ sơ: biệt danh, ngoại hình, giới tính, đại từ\n> • Quyền riêng tư: mức riêng tư, tham gia liên máy chủ\n> • Nâng cao: chế độ phản hồi, mạo danh, spotlight\n> • Model: 0 cài đặt (giữ nguyên cài đặt nhà cung cấp)\n\n**Không bị ảnh hưởng:**\n> Nhà cung cấp: {personal_providers}\n> Bộ nhớ: {personal_memories}\n> Tác vụ đã lên lịch: {scheduled_task_remove}\nCấu hình nhà cung cấp đã lưu và dữ liệu cá nhân được giữ nguyên.",
        confirm_button: "Đặt lại cấu hình",
        success_title: "Đã đặt lại cấu hình cá nhân",
        success_description: "Cấu hình cá nhân và spotlight kênh đã được đặt lại về mặc định cơ sở dữ liệu.",
      },
    },
  },
};
