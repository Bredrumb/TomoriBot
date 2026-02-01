## Multi-Personaz Edition

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.80/tomoriz.png)

Hi everyone, Bredthony Rumbtano here, internet's busiest music nerd. Now it is time for a review of the new TomoriBot release, v0.7.80. Feelin' a light smiley ball on this one just from the sheer amount of new features, but I think TomoriBot could've cut some bloat off of here and saved it for a future release... anyways, hope you enjoy this new release and please report any bugs in GitHub or in the support Discord!

### New Tomori Features
- **Alter Personas**
    - You can now have multiple Personas within one TomoriBot for your server called "Alters" in addition to your "Main" through `/persona import`, removed through `/persona remove`
    - Alters behave similarly to the main bot and can talk to each other, use `/config selfreply` to adjust the maximum reply chain
    - You have to `/persona swap` an Alter as Main and then use customization commands if you want to tweak an Alter. Currently, only `/server trigger` works for Alter configuration
- **Recurrent Tasks and Reminders**
    - Tomori can now assign herself tasks which can be repeated and directed into a specific text channel simply by asking her to (eg. Check #general for any member violating the rules every hour starting now)
    - Tomori can now repeat reminders as well (eg. Every morning send me latest news on 百合アニメ)
- **Uncensored Mode and Key Rotation**
    - In order to help prevent API errors, `/config uncensors` and `/config apikey rotation` have been added
        - `/config uncensors` = Multiple toggles that can help reduce chances of getting prohibited content errors
        - `/config apikey rotation` - Allows multiple API keys in one server which will be rotated on upon errors. For safety, all rotation API keys are removed upon switching providers
- **More Robust Memory**
    - Tomori can now store short-term memory as cache that she uses to strengthen current context as well as remember conversations across same-server text channels (can be cross-server if opted in through `/personal cache`)
    - You can now upload whole documents (.txt|.md|.pdf) to Tomori using `/teach document` for efficient knowledge storage through semantic similarity retrieval (Retrieval-Augmented Generation (RAG)). Similar text chunks from documents to trigger messages will be loaded into context. Adjust embedding model using `/config model`
    - Tomori can now edit her own memories (disabled if `self-teaching` is disabled)
- **Better Impersonation**
    - `/bot impersonate` sends your input message as the (Main) bot, an Alter, as the System, or even yourself to help steer Tomori's responses (or to gaslight your down bad homie)
    - `/bot respond` now allows for prefills, prompts, and Alters (also merged `/bot reason` into this command)
- **Local Provider Endpoints**
    - On local TomoriBot instances, you can now select `Custom` as a provider which allows for custom endpoints such as for KoboldCPP and Ollama.
- **New Default Persona**
    - Don't bully Shy Tomori

### Minor Changes and QoL
- Enforcement of bot message trigger cooldowns and restrictions through `/config cooldown` and `/server whitelist`
- Made `/bot respond` embed hidable through `/config permissions` (similar to new `/bot impersonate` command)
- `/reward headpat` = Give your bot a headpat
- `/tools compact` = Possible alternative to `refresh` that compacts the ongoing conversation or roleplay
- Tomori now properly fetches multiple images in text channels for Img2Img generation
- Tomori can now edit Discord emojis and stickers through Img2Img
- Reduced emoji usage through artificial repetition penalties (prompt injection and regex)
- GIF profile pictures are now processed without errors
- Fixed bug where imported personas used old info
- Fixed bug where Tomori sometimes generates meta system messages (depending on the model, she still might)