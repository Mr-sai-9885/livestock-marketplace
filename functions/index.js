// backend/index.js

const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });

// Configuration variables
let OPENROUTER_API_KEY;
try {
    const config = functions.config();
    if (config && config.openrouter && config.openrouter.key) {
        OPENROUTER_API_KEY = config.openrouter.key;
    } else {
        console.warn("OpenRouter API key configuration is missing. Function will fail runtime calls.");
    }
} catch (e) {
    console.error("Failed to read Firebase config:", e);
}

// You can swap this with any model supported by OpenRouter (e.g., google/gemini-2.0-flash-exp)
const OPENROUTER_MODEL = "google/gemini-2.0-flash-exp";

exports.getAIPrediction = functions.https.onRequest((req, res) => {
    // CORS wrapper handles browser preflight requests and adds headers automatically
    cors(req, res, async () => {
        if (!OPENROUTER_API_KEY) {
            console.error("AI Service key is not initialized. Check Firebase function configuration.");
            return res.status(500).json({ error: "Server configuration error. AI service is unavailable." });
        }

        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method Not Allowed. Please use POST." });
        }

        try {
            const { base64Image, weight } = req.body;

            if (!base64Image || !weight) {
                return res.status(400).json({ error: "Missing 'base64Image' or 'weight' in the request body." });
            }

            // Extract just the raw base64 data and mime type for the Data URI structure
            const match = base64Image.match(/^data:(image\/\w+);base64,/);
            const mimeType = match ? match[1] : "image/jpeg";
            const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

            const systemInstruction = `You are a specialized AI for a livestock marketplace app in India. Your ONLY function is to analyze images of real, physical livestock animals. First, validate the image. If it is NOT a photograph of a real livestock animal (e.g., a cartoon, a human, an object), you MUST respond with the 'error' JSON format. If the image is valid, you MUST respond with the 'appraisal' JSON format, predicting the price in Indian Rupees (₹).`;
            const prompt = `Animal Weight: ${weight} kg. Validate this image. If it's a real livestock animal, identify its breed, assess its health, and predict a fair market price in INR.`;

            // Setup vision payload structured for OpenRouter
            const requestBody = {
                model: OPENROUTER_MODEL,
                messages: [
                    {
                        role: "system",
                        content: systemInstruction
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: prompt
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Data}`
                                }
                            }
                        ]
                    }
                ],
                response_format: { type: "json_object" }, // Enforce JSON response from the model
                temperature: 0.3
            };

            // Call OpenRouter API endpoint
            const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://firebase.google.com", // Optional metadata for dashboard tracking
                    "X-Title": "Livestock Market Firebase App"
                },
                body: JSON.stringify(requestBody)
            });

            if (!openRouterResponse.ok) {
                const errorData = await openRouterResponse.json();
                console.error("OpenRouter API error:", errorData);
                return res.status(openRouterResponse.status).json({ error: "AI appraisal service failed." });
            }

            const dataResponse = await openRouterResponse.json();
            const textResponse = dataResponse.choices?.[0]?.message?.content || "{}";

            let responseJson;
            try {
                responseJson = JSON.parse(textResponse);
            } catch (parseError) {
                console.error("Failed to parse OpenRouter text response string:", textResponse);
                return res.status(500).json({ error: "AI returned invalid JSON format structure." });
            }

            // Since schemas are handled explicitly via instructions, map the expected keys smoothly
            if (responseJson.error || responseJson.is_valid === false) {
                return res.status(400).json({ error: responseJson.message || responseJson.reason || "Invalid livestock image uploaded." });
            }

            return res.status(200).json(responseJson);

        } catch (error) {
            console.error("Error executing getAIPrediction:", error);
            return res.status(500).json({ error: "An internal server error occurred." });
        }
    });
});