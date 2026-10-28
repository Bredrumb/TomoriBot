---
title: "Danbooru search"
sidebar:
  order: 6
---

Danbooru tag lookup helps TomoriBot find what a character looks like before generating an image.
She can also find outfit and cosplay tags when you ask to dress another character as them. Anime
image models such as NovelAI use these tags to describe the character and their clothes.

With `Danbooru Search` on (`/config` > `Plugins` > `Available Tools`, on by default), she can look
up tags before using her image-generation tool:

- Names, nicknames, and typos resolve to the real tag (`ryza` becomes `reisalin stout`), with how
  many posts use it. A corrected or partial match can be a different thing, so she checks it.
- For a character or one of their outfits, she also gets the tags that most often appear with
  them, the character's named outfits and cosplay tag, and a short wiki summary. These tags come
  only from general and sensitive posts, in every channel.

Each lookup posts a **Danbooru Tag Lookup** card listing what was found, with the character's
tags in a block you can paste into a manual `/generate image` prompt. The card stays visible at
every notice verbosity, and later replies can reuse its tags without searching again. Hide it
under `/config` > Behavior > Notices like any other notice.

### Art Search and Post Reading
<!-- anchor: art-search-and-post-reading -->

The same toggle lets her share existing art and read a post's tags:

- Asked to show art of something, she posts up to 4 random well-rated Danbooru images in one
  message, with a link to each post. Questionable and explicit images are spoilered. Danbooru allows
  only 2 tags per search, so she picks the most specific ones, usually the character or series.
- Given a Danbooru post ID or `danbooru.donmai.us/posts/` link, she reads its tags grouped into
  character, series, artist, meta, and general.

Under Deliberate Tool Mode, a post link in the message offers her the post reader, and asking to
see art "of" or "from" something (or naming Danbooru) offers her the art search and tag lookup.
An image generation request also offers the tag lookup, so she can check a character's tags first.

Anyone can also run `/booru search` to get the same gallery without asking her. It suggests tags as
you type and turns a nickname or typo into the real tag, and the footer shows what it searched for.
The optional `count` sets how many images to send, from 1 to 10 (default: 4). If fewer posts match,
it sends the available results.
The toggle controls her tools. To limit who can run `/booru search`, use Discord's
`Server Settings` > `Integrations`.

Ratings follow the channel. General and sensitive posts work everywhere; questionable and explicit
posts only in age-restricted channels. A thread follows its parent channel, and DMs count as not
age-restricted. A post rated above general that is tagged `loli`, `shota`, or `toddlercon` is never
posted or read, in any channel.
