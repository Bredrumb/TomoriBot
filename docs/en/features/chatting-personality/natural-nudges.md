---
title: "Natural Nudges"
description: "Let your TomoriBot personas start conversations when a Discord channel goes quiet and join ones that match their interests, at a pace that follows how active your server is."
sidebar:
  order: 4
---

Natural Nudges lets your personas speak without being mentioned:

- **Idle nudges** start conversations when a channel goes quiet.
  - They slow down when nobody answers and stop after several unanswered nudges, until someone
    talks to TomoriBot again.
- **Active nudges** join conversations about a persona's interests.

The pace follows your server's [Heat](#heat), with an optional adjustment under
[Advanced settings](#advanced-settings). Servers with low effective heat get neither kind.
DMs never get nudges (for now).

Both kinds pause after 14 days without someone directly chatting with TomoriBot. Mention her,
use a persona's trigger word, or reply to her message to resume them. Ordinary channel chatter,
commands, and scheduled bot messages do not restart that window. Changing the heat adjustment
does not bypass the pause. Low activity or no eligible channel also pauses both kinds, and ordinary
channel chatter does not lift that pause. Direct chat prompts a fresh check of activity and channels.
During an upgrade, existing servers with enough recent activity and an eligible channel keep their
remaining activity window; other servers stay paused until direct chat makes them eligible.

## Idle nudges
<!-- anchor: idle-nudges -->

Idle nudges wait until a channel has been quiet for a while, during the hours your server is
usually awake. There are 28 built-in idle nudges across four categories. You can adjust them and add
your own for the whole server in `/nudge-studio`, and each persona can have idle nudges of its own
(see [Persona idle nudges](#persona-idle-nudges)).

The bot first picks a category, then the planner chooses an idle nudge and channel together from
a shortlist of available activities in that category.
It considers channel names, descriptions, and recent messages, and can skip the attempt when none fits.
It avoids the previous category when another is available. Within each category, it leaves the
last activity found in recent history out of the shortlist when another eligible activity exists.
These checks use your server's nudge history across personas and channels. A category or activity
can repeat when it is the only available choice.

| Category | What it does | Prerequisites | Notes |
|---|---|---|---|
| <a id="ping-user"></a>Ping User | Checks in on a member or shares something they might like. | Recent conversation with this persona in this server, a memory, and permission to ping. Full privacy, personalization blacklists, and persona blocks exclude members. | Frequent contacts are favored; recent pings reduce repeat chances. Opt out in `/personal config` > `Privacy` > `Pings from Personas`. |
| Revive Topic | Picks up an unfinished conversation. | A conversation left hanging. | N/A |
| Start Topic | Raises something new, often about the persona's interests. | No extra category requirements. | N/A |
| <a id="play-scene"></a>Play Scene | Starts a short exchange between two or three personas. | Another persona allowed to nudge in that channel. | Talkative personas join more often; Silent ones never do. If a member posts, the scene stops and a persona answers them. Surprise scenes do not ping their subject. |

### Choose and create idle nudges

Open `/nudge-studio` (requires `Manage Server`) to browse each category. The colored dot shows
whether a nudge is on, missing a prerequisite, or off. Each row ends with its source: `Built-in`,
`Server custom`, or `For <persona>` for a nudge a persona owns. Categories with more than 12 rows
continue on further pages.

`Toggle Availability` chooses which personas can use a nudge:

- **All checked:** every persona can use it, including personas you add later.
- **Some checked:** only those personas can use it. New personas stay out until you check them.
- **None checked:** the nudge is off.

A persona-owned nudge has one checkbox, `Available to <persona>`, because only its owner can use it.
Unchecking it turns it off without deleting it.

Limiting a server nudge to one persona does not move it onto that persona's page. It stays a server
nudge, and only the persona's own entries travel with its persona card.

Below the list you can add up to 25 of your own for the whole server. Choosing a server nudge or a
persona-owned nudge opens it for editing, and the same entry is editable on the persona's `Nudges`
page. New nudges made here are always server nudges. `Remove Nudges` lists the editable nudges on the
current page, and unchecking one removes it. Each one has:

- **Name**: the label shown in the studio.
- **Brief**: what the persona sets out to do. Write `{persona}` where its name goes,
  `{partner}` where the other persona in a Play Scene goes, and `{target}` where the member it is
  about goes.
- **Agenda** (optional): the kind of small goal the persona keeps after its opener.
- **Prerequisites**: what must be true before the idle nudge can run, such as a recent memory or an
  available tool. The category requirements in the table apply automatically.
- **Recommended tools**: tools the persona is encouraged to use when it has them. The idle nudge
  still runs without them. A tool picked under `Prerequisites` is already included, so it is dropped
  from this list when you save.

### Persona idle nudges

A persona can carry idle nudges that belong to its character, such as Rose checking a cosplay fit or
Aphel recommending an album. They add to the built-in and server nudges and do not replace them.

Open `/config` > `Persona` > `Nudges`. `Idle Nudges` sits below `Interests`:

- `Select or add an idle nudge...` adds one with `+ Add <category>` or edits an existing one. All four
  categories are available, with the same fields as a server nudge. A persona holds up to 20,
  separate from the server's 25.
- `Toggle availability...` switches individual entries on or off for this persona.
- `Remove Idle Nudges` deletes the entries you uncheck.
- `Restore Preset Nudges` appears for a persona that follows an official preset and has its own copy of the list.

How they run:

- Only the owning persona starts them. In a Play Scene the owner leads, and any other persona that
  can nudge may join as the partner.
- They follow the same prerequisites, quiet hours, frequency level, and daily limit as every other
  idle nudge. More entries give a persona more to choose from but do not make it speak more often.
- Interests drive Active Nudges. Persona idle nudges drive Idle Nudges only.

Official presets ship with idle nudges. A persona that still follows its preset reads that list as
the preset is updated. The first time you add, edit, or remove an entry, the persona gets its own copy
of the whole list, and later preset updates no longer change it. Switching an entry on or off does not
make a copy. `Restore Preset Nudges` replaces the persona's list with the preset's current list and
keeps its interests, talkativeness, and the on/off choices for entries that still exist.
`Resync with Preset` in `Identity & Personality` also resets the list and the on/off choices.

Persona cards (`/persona export`) include the persona's idle nudges, from either the preset or its own
copy, and importing the card restores them. On/off choices are local to a server and are not exported,
so imported entries start switched on. Server nudges never go into a card. An older card that still
matches an official preset follows that preset's current idle nudges. Other older cards import with
no persona idle nudges.

### Hidden agendas

Each idle nudge gives the persona a small private goal, such as "find out who else likes this
anime", to guide later replies. In a Play Scene, each persona gets its own goal. The goal expires
when the opener leaves the persona's conversation history.

## Active nudges
<!-- anchor: active-nudges -->

TomoriBot periodically checks recent messages for conversations about your personas' interests.
Busier servers and higher active nudge frequency settings get more frequent checks. A passing
mention of an interest does not count.

A persona with a matching interest usually joins in, with quieter personas getting preference.
Occasionally, another persona takes the turn. Personas that just spoke sit it out.

The persona waits briefly before replying to give the conversation time to develop. If enough new
messages arrive during that delay, TomoriBot checks that the conversation still matches the same
interest. If the topic has changed, another persona has spoken, or the channel is busy, the nudge is
dropped.

Active nudges have channel cooldowns and a server daily limit. Threads share their parent channel's
cooldown. A persona needs interests on its `Nudges` page to take part, and Silent personas never do.

## Settings

Natural Nudges is on by default. Open `/config` > `Plugins` > `Natural Nudges` to change it
(requires `Manage Server`):

- **Modes:** turn idle and active nudges on or off separately.
- **Channels:** choose channels, or leave the list empty to use recent TomoriBot conversation
  channels automatically, excluding roleplay channels.
- **Frequency:** choose `Rare`, `Gentle` (default), `Normal`, or `Lively` for each mode. The page
  estimates the pace for your server; daily limits keep nudges and checks within that level.
- **Models:** you can change either model.
  - `Idle Nudge Planner` decides what a persona will say to start an idle nudge and gives it a
    private goal for follow-up replies. Defaults to your chat model.
  - `Active Nudge Checker` checks whether a conversation matches a persona's interests. Selected
    automatically; a small, cheap model or a Decision model suits its frequent checks.

### Advanced settings

Open `/config` > `Plugins` > `Natural Nudges` with `Manage Server` to adjust heat and idle nudge
category weights. Only adjust these settings if you know what you are doing. The frequency quote
rows estimate idle nudges per week and messages between active checks, with each mode's daily limits.

- **Heat adjustment:** the `-5` and `+5` buttons change the saved adjustment, from -1000 to 1000.
  Heat used for nudges stays between 0 and 50. Activity and your adjustment appear separately.
  Raising heat makes idle nudges more frequent and active checks sooner until each mode reaches
  its maximum pace. Measured heat and activity history stay uncapped for decay.
- **Type weights:** `Edit type weights` opens four fields prefilled with the saved values.
  Defaults are 30 for Ping User, 25 for Revive Topic, 30 for Start Topic, and 15 for Play Scene.
  Each field shows its default. Enter whole numbers from 1 to 100, totaling 100 across all four.
  Higher weights make that category more likely relative to the others. Prerequisites and recent
  use still affect the draw.

These controls still follow channel rules, waking hours, cooldowns, daily limits, and
unanswered-nudge stops. With no recent conversation channels, choose channels before adding heat.

### Heat

Heat sets the pace of both idle nudges and active checks for your whole server, across members and
personas. The Natural Nudges settings show measured heat, your saved adjustment, and heat used for nudges out of
50. Persona talkativeness and the rules for choosing a member to ping are separate settings.

#### Activity and decay

Measured heat is a weighted daily average of interactions over the last 30 days. Ordinary
conversation turns and human `/punish` turns contribute once; human `/reward` turns contribute
three times as much. Generated nudges and Playful Interactions between personas contribute nothing.

An interaction's weight halves every three days:

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="The weight of activity d days ago is two to the power of negative d over three.">
  <mi>w</mi><mo>(</mo><mi>d</mi><mo>)</mo><mo>=</mo>
  <msup><mn>2</mn><mfrac><mrow><mo>−</mo><mi>d</mi></mrow><mn>3</mn></mfrac></msup>
</math>

Here, `d` is the number of days ago, using UTC days: today's activity has weight 1, three days ago
has weight 0.5, and six days ago has weight 0.25. Activity leaves the calculation after 30 days.
With `E_d` as each day's weighted interaction total, measured heat `A` is:

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="Measured heat A is the sum of each day's interaction total times its decay weight, divided by the sum of the decay weights, over days zero through twenty-nine.">
  <mi>A</mi><mo>=</mo>
  <mfrac>
    <mrow><munderover><mo>∑</mo><mrow><mi>d</mi><mo>=</mo><mn>0</mn></mrow><mn>29</mn></munderover><msub><mi>E</mi><mi>d</mi></msub><mo>·</mo><mi>w</mi><mo>(</mo><mi>d</mi><mo>)</mo></mrow>
    <mrow><munderover><mo>∑</mo><mrow><mi>d</mi><mo>=</mo><mn>0</mn></mrow><mn>29</mn></munderover><mi>w</mi><mo>(</mo><mi>d</mi><mo>)</mo></mrow>
  </mfrac>
</math>

Steady activity of 10 weighted interactions every day gives about 10 measured heat. Your saved
adjustment `Δ` is added after this average, then the result is limited to 0-50:

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="Effective heat H is the smaller of fifty and the larger of zero and measured heat A plus the saved adjustment delta.">
  <mi>H</mi><mo>=</mo><mi mathvariant="normal">min</mi><mo>(</mo><mn>50</mn><mo>,</mo>
  <mi mathvariant="normal">max</mi><mo>(</mo><mn>0</mn><mo>,</mo><mi>A</mi><mo>+</mo><mi>Δ</mi><mo>)</mo><mo>)</mo>
</math>

Measured activity stays uncapped, so a busy server's heat decays from its full value. Both modes
need measured heat and effective heat of at least 1. An adjustment changes the pace once measured
activity reaches that minimum. The 14-day pause without direct chat still applies at any heat.

#### Idle timing and active checks

For effective heat `H` of at least 1, your frequency level supplies these values:

| Frequency | Idle divisor D | Idle daily limit C | Active multiplier M |
|---|---|---|---|
| `Rare` | 30 | 1 | 2 |
| `Gentle` | 15 | 3 | 1 |
| `Normal` | 10 | 5 | 0.6 |
| `Lively` | 6 | 8 | 0.35 |

The estimated idle nudges per day `R` rise with heat until they reach the daily limit:

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="Estimated idle nudges per day R equal the smaller of effective heat H divided by the idle divisor D and the daily limit C.">
  <mi>R</mi><mo>=</mo><mi mathvariant="normal">min</mi><mo>(</mo><mfrac><mi>H</mi><mi>D</mi></mfrac><mo>,</mo><mi>C</mi><mo>)</mo>
</math>

The base interval is `16 / R` hours. Each interval gets a random multiplier between 0.5 and 1.5,
and each consecutive unanswered invitation triples the next interval. Three unanswered invitations
pause idle nudges until someone talks to TomoriBot again. Quiet channels, waking hours, prerequisites,
and the planner's decision still determine whether a due nudge actually starts.

For active checks, heat changes the number of human messages needed in a channel. First calculate
an interval scale `s`, with the heat contribution held between 0.5 and 4:

<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" aria-label="The active interval scale s equals the frequency multiplier M times the smaller of four and the larger of one half and fifteen divided by effective heat H.">
  <mi>s</mi><mo>=</mo><mi>M</mi><mo>·</mo><mi mathvariant="normal">min</mi><mo>(</mo><mn>4</mn><mo>,</mo>
  <mi mathvariant="normal">max</mi><mo>(</mo><mn>0.5</mn><mo>,</mo><mfrac><mn>15</mn><mi>H</mi></mfrac><mo>)</mo><mo>)</mo>
</math>

A check's message target is randomly drawn between `max(1, round(15 × s))` and
`max(1, round(40 × s))`, inclusive. Rounding uses the nearest whole message, with halves rounded
upward. Threads share their parent's counter. Cooldowns and daily limits still apply, and the
checker only invites a persona to speak when the conversation matches an interest. These formulas
control timing; a check can produce no reply.

For example, with both frequencies set to `Gentle`:

| Effective heat | Estimated idle nudges per week | Human messages between active checks |
|---|---|---|
| Below 1 | 0 | No checks |
| 5 | About 2.3 | 45-120 |
| 15 | About 7 | 15-40 |
| 30 | About 14 | 8-20 |
| 45-50 | Up to 21 | 8-20 |

Active checks reach their fastest interval at heat 30. Idle nudges reach their maximum pace at
heat 30 for `Rare`, 45 for `Gentle`, 50 for `Normal`, and 48 for `Lively`. Those are the reasons the
effective heat ceiling is 50.

## Persona settings

Open `/config` > `Persona` > `Nudges` to set:

- **Talkativeness:** how often the persona speaks up. `Silent` personas do not nudge.
- **Interests:** up to 8 topics the persona likes, with descriptions and examples.
- **Idle Nudges:** up to 20 idle nudges only this persona uses, described under
  [Persona idle nudges](#persona-idle-nudges).

Official presets include these settings. `/persona generate` suggests interests for new personas;
`Generate Interests` adds new ones through your current text model. Persona exports include all three.

## What gets stored

Settings, custom nudges, interests, and persona idle nudges are saved with your server configuration. Nudge history,
including whether anyone answered and who was pinged, is kept for 30 days. Agendas are kept for
up to 90 days.

- **Server config:** `/reset` restores nudge settings and removes custom nudges. Config exports
  and imports carry settings and custom nudges, excluding the server-specific channel list. Persona
  idle nudges stay with their persona through a reset and travel in its persona card instead.
  `/persona default` and deleting a persona remove its idle nudges.
- **Personal config:** your `Pings from Personas` choice survives `/reset personal config`, is
  included in `/export personal config`, and is erased by `/personal nuke`.
