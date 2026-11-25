"""
Smart text splitter for Discord notifications.

Splits release notes at the best available markdown breakpoint so no
single message exceeds Discord's 2000-character limit.

Reads:  discord_release_notes.txt
Writes: discord_chunk_{i}.txt (one per message)
        discord_chunk_count.txt (total count)
"""

MAX_CHARS = 1900


def split_text(text, max_chars):
	"""Split text into chunks, preferring natural markdown breakpoints."""
	chunks = []
	remaining = text.strip()

	while remaining:
		if len(remaining) <= max_chars:
			chunks.append(remaining)
			break

		candidate = remaining[:max_chars]

		split_pos = -1
		for i in range(len(candidate) - 2, 0, -1):
			if candidate[i] == '\n' and candidate[i + 1] == '#':
				split_pos = i
				break

		if split_pos == -1:
			split_pos = candidate.rfind('\n\n')

		if split_pos == -1:
			split_pos = candidate.rfind('\n')

		if split_pos == -1:
			split_pos = candidate.rfind(' ')

		if split_pos <= 0:
			split_pos = max_chars - 1

		chunks.append(remaining[:split_pos].rstrip())
		remaining = remaining[split_pos:].lstrip('\n ')

	return [c for c in chunks if c.strip()]


if __name__ == '__main__':
	with open('discord_release_notes.txt', 'r') as f:
		text = f.read()

	chunks = split_text(text, MAX_CHARS)

	for i, chunk in enumerate(chunks):
		with open(f'discord_chunk_{i}.txt', 'w') as f:
			f.write(chunk)

	with open('discord_chunk_count.txt', 'w') as f:
		f.write(str(len(chunks)))

	print(f'Release notes split into {len(chunks)} message(s)')
