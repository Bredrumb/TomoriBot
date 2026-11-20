export default {
  forget: {
    sampledialogue: {
      description: `Xóa cặp đối thoại mẫu người dùng/bot khỏi bộ nhớ của mình.`,
    },
    attribute: {
      description: `Xóa thuộc tính tính cách khỏi bộ nhớ của mình.`,
    },
    document: {
      description: `Xóa tài liệu khỏi cơ sở tri thức của máy chủ.`,
    },
    personaprompt: {
      description: `Xóa prompt riêng của persona`,
      no_prompt_title: `Không có prompt persona`,
      no_prompt_description: `Không có prompt riêng nào của persona để xóa. Hãy đặt một prompt bằng \`/config\` > Persona > Nâng cao.`,
      success_title: `Đã xóa prompt persona`,
      success_description: `Đã xóa prompt persona cho "{persona_name}".`,
      success_description_with_prompt: `Đã xóa prompt persona cho "{persona_name}". Đây là bản lưu lại:
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: `Xóa bộ nhớ cá nhân.`,
      },
      server: {
        description: `Xóa bộ nhớ máy chủ khỏi tri thức của mình.`,
      },
    },
  },
};
