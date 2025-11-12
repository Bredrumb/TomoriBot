package com.prototype.aishiteru.helpers
import android.content.Context
import android.util.Log
import com.prototype.aishiteru.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class KayraAPI(private val context: Context) {
    private val apiKey = BuildConfig.KAYRA_API_KEY

    private fun loadParametersFromAssets(): JSONObject {
        // Read the JSON file from the assets folder
        val jsonString = context.assets.open("llm_config/kayra_parameters.json").bufferedReader().use { it.readText() }
        return JSONObject(jsonString)
    }

    suspend fun generateResponse(prompt: String, charName: String): String = withContext(Dispatchers.IO) {
        val client = OkHttpClient()

        val url = "https://text.novelai.net/ai/generate"

        // Build the JSON body
        val json = JSONObject()

        // Set "input" to the prompt
        json.put("input", prompt)
        json.put("model", "kayra-v1")

        // Load parameters from JSON file
        val parameters = loadParametersFromAssets()

        // Add valid_first_tokens based on charName
        parameters.put("valid_first_tokens", getValidFirstTokens(charName))

        json.put("parameters", parameters)
        json.put("prefix", "string")

        val mediaType = "application/json".toMediaType()
        val requestBody = json.toString().toRequestBody(mediaType)

        val request = Request.Builder()
            .url(url)
            .addHeader("accept", "application/json")
            .addHeader("Content-Type", "application/json")
            .addHeader("Authorization", "Bearer $apiKey") // Use API key
            .post(requestBody)
            .build()

        var output = ""

        var retries = 5
        while (retries > 0) { // Try 5 times until actual valid response occurs (usually happens first time, but just in case)
            try {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Unexpected code $response")
                    val responseString = response.body?.string() ?: ""
                    val responseJson = JSONObject(responseString)
                    output = responseJson.optString("output", "")
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            output = sanitizeResult(output)
            if (output.isNotEmpty()) break
            retries--
        }
        if (output.isEmpty()) {
            output = "[Error: Kayra Generation has Failed.]"
        }
        return@withContext output
    }

    private fun sanitizeResult(input: String): String { // Clean result
        // Normalize input to remove extra spaces and replace literal \n with actual newlines
        val normalizedInput = input.trim().replace("\\n", "\n")
        Log.d("getTextAfterColon", "Normalized Input: [$normalizedInput]")

        // Split by newline first
        val firstLine = normalizedInput.split("\n").firstOrNull() ?: return "[ERROR: Input is empty]"
        Log.d("getTextAfterColon", "First Line: [$firstLine]")

        // Split by colon
        val parts = firstLine.split(":", limit = 2)

        // If there is text after the colon, process further
        if (parts.size > 1) {
            // Get the text after the colon and trim it
            val text = parts[1].trim()

            // Split the text into sentences based on punctuation
            val sentences = text.split(Regex("(?<=[.!?。！？])\\s+"))

            // Remove the last sentence if it's incomplete (does not end with punctuation)
            val validSentences = sentences.filter { it.matches(Regex(".*[.!?。！？]$")) }

            // Join the valid sentences back into a single string
            return validSentences.joinToString(" ").trim()
        }

        return "" // Error for no colon found
    }

    private fun getValidFirstTokens(charName: String): JSONArray {
        // Tokenized versions of character names, to ensure that responses from Kayra always start with them
        return when (charName) {
            "Diiaphy Nakao" -> JSONArray(
                listOf(
                    49281,  5858,   599,
                    4936,   499,  6574,
                    49213, 49287, 49209
                )
            )
            "Limon C. Saida" -> JSONArray(
                listOf(
                        49290, 15308,
                        412, 49230,
                        32323, 49212,
                        49287, 49209
                )
            )
            "Doko Niiruno" -> JSONArray(
                listOf(
                    49281, 16749,
                    16743,   415,
                    19216, 49287,
                    49209
                )
            )
            "Wolf Chii" -> JSONArray(
                listOf(
                    46971, 718, 5858, 49287, 49209
                )
            )
            else -> JSONArray() // Default empty array for characters without specified valid_first_tokens
        }
    }
}
