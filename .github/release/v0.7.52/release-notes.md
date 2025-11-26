## Hatsu Public Release Edition

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/main/.github/release/v0.7.52/public-release-0752.png)

###  [TomoriBot Invite Link](https://discord.com/oauth2/authorize?client_id=841644102059556915)

TomoriBot's first public release! She's now hosted cozily in the cloud 24/7. By using this hosted public TomoriBot service, you agree to the [Terms of Service](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/legal/en-US/terms-of-service.md) and [Privacy Policy](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/legal/en-US/privacy-policy.md). If you self-host TomoriBot using this repository, those terms do not apply, but you are bound by the [GNU AGPL-3.0 License](https://github.com/{REPO_OWNER}/{REPO_NAME}/blob/main/LICENSE) instead.

(btw my lawyer is Saul Goodman so don't @ me)


### New Tomori Features
 - **Multiple Provider Support**
   - **OpenRouter** - 10+ initial models
   - **NovelAI** - Latest GLM 4.6 model
   - ...more in the future
- **Persona Switching**
  - You can now create or generate new TomoriBot personalities (called **Personas**) which you can use to easily change her avatar, personality, and behavior.
  - You can share Personas with others by downloading the provided image containing Persona metadata which people can `/persona import` into their own TomoriBot
    - Outputted from the export・create・generate `/persona` commands 
  - 3 Official "Default" Personas provided on first set-up
    - Gloomy Tomori
    - Boyish Tomori
    - Bratty Tomori
    - (may add more through a community contest..?)
- **Modal File Uploads**
  - Now you can upload images through command Modals (thanks Discord)

### New Tools/MCPs for Tomori

- **Remind Me** - TomoriBot can now set alerts and reminders for you, just ask her to
- **GIF Processing** - TomoriBot can now see GIFs (disabled in public TomoriBot as they're too heavy for the cloud)
- **Review Capabilities** - TomoriBot can now review details of her own functions and slash commands to assist users on what she can and can't do (~~tell me you can't see images one more time you're getting unplugged~~)


### New Tomori Commands

*Note that alot of the old slash commands were renamed in this version coming from 0.7.0*
- `/help` commands for... help
  - Includes instructions on setting-up and getting API keys from all providers, for new users
- `/persona` commands for creating, generating, importing, and sharing TomoriBot Personas
- You can now change TomoriBot's server avatar using `/config avatar`
- You can now export/import/delete/view status of your TomoriBot data for backups or privacy using the respective slash commands
- You can now set TomoriBot's timezone for your server using `/config timezone` (for use with `Remind Me` tool)
- You can now opt out of TomoriBot's memory system completely for privacy using the new `/personal` commands
- `/contribute` and `/donate` commands that show how you can donate TomoriBot some GitHub stars or money for her monthly shawarma

### Security

- Rate Limits against DDoS (disabled in self-hosted TomoriBot instances)
- SSL Database Encryption
- Key Rotations
- CI/CD Pipeline that prevents me from accidentally shipping my password

### Optimizations

- Context Building
- Database Item Caching
- Removed redundant DB calls throughout codebase

### ~~Next Plan~~

- ~~Commission an actual artist so I can finally replace all the AI placeholder slop I generate~~

