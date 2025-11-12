package com.prototype.aishiteru.helpers

import android.content.Context
import org.json.JSONObject
import com.prototype.aishiteru.classes.MessageItem

class PromptBuilder(private val context: Context) {

    fun buildPrompt(
        charName: String, // Name of character
        userName: String, // Name of user
        relationLvl: Int, // Ranges from 1 to 4
        isJapanese: Boolean, // If Japanese, use JP version sample dialogues
        convoHistory: Array<MessageItem>? = null, // Conversation history (optional)
        addContext: String? = null
    ): String {
        // Convert character name to file name (first word, lowercase)
        val fileName = charName.split(" ")[0].lowercase() + ".json"
        println("Attempting to load file: '$fileName'")

        // Load JSON file
        val jsonString = loadJSONFromAsset("characters/$fileName")
        val characterJSON = JSONObject(jsonString)
        val character = characterJSON.getJSONObject("character")

        // Create a map to hold attributes
        val attributesMap = mutableMapOf<String, Any>()

        // Iterate through keys and exclude unwanted keys
        for (key in character.keys()) {
            if (key != "accent_color") {
                val value = character.get(key)
                attributesMap[key] = value
            }
        }

        // Start building the attributes string
        val attributesBuilder = StringBuilder()
        attributesBuilder.append("[")

        // Helper function to process nested attributes
        fun processAttribute(keyPrefix: String, value: Any, topLevelKey: String) {
            when (value) {
                is JSONObject -> {
                    for (subKey in value.keys()) {
                        val subValue = value.get(subKey)
                        // Reset prefix to the top-level key for nested attributes
                        processAttribute("$topLevelKey's $subKey", subValue, topLevelKey)
                    }
                }
                is org.json.JSONArray -> {
                    val list = mutableListOf<String>()
                    for (i in 0 until value.length()) {
                        list.add(value.getString(i))
                    }
                    attributesBuilder.append("$keyPrefix: ${list.joinToString(", ")}; ")
                }
                else -> {
                    attributesBuilder.append("$keyPrefix: $value; ")
                }
            }
        }

        // Main loop to process attributes
        for ((key, value) in attributesMap) {
            if (key != "sample_dialogues" && key != "first_messages" && key != "japanese_ver") {
                processAttribute("$charName's $key", value, charName)
            }
        }
        attributesBuilder.append("]")

        // Construct sample dialogues
        val sampleDialogues = if (!isJapanese) {
            characterJSON.getJSONArray("sample_dialogues")
        } else {
            val japaneseVer = characterJSON.getJSONObject("japanese_ver")
            japaneseVer.getJSONArray("sample_dialogues")
        }

        val dialoguesBuilder = StringBuilder()

        for (i in 0 until sampleDialogues.length()) {
            val dialoguePair = sampleDialogues.getJSONArray(i)
            var userLine = dialoguePair.getString(0)
            var charLine = dialoguePair.getString(1)

            // Replace placeholders
            userLine = userLine.replace("{{user}}", userName).replace("{{char}}", charName).replace("{user}", userName).replace("{char}", charName)
            charLine = charLine.replace("{{user}}", userName).replace("{{char}}", charName).replace("{user}", userName).replace("{char}", charName)

            // Append to builder
            dialoguesBuilder.append("$userName: $userLine\n")
            dialoguesBuilder.append("$charName: $charLine\n")
        }

        // Handle additional context
        val contextString = buildContext(charName, userName, relationLvl, addContext)

        // Combine all parts
        val finalPrompt = StringBuilder()
        finalPrompt.append(attributesBuilder.toString())
        finalPrompt.append("\n")
        finalPrompt.append(dialoguesBuilder.toString())
        finalPrompt.append("[The following is a new roleplay scene involving $charName and $userName.")
        if (contextString.isNotEmpty()) {
            finalPrompt.append(contextString)
            finalPrompt.append("]\n")
        } else {
            finalPrompt.append("]\n")
        }

        // Append conversation history if available
        convoHistory?.let {
            val historyBuilder = StringBuilder()
            convoHistory.forEach { message ->
                historyBuilder.append("${message.sender.name}: ${message.text}\n")
            }
            finalPrompt.append(historyBuilder.toString())
        }

        return finalPrompt.toString()
    }

    fun getFirstMessage(
        charName: String,
        keyword: String? = null,
        isJapanese: Boolean
    ): String {
        // Convert character name to file name (first word, lowercase)
        val fileName = charName.split(" ")[0].lowercase() + ".json"
        println("Attempting to load file: '$fileName'")

        // Load JSON file
        val jsonString = loadJSONFromAsset("characters/$fileName")
        val characterJSON = JSONObject(jsonString)

        // Get the correct first_messages section
        val firstMessages = if (isJapanese) {
            characterJSON.getJSONObject("japanese_ver").getJSONObject("first_messages")
        } else {
            characterJSON.getJSONObject("first_messages")
        }

        return if (keyword != null && firstMessages.has(keyword)) {
            firstMessages.getString(keyword)
        } else  {
            // Default to the first sample dialogue if no keyword is given or keyword not found
            val sampleDialogues = if (!isJapanese) {
                characterJSON.getJSONArray("sample_dialogues")
            } else {
                characterJSON.getJSONObject("japanese_ver").getJSONArray("sample_dialogues")
            }
            sampleDialogues.getJSONArray(0).getString(1) // Return the character's first sample dialogue
        }
    }

    private fun buildContext(
        charName: String,
        userName: String,
        relationLvl: Int,
        addContext: String?
    ): String {
        val contextBuilder = StringBuilder()

        // Add relationship level context
        when (relationLvl) {
            1 -> contextBuilder.append(" Remember that $charName and $userName are strangers to each other right now.")
            2 -> contextBuilder.append(" Remember that $charName and $userName are acquaintances right now.")
            3 -> contextBuilder.append(" Remember that $charName and $userName are friends right now.")
            4 -> contextBuilder.append(" Remember that $charName and $userName are lovers right now.")
        }

        // Add additional context if provided
        addContext?.let {
            if (contextBuilder.isNotEmpty()) contextBuilder.append(" ")
            contextBuilder.append(it)
        }

        return contextBuilder.toString()
    }

    private fun loadJSONFromAsset(fileName: String): String {
        return try {
            val inputStream = context.assets.open(fileName)
            inputStream.bufferedReader().use { it.readText() } // Reads the entire file content
        } catch (e: Exception) {
            e.printStackTrace()
            "" // Return an empty string in case of an error
        }
    }
}
