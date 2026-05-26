# 22. Discord Message Components V2

Since 2025, message components got a lot more powerful, allowing for more interactive and dynamic user experiences. This document outlines the key features and improvements introduced in this version.

## Overview

- **Layout Components** - For organizing and structuring content (Action Rows, Sections, Containers)
- **Content Components** - For displaying static text, images, and files (Text Display, Media Gallery, Thumbnails)
- **Interactive Components** - For user interactions (Buttons, Select Menus, Text Input)

### Component Types

The following is a complete table of available message components. Details about each component are in the sections below.

| Type | Name                                      | Description                                                | Style       |
| ---- | ----------------------------------------- | ---------------------------------------------------------- | ----------- |
| 1    | [Action Row](#action-row)                 | Container to display a row of interactive components       | Layout      |
| 2    | [Button](#button)                         | Button object                                              | Interactive |
| 3    | [String Select](#string-select)           | Select menu for picking from defined text options          | Interactive |
| 5    | [User Select](#user-select)               | Select menu for users                                      | Interactive |
| 6    | [Role Select](#role-select)               | Select menu for roles                                      | Interactive |
| 7    | [Mentionable Select](#mentionable-select) | Select menu for mentionables (users _and_ roles)           | Interactive |
| 8    | [Channel Select](#channel-select)         | Select menu for channels                                   | Interactive |
| 9    | [Section](#section)                       | Container to display text alongside an accessory component | Layout      |
| 10   | [Text Display](#text-display)             | Markdown text                                              | Content     |
| 11   | [Thumbnail](#thumbnail)                   | Small image that can be used as an accessory               | Content     |
| 12   | [Media Gallery](#media-gallery)           | Display images and other media                             | Content     |
| 13   | [File](#file)                             | Displays an attached file                                  | Content     |
| 14   | [Separator](#separator)                   | Component to add vertical padding between other components | Layout      |
| 17   | [Container](#container)                   | Container that visually groups a set of components         | Layout      |

## Anatomy of a Component

All components have the following fields:

- `type` (integer) | The [type](#component-object-component-types) of the component
- `id` (integer, optional) | 32 bit integer used as an optional identifier for component

The `id` field is optional and is used to identify components in the response from an interaction. The `id` must be unique within the message and is generated sequentially if left empty. Generation of `id`s won't use another `id` that exists in the message if you have one defined for another component. Sending components with an `id` of `0` is allowed but will be treated as empty and replaced by the API.

### Custom ID

Additionally, interactive components like buttons and selects must have a `custom_id` field. The developer defines this field when sending the component payload, and it is returned in the interaction payload sent when a user interacts with the component. For example, if you set `custom_id: click_me` on a button, you'll receive an interaction containing `custom_id: click_me` when a user clicks that button.

`custom_id` is only available on interactive components and must be unique per component. Multiple components on the same message must not share the same `custom_id`. Maximum length is 100 characters.

---

## Action Row

An Action Row is a top-level layout component.

Action Rows can contain one of the following:

- Up to 5 contextually grouped [buttons](#button)
- A single select component ([string select](#string-select), [user select](#user-select), [role select](#role-select), [mentionable select](#mentionable-select), or [channel select](#channel-select))

#### Action Row Structure

| Field      | Type                                 | Description                                                        |
| ---------- | ------------------------------------ | ------------------------------------------------------------------ |
| type       | integer                              | `1` for action row component                                       |
| id?        | integer                              | Optional identifier for component                                  |
| components | array of action row child components | Up to 5 interactive button components or a single select component |

##### Example

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 2, // ComponentType.BUTTON
          "custom_id": "click_yes",
          "label": "Accept",
          "style": 1
        },
        {
          "type": 2, // ComponentType.BUTTON
          "label": "Learn More",
          "style": 5,
          "url": "http://watchanimeattheoffice.com/"
        },
        {
          "type": 2, // ComponentType.BUTTON
          "custom_id": "click_no",
          "label": "Decline",
          "style": 4
        }
      ]
    }
  ]
}
```

---

## Button

A Button is an interactive component that can only be used in messages.

Buttons must be placed inside an [Action Row](#action-row) or a [Section](#section)'s `accessory` field.

#### Button Structure

| Field     | Type          | Description                                                                                            |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| type      | integer       | `2` for a button                                                                                       |
| id?       | integer       | Optional identifier for component                                                                      |
| style     | integer       | A [button style](#button-button-styles)                                                                |
| label?    | string        | Text that appears on the button; max 80 characters                                                     |
| emoji?    | partial emoji | `name`, `id`, and `animated` (id and animated are optional)                                            |
| custom_id | string        | Developer-defined identifier for the button; max 100 characters                                        |
| sku_id?   | snowflake     | Identifier for a purchasable SKU (stock keeping unit), only available when using premium-style buttons |
| url?      | string        | URL for link-style buttons; max 512 characters                                                         |
| disabled? | boolean       | Whether the button is disabled (defaults to `false`)                                                   |

Buttons come in various styles to convey different types of actions. These styles also define what fields are valid for a button.

- Non-link and non-premium buttons **must** have a `custom_id`, and cannot have a `url` or a `sku_id`.
- Link buttons **must** have a `url`, and cannot have a `custom_id`
- Link buttons do not send an interaction to the app when clicked
- Premium buttons **must** contain a `sku_id`, and cannot have a `custom_id`, `label`, `url`, or `emoji`.
- Premium buttons do not send an interaction to the app when clicked

##### Button Styles

| Name      | Value | Action                                                         | Required Field |
| --------- | ----- | -------------------------------------------------------------- | -------------- |
| Primary   | 1     | The most important or recommended action in a group of options | `custom_id`    |
| Secondary | 2     | Alternative or supporting actions                              | `custom_id`    |
| Success   | 3     | Positive confirmation or completion actions                    | `custom_id`    |
| Danger    | 4     | An action with irreversible consequences                       | `custom_id`    |
| Link      | 5     | Navigates to a URL                                             | `url`          |
| Premium   | 6     | Purchase                                                       | `sku_id`       |

###### Examples

Just a button:

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 2, // ComponentType.BUTTON
          "custom_id": "click_yes",
          "label": "Accept",
          "style": 1
        }
      ]
    }
  ]
}
```

#### Premium Buttons

Premium buttons will automatically have the following:

- Shop Icon
- SKU name
- SKU price

---

## String Select

A String Select is an interactive component that allows users to select one or more provided `options`.

String Selects can be configured for both single-select and multi-select behavior.

String Selects must be placed inside an [Action Row](#action-row) in messages.

### String Select Structure

| Field        | Type                                                       | Description                                                                |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| type         | integer                                                    | `3` for string select                                                      |
| id?          | integer                                                    | Optional identifier for component                                          |
| custom_id    | string                                                     | ID for the select menu; max 100 characters                                 |
| options      | array of [select options](#string-select-option-structure) | Specified choices in a select menu; max 25                                 |
| placeholder? | string                                                     | Placeholder text if nothing is selected or default; max 150 characters     |
| min_values?  | integer                                                    | Minimum number of items that must be chosen (defaults to 1); min 0, max 25 |
| max_values?  | integer                                                    | Maximum number of items that can be chosen (defaults to 1); max 25         |
| disabled?    | boolean                                                    | Whether select menu is disable in a message (defaults to `false`)          |

### String Select Option Structure

| Field        | Type                 | Description                                                 |
| ------------ | -------------------- | ----------------------------------------------------------- |
| label        | string               | User-facing name of the option; max 100 characters          |
| value        | string               | Dev-defined value of the option; max 100 characters         |
| description? | string               | Additional description of the option; max 100 characters    |
| emoji?       | partial emoji object | `id`, `name`, and `animated` (id and animated are optional) |
| default?     | boolean              | Will show this option as selected by default                |

Note that the number of options must be within the range of `min_values` and `max_values`.

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW,
      "id": 1,
      "components": [
        {
          "type": 3, // ComponentType.STRING_SELECT
          "id": 2,
          "custom_id": "favorite_bug",
          "placeholder": "Favorite bug?",
          "options": [
            {
              "label": "Ant",
              "value": "ant",
              "description": "(best option)",
              "emoji": { "name": "🐜" }
            },
            {
              "label": "Butterfly",
              "value": "butterfly",
              "emoji": { "name": "🦋" }
            },
            {
              "label": "Caterpillar",
              "value": "caterpillar",
              "emoji": { "name": "🐛" }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## User Select

A User Select is an interactive component that allows users to select one or more users in a message. Options are automatically populated based on the server's available users.

User Selects can be configured for both single-select and multi-select behavior.

User Selects must be placed inside an [Action Row](#action-row).

### User Select Structure

| Field           | Type                                                              | Description                                                                                                    |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| type            | integer                                                           | `5` for user select                                                                                            |
| id?             | integer                                                           | Optional identifier for component                                                                              |
| custom_id       | string                                                            | ID for the select menu; max 100 characters                                                                     |
| placeholder?    | string                                                            | Placeholder text if nothing is selected; max 150 characters                                                    |
| default_values? | array of [default value objects](#select-default-value-structure) | List of default values; number of default values must be in the range defined by `min_values` and `max_values` |
| min_values?     | integer                                                           | Minimum number of items that must be chosen (defaults to 1); min 0, max 25                                     |
| max_values?     | integer                                                           | Maximum number of items that can be chosen (defaults to 1); max 25                                             |
| disabled?       | boolean                                                           | Whether select menu is disabled (defaults to `false`)                                                          |

#### Select Default Value Structure

| Field | Type      | Description                                                                   |
| ----- | --------- | ----------------------------------------------------------------------------- |
| id    | snowflake | ID of a user, role, or channel                                                |
| type  | string    | Type of value that `id` represents. Either `"user"`, `"role"`, or `"channel"` |

### Examples

Regular user select

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 5, // ComponentType.USER_SELECT
          "custom_id": "user_select",
          "placeholder": "Select a user"
        }
      ]
    }
  ]
}
```

User select with default values

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 5, // ComponentType.USER_SELECT
          "custom_id": "user_select",
          "placeholder": "Select a user",
          "default_values": [
            {
              "id": "123456789012345678",
              "type": "user"
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Role Select

The same as the [User Select](#user-select), but for the roles within a guild.

The `type` of a role select is `6`.

Note, that the default values have to have the type `"role"`.

### Examples

Regular role select

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 6, // ComponentType.ROLE_SELECT
          "custom_id": "role_select",
          "placeholder": "Select a role"
        }
      ]
    }
  ]
}
```

Role select with default values

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 6, // ComponentType.ROLE_SELECT
          "custom_id": "role_select",
          "placeholder": "Select a role",
          "default_values": [
            {
              "id": "123456789012345678",
              "type": "role"
            }
          ]
        }
      ]
    }
  ]
}
```

---

### Mentionable Select

Mentionable selects are uniting user selects and roles selects.

The `type` of a mentionable select is `7`.

Note that the default values can accept both types `"user"` and `"role"`.

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 7, // ComponentType.MENTIONABLE_SELECT
          "custom_id": "who_to_ping",
          "placeholder": "Who?"
        }
      ]
    }
  ]
}
```

With default values:

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 7, // ComponentType.MENTIONABLE_SELECT
          "custom_id": "who_to_ping",
          "placeholder": "Who?",
          "default_values": [
            {
              "id": "123456789012345678",
              "type": "user"
            },
            {
              "id": "987654321098765432",
              "type": "role"
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Channel Select

A Channel Select is an interactive component that allows users to select one or more channels in a message.

Channel Selects can be configured for both single-select and multi-select behavior.

### Channel Select Structure

| Field           | Type                                                              | Description                                                                                                    |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| type            | integer                                                           | `8` for channel select                                                                                         |
| id?             | integer                                                           | Optional identifier for component                                                                              |
| custom_id       | string                                                            | ID for the select menu; max 100 characters                                                                     |
| channel_types?  | array of [channel types](#channel-types)                          | List of channel types to include in the channel select component                                               |
| placeholder?    | string                                                            | Placeholder text if nothing is selected; max 150 characters                                                    |
| default_values? | array of [default value objects](#select-default-value-structure) | List of default values; number of default values must be in the range defined by `min_values` and `max_values` |
| min_values?     | integer                                                           | Minimum number of items that must be chosen (defaults to 1); min 0, max 25                                     |
| max_values?     | integer                                                           | Maximum number of items that can be chosen (defaults to 1); max 25                                             |
| disabled?       | boolean                                                           | Whether select menu is disabled (defaults to `false`)                                                          |

#### Channel Types

- GUILD_TEXT: `0` - a text channel within a server
- DM: `1` - a direct message between users
- GUILD_VOICE: `2` - a voice channel within a server
- GROUP_DM: `3` - a direct message between multiple users
- GUILD_CATEGORY: `4` - an organizational category that contains up to 50 channels
- GUILD_ANNOUNCEMENT: `5` - a channel that users can follow and crosspost into their own server (formerly news channels)
- ANNOUNCEMENT_THREAD: `10` - a temporary sub-channel within a GUILD_ANNOUNCEMENT channel
- PUBLIC_THREAD: `11` - a temporary sub-channel within a GUILD_TEXT or GUILD_FORUM channel
- PRIVATE_THREAD: `12` - a temporary sub-channel within a GUILD_TEXT channel that is only viewable by those invited and those with the MANAGE_THREADS permission
- GUILD_STAGE_VOICE: `13` - a voice channel for hosting events with an audience
- GUILD_DIRECTORY: `14` - the channel in a hub containing the listed servers
- GUILD_FORUM: `15` - channel that can only contain threads
- GUILD_MEDIA: `16` - channel that can only contain threads, similar to GUILD_FORUM channels

Missing values are legacy channel types.

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 1, // ComponentType.ACTION_ROW
      "components": [
        {
          "type": 8, // ComponentType.CHANNEL_SELECT
          "custom_id": "notification_channel",
          "channel_types": [0], // ChannelType.TEXT
          "placeholder": "Which text channel?"
        }
      ]
    }
  ]
}
```

---

## Section

A Section is a top-level layout component that allows you to contextually associate content with an accessory component.
The typical use-case is to contextually associate [text content](#text-display) with
an [accessory](#section-section-accessory-components).

Sections MUST include the accessory component.

### Section Structure

| Field      | Type                                                                   | Description                                                                                                     |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| type       | integer                                                                | `9` for section component                                                                                       |
| id?        | integer                                                                | Optional identifier for component                                                                               |
| components | array of [section child components](#section-section-child-components) | 1 - 3 child components representing the content of the section that is contextually associated to the accessory |
| accessory  | [section accessory component](#section-section-accessory-components)   | A component that is contextually associated to the content of the section                                       |

#### Section Child Components

- [Text Display](#text-display)

#### Section Accessory Components

- [Button](#button)
- [Thumbnail](#thumbnail)

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 9, // ComponentType.SECTION
      "components": [
        {
          "type": 10, // ComponentType.TEXT_DISPLAY
          "content": "The game is out now! Check it out on our website."
        }
      ],
      "accessory": {
        "type": 11, // ComponentType.THUMBNAIL
        "media": {
          "url": "https://websitewithopensourceimages/gamepreview.webp"
        }
      }
    }
  ]
}
```

---

## Text Display

A Text Display is a content component that allows you to add markdown formatted text, including mentions (users, roles, etc) and emojis.
The behavior of this component is extremely similar to the `content` field of a message, but allows you to add multiple text components, controlling the layout of your message.

When sent in a message, pingable mentions (@user, @role, etc) present in this component will ping and send notifications based on the value of the allowed mention object set in `message.allowed_mentions`.

### Text Display Structure

| Field   | Type    | Description                                      |
| ------- | ------- | ------------------------------------------------ |
| type    | integer | `10` for text display                            |
| id?     | integer | Optional identifier for component                |
| content | string  | Text that will be displayed similar to a message |

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "# Real Game v7.3"
    },
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "Hope you're excited, the update is finally here! Here are some of the changes:\n- Fixed a bug where certain treasure chests wouldn't open properly\n- Improved server stability during peak hours\n- Added a new type of gravity that will randomly apply when the moon is visible in-game\n- Every third thursday the furniture will scream your darkest secrets to nearby npcs"
    },
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "-# That last one wasn't real, but don't use voice chat near furniture just in case..."
    }
  ]
}
```

---

## Thumbnail

A Thumbnail is a content component that displays visual media in a small form-factor. It is intended as an accessory for to other content, and is primarily usable with [sections](#section).
The media displayed is defined by the [unfurled media item](#unfurled-media-item) structure, which supports both uploaded media and externally hosted media.

Thumbnails currently only support images, including animated formats like GIF and WEBP. Videos are not supported at this time.

###### Thumbnail Structure

| Field        | Type                | Description                                                                     |
| ------------ | ------------------- | ------------------------------------------------------------------------------- |
| type         | integer             | `11` for thumbnail component                                                    |
| id?          | integer             | Optional identifier for component                                               |
| media        | unfurled media item | A url or attachment provided as an [unfurled media item](#unfurled-media-item)  |
| description? | string              | Alt text for the media, max 1024 characters                                     |
| spoiler?     | boolean             | Whether the thumbnail should be a spoiler (or blurred out). Defaults to `false` |

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 9, // ComponentType.SECTION
      "components": [
        {
          "type": 10, // ComponentType.TEXT_DISPLAY
          "content": "Please visit our website for more information."
        }
      ],
      "accessory": {
        "type": 11, // ComponentType.THUMBNAIL
        "media": {
          "url": "https://websitewithopensourceimages/gamepreview.webp"
        }
      }
    }
  ]
}
```

---

## Media Gallery

A Media Gallery is a top-level content component that allows you to display 1-10 media attachments in an organized gallery format.
Each item can have optional descriptions and can be marked as spoilers.

### Media Gallery Structure

| Field | Type                                                                        | Description                       |
| ----- | --------------------------------------------------------------------------- | --------------------------------- |
| type  | integer                                                                     | `12` for media gallery component  |
| id?   | integer                                                                     | Optional identifier for component |
| items | array of [media gallery items](#media-gallery-media-gallery-item-structure) | 1 to 10 media gallery items       |

### Media Gallery Item Structure

| Field        | Type                                        | Description                                                                    |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| media        | [unfurled media item](#unfurled-media-item) | A url or attachment provided as an [unfurled media item](#unfurled-media-item) |
| description? | string                                      | Alt text for the media, max 1024 characters                                    |
| spoiler?     | boolean                                     | Whether the media should be a spoiler. Defaults to `false`                     |

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "Live webcam shots as of 18-04-2025 at 12:00 UTC"
    },
    {
      "type": 12, // ComponentType.MEDIA_GALLERY
      "items": [
        {
          "media": {
            "url": "https://livevideofeedconvertedtoimage/webcam1.webp"
          },
          "description": "An aerial view looking down on older industrial complex buildings. The main building is white with many windows and pipes running up the walls."
        },
        {
          "media": {
            "url": "https://livevideofeedconvertedtoimage/webcam2.webp"
          },
          "description": "An aerial view of old broken buildings. Nature has begun to take root in the rooftops. A portion of the middle building's roof has collapsed inward. In the distant haze you can make out a far away city."
        },
        {
          "media": {
            "url": "https://livevideofeedconvertedtoimage/webcam3.webp"
          },
          "description": "A street view of a downtown city. Prominently in photo are skyscrapers and a domed building"
        }
      ]
    }
  ]
}
```

---

## File

A File is a top-level content component that allows you to display an [uploaded file](#uploading-a-file) as an attachment to the message and reference it in the component.
Each file component can only display 1 attached file, but you can upload multiple files and add them to different file components within your payload.

Info: The File component only supports using the `attachment://` protocol in [unfurled media item](#unfurled-media-item).

###### File Structure

| Field    | Type                | Description                                                                                                                      |
| -------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| type     | integer             | `13` for a file component                                                                                                        |
| id?      | integer             | Optional identifier for component                                                                                                |
| file     | unfurled media item | This unfurled media item is unique in that it **only** supports attachment references using the `attachment://<filename>` syntax |
| spoiler? | boolean             | Whether the media should be a spoiler (or blurred out). Defaults to `false`                                                      |
| name     | string              | The name of the file. This field is ignored and provided by the API as part of the response                                      |
| size     | integer             | The size of the file in bytes. This field is ignored and provided by the API as part of the response                             |

### Examples

Info: This example makes use of the `attachment://` protocol functionality in [unfurled media item](#unfurled-media-item).

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "# New game version released for testing!\nGrab the game here:"
    },
    {
      "type": 13, // ComponentType.FILE
      "file": {
        "url": "attachment://game.zip"
      }
    },
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "Latest manual artwork here:"
    },
    {
      "type": 13, // ComponentType.FILE
      "file": {
        "url": "attachment://manual.pdf"
      }
    }
  ]
}
```

---

## Separator

A Separator is a top-level layout component that adds vertical padding and visual division between other components.

###### Separator Structure

| Field    | Type    | Description                                                                               |
| -------- | ------- | ----------------------------------------------------------------------------------------- |
| type     | integer | `14` for separator component                                                              |
| id?      | integer | Optional identifier for component                                                         |
| divider? | boolean | Whether a visual divider should be displayed in the component. Defaults to `true`         |
| spacing? | integer | Size of separator padding - `1` for small padding, `2` for large padding. Defaults to `1` |

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "It's dangerous to go alone!"
    },
    {
      "type": 14, // ComponentType.SEPARATOR
      "divider": true,
      "spacing": 1
    },
    {
      "type": 10, // ComponentType.TEXT_DISPLAY
      "content": "Take this."
    }
  ]
}
```

---

## Container

A Container is a top-level layout component. Containers offer the ability to visually encapsulate a collection of components
and have an optional customizable accent color bar.

###### Container Structure

| Field         | Type                                                               | Description                                                                      |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| type          | integer                                                            | `17` for container component                                                     |
| id?           | integer                                                            | Optional identifier for component                                                |
| components    | array of [container child components](#container-child-components) | Child components that are encapsulated within the Container                      |
| accent_color? | ?integer                                                           | Color for the accent on the container as RGB from `0x000000` to `0xFFFFFF`       |
| spoiler?      | boolean                                                            | Whether the container should be a spoiler (or blurred out). Defaults to `false`. |

###### Container Child Components

- [Action Row](#action-row)
- [Text Display](#text-display)
- [Section](#section)
- [Media Gallery](#media-gallery)
- [Separator](#separator)
- [File](#file)

### Examples

```json
{
  "flags": 32768,
  "components": [
    {
      "type": 17, // ComponentType.CONTAINER
      "accent_color": 703487,
      "components": [
        {
          "type": 10, // ComponentType.TEXT_DISPLAY
          "content": "# You have encountered a wild coyote!"
        },
        {
          "type": 12, // ComponentType.MEDIA_GALLERY
          "items": [
            {
              "media": {
                "url": "https://websitewithopensourceimages/coyote.webp"
              }
            }
          ]
        },
        {
          "type": 10, // ComponentType.TEXT_DISPLAY
          "content": "What would you like to do?"
        },
        {
          "type": 1, // ComponentType.ACTION_ROW
          "components": [
            {
              "type": 2, // ComponentType.BUTTON
              "custom_id": "pet_coyote",
              "label": "Pet it!",
              "style": 1
            },
            {
              "type": 2, // ComponentType.BUTTON
              "custom_id": "feed_coyote",
              "label": "Attempt to feed it",
              "style": 2
            },
            {
              "type": 2, // ComponentType.BUTTON
              "custom_id": "run_away",
              "label": "Run away!",
              "style": 4
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Unfurled Media Item

An Unfurled Media Item is a piece of media, represented by a URL, that is used within a component. It can be
constructed via either uploading media to Discord, or by referencing external media via **a direct link** to the asset.

Info: While the structure below is the full representation of an Unfurled Media Item, **only the `url` field is settable by developers** when making requests that utilize this structure.
All other fields will be automatically populated by Discord.

###### Unfurled Media Item Structure

| Field            | Type      | Description                                                                                                                                      |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| url              | string    | Supports arbitrary urls and `attachment://<filename>` references                                                                                 |
| proxy_url?       | string    | The proxied url of the media item. This field is ignored and provided by the API as part of the response                                         |
| height?          | ?integer  | The height of the media item. This field is ignored and provided by the API as part of the response                                              |
| width?           | ?integer  | The width of the media item. This field is ignored and provided by the API as part of the response                                               |
| content_type?    | string    | The [media type](https://en.wikipedia.org/wiki/Media_type) of the content. This field is ignored and provided by the API as part of the response |
| attachment_id?\* | snowflake | The id of the uploaded attachment. This field is ignored and provided by the API as part of the response                                         |

\* Only present if the media item was uploaded as an attachment.

### Uploading a file

To upload a file with your message, you'll need to send your payload as `multipart/form-data` (rather than `application/json`) and include your file with a valid filename in your payload. Details and examples for uploading files can be found in the Discord API Reference.

## Legacy Message Component Behavior

Before the introduction of the `IS_COMPONENTS_V2` flag, message components were sent in conjunction with message content. This means that you could send a message using a subset of the available components without setting the `IS_COMPONENTS_V2` flag, and the components would be included in the message content along with `content` and `embeds`.

Additionally, components of messages preceding components V2 will contain an `id` of `0`.

Apps using this Legacy Message Component behavior will continue to work as expected, but it is recommended to use the new `IS_COMPONENTS_V2` flag for new apps or features as they offer more options for layout and customization.

Info: Legacy messages allow up to 5 action rows as top-level components

Legacy Message Component Example

```json
{
  "content": "This is a message with legacy components",
  "components": [
    {
      "type": 1,
      "components": [
        {
          "type": 2,
          "style": 1,
          "label": "Click Me",
          "custom_id": "click_me_1"
        }
      ]
    }
  ]
}
```
