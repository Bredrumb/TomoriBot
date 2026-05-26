# ElevenLabs Speech

Use `/speech elevenlabs` to connect ElevenLabs. The command validates the key, writes both custom endpoint rows, selects them as active, and can assign a voice to one persona.

The shortcut creates:

- capability `speech`, api style `elevenlabs`
- capability `transcription`, api style `elevenlabs-transcription`

Run `/speech voice-assign` later to assign voices to additional personas. Run `/speech elevenlabs` again to update the saved key.
