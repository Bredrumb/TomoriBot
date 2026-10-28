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

The pace follows your server's [Heat](#heat), with an optional saved adjustment.
Servers with low effective heat get neither kind.
DMs never get nudges (for now).

Both kinds pause after 14 days without someone directly chatting with TomoriBot. Mention her,
use a persona's trigger word, or reply to her message to resume them.

Outside Play Scenes, a nudge can invite another persona to answer by using `@` before their trigger
word, including in Deliberate Trigger Mode. Replies follow your server's match and cascade limits
and persona channel restrictions. They do not count as human activity or create short-term memories.
A member's message stops pending nudge replies. Play Scenes follow their planned sequence.

## Idle nudges
<!-- anchor: idle-nudges -->

Idle nudges wait until a channel has been quiet for a while, during the hours your server is
usually awake. There are 28 built-in idle nudges across four categories. You can adjust them and add
your own for the whole server in `/nudge-studio`, and each persona can have idle nudges of its own
(see [Persona settings](#persona-settings)).

The bot first picks a category, then the planner chooses an idle nudge and channel together from
a shortlist of available activities in that category.
It considers channel names, descriptions, and recent messages, and can skip the attempt when none fits.

| Category | What it does | Prerequisites | Notes |
|---|---|---|---|
| <a id="ping-user"></a>Ping User | Checks in on a member or shares something they might like. | Recent conversation with this persona in this server, a memory, and permission to ping. Full privacy, personalization blacklists, and persona blocks exclude members. | Frequent contacts are favored; recent pings reduce repeat chances. Opt out in `/personal config` > `Privacy` > `Pings from Personas`. |
| Revive Topic | Picks up an unfinished conversation. | A conversation left hanging. | N/A |
| Start Topic | Raises something new, often about the persona's interests. | No extra category requirements. | N/A |
| <a id="play-scene"></a>Play Scene | Starts a short exchange between two or three personas. | Another persona allowed to nudge in that channel. | Talkative personas join more often; Silent ones never do. If a member posts, the scene stops and a persona answers them. Surprise scenes do not ping their subject. |

### Hidden agendas

Each idle nudge gives the persona a small private goal, such as "find out who else likes this
anime", to guide later replies. In a Play Scene, each persona gets its own goal. The goal expires
when the opener leaves the persona's conversation history.


### Choose and create idle nudges

Open `/nudge-studio` (requires `Manage Server`) to browse each category. The colored dot shows
whether a nudge is on, missing a prerequisite, or off. Each row ends with its source: `Built-in`,
`Server custom`, or `For <persona>`.

`Toggle Availability` chooses which personas can use a nudge:

- **All checked:** every persona can use it, including personas you add later.
- **Some checked:** only those personas can use it. New personas stay out until you check them.
- **None checked:** the nudge is off.

A persona-owned nudge has one checkbox, `Available to <persona>`, because only its owner can use it.
Unchecking it turns it off without deleting it.

Limiting a server nudge to one persona does not move it onto that persona's page. It stays a server
nudge, and only the persona's own entries travel with its persona card.

You can add up to 25 of your own for the whole server, each one has:

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


## Active nudges
<!-- anchor: active-nudges -->

 TomoriBot
periodically checks recent messages for conversations about your personas' interests, wherein a persona with a matching interest usually joins in (A passing
mention of an interest does not count.). If several match, the more talkative ones
are likelier to be picked. Occasionally, another persona takes the turn, favoring personas people
rarely talk to. Personas that just spoke sit it out.

Each persona can hold up to 8 interests: topics it likes, with descriptions and examples. Set them
in `/config` > `Persona` > `Nudges` (see [Persona settings](#persona-settings)).


## Settings

Open `/config` > `Plugins` > `Natural Nudges` to change settings
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

## Persona settings

Open `/config` > `Persona` > `Nudges` to set:

- **Talkativeness:** how often the persona speaks up. `Silent` personas do not nudge.
- **Interests:** up to 8 topics the persona likes, with descriptions and examples.
- **Idle Nudges:** up to 20 idle nudges only this persona uses. 
Persona cards (`/persona export`) includes all of the above

Official presets include these settings. `/persona generate` suggests interests for new personas;
`Generate Interests` adds new ones through your current text model. Persona exports include all three.

## When Nudges Fire

### Heat
<!-- anchor: heat -->

Heat sets the pace of both idle nudges and active checks for your whole server, across members and
personas. The Natural Nudges settings show measured heat, your saved adjustment, and heat used for nudges out of 50. 

#### TLDR: More messages to TomoriBot = More heat = More automatic yap

*Anyways*, here are 5 equations:


#### Activity and decay

Measured heat is a weighted daily average of interactions over the last 30 days. Ordinary
conversation turns and human `/punish` turns contribute once; human `/reward` turns contribute
three times as much. Generated nudges and Playful Interactions between personas contribute nothing.

An interaction's weight halves every three days:

$$
w(d) = 2^{-d/3}
$$

Here, `d` is the number of days ago, using UTC days: today's activity has weight 1, three days ago
has weight 0.5, and six days ago has weight 0.25. Activity leaves the calculation after 30 days.
With `E_d` as each day's weighted interaction total, measured heat `A` is:

$$
A = \frac{\sum_{d=0}^{29} E_d \cdot w(d)}{\sum_{d=0}^{29} w(d)}
$$

Steady activity of 10 weighted interactions every day gives about 10 measured heat. Your saved
adjustment `Δ` is added after this average, then the result is limited to 0-50:

$$
H = \min(50, \max(0, A + \Delta))
$$

Measured activity stays uncapped, so a busy server's heat decays from its full value. Both modes
need measured heat and effective heat of at least 1. An adjustment changes the pace once measured
activity reaches that minimum. The 14-day pause without direct chat still applies at any heat.

#### Idle timing and active checks

For effective heat `H` of at least 1, your frequency level supplies these values:

| Frequency | Idle divisor D | Idle daily limit C | Active multiplier M |
|---|---|---|---|
| `Rare` | 175 | 1 | 2 |
| `Gentle` | 25 | 2 | 1 |
| `Normal` | 15 | 3 | 0.6 |
| `Lively` | 8 | 6 | 0.35 |

The estimated idle nudges per day `R` rise with heat until they reach the daily limit:

$$
R = \min\left(\frac{H}{D}, C\right)
$$

The base interval is `16 / R` hours. Each interval gets a random multiplier between 0.5 and 1.5,
and each consecutive unanswered invitation triples the next interval. Three unanswered invitations
pause idle nudges until someone talks to TomoriBot again. Quiet channels, waking hours, prerequisites,
and the planner's decision still determine whether a due nudge actually starts.

For active checks, heat changes the number of human messages needed in a channel. First calculate
an interval scale `s`, with the heat contribution held between 0.5 and 4:

$$
s = M \cdot \min\left(4, \max\left(0.5, \frac{15}{H}\right)\right)
$$

A check's message target is randomly drawn between `max(1, round(15 × s))` and
`max(1, round(40 × s))`, inclusive. Rounding uses the nearest whole message, with halves rounded
upward. Threads share their parent's counter. Cooldowns and daily limits still apply, and the
checker only invites a persona to speak when the conversation matches an interest. These formulas
control timing; a check can produce no reply.

For example, with both frequencies set to `Gentle`:

| Effective heat | Estimated idle nudges per week | Human messages between active checks |
|---|---|---|
| Below 1 | 0 | No checks |
| 5 | About 1.4 | 45-120 |
| 15 | About 4.2 | 15-40 |
| 30 | About 8.4 | 8-20 |
| 45 | About 12.6 | 8-20 |
| 50 | Up to 14 | 8-20 |

Active checks reach their fastest interval at heat 30. Idle nudges reach their daily limits at
heat 50 for `Gentle`, 45 for `Normal`, and 48 for `Lively`. `Rare` reaches an estimated two idle
nudges per week at heat 50, with at most one per day. Its weekly estimate is a pacing guide;
random timing and eligibility checks affect actual delivery. Heat above 50 adds no scheduling speed.
