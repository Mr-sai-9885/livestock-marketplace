// ==========================================
// Complete server.js - Single File Backend (OpenRouter)
// ==========================================

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'livestock-market-secret-key-2024';
const APP_SCRIPT_URL = process.env.GOOGLE_APP_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbyjEOKTU0d3qRi8qtgv7YGePavXzZspDhfTyjPgbtw1Feof8PcetCEQt56GPtbFBVII/exec";

// OpenRouter Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'YOUR_OPENROUTER_API_KEY_HERE';
// You can use 'google/gemini-2.0-flash-exp', 'meta-llama/llama-3.2-11b-vision-instruct', etc.
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp'; 

// Google Sheets Helper Functions
const callGoogleSheets = async (action, data = {}) => {
    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...data })
        });

        if (!response.ok) {
            throw new Error(`Google Sheets API failed with status ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Google Sheets API Error:', error);
        throw error;
    }
};

// Auth Middleware
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Session expired. Please login again.' 
            });
        }
        res.status(401).json({ 
            success: false, 
            message: 'Invalid authentication token' 
        });
    }
};

// ==========================================
// AUTH ROUTES
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, userType, profileName } = req.body;

        if (!email || !password || !userType) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email, password, and user type are required' 
            });
        }

        const result = await callGoogleSheets('getUser', { email: email.toLowerCase() });
        if (result.user) {
            return res.status(400).json({ 
                success: false, 
                message: 'User with this email already exists' 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userData = {
            id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            email: email.toLowerCase(),
            password: hashedPassword,
            userType,
            profileName: profileName || `${userType} ${Math.floor(Math.random() * 10000)}`,
            isPremium: userType === 'Farmer',
            profileImage: `https://i.pravatar.cc/150?u=${email}`,
            phone: '',
            isActive: true,
            lastLogin: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        await callGoogleSheets('saveUser', { user: userData });

        const token = jwt.sign(
            { 
                userId: userData.id, 
                email: userData.email, 
                userType: userData.userType 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const { password: _, ...userWithoutPassword } = userData;

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Registration failed', 
            error: error.message 
        });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        const result = await callGoogleSheets('getUser', { email: email.toLowerCase() });
        const user = result.user;

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        user.lastLogin = new Date().toISOString();
        await callGoogleSheets('saveUser', { user });

        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                userType: user.userType 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const { password: _, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Login failed', 
            error: error.message 
        });
    }
});

// Google Login/Register
app.post('/api/auth/google', async (req, res) => {
    try {
        const { email, name, picture, googleId } = req.body;

        if (!email || !googleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Google authentication data is required' 
            });
        }

        const result = await callGoogleSheets('getUser', { email: email.toLowerCase() });
        let user = result.user;

        if (!user) {
            user = {
                id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                email: email.toLowerCase(),
                password: await bcrypt.hash(googleId, 10),
                userType: 'Buyer',
                profileName: name || email.split('@')[0],
                isPremium: false,
                profileImage: picture || `https://i.pravatar.cc/150?u=${email}`,
                phone: '',
                googleId: googleId,
                isActive: true,
                lastLogin: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            await callGoogleSheets('saveUser', { user });
        } else {
            user.lastLogin = new Date().toISOString();
            user.profileImage = picture || user.profileImage;
            user.profileName = name || user.profileName;
            user.googleId = googleId;
            await callGoogleSheets('saveUser', { user });
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                userType: user.userType 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const { password: _, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Google authentication successful',
            token,
            user: userWithoutPassword,
            isNewUser: !result.user
        });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Google authentication failed', 
            error: error.message 
        });
    }
});

// Get Profile
app.get('/api/auth/profile', authMiddleware, async (req, res) => {
    try {
        const result = await callGoogleSheets('getUser', { email: req.user.email });
        const user = result.user;

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const { password: _, ...userWithoutPassword } = user;

        res.json({ 
            success: true, 
            user: userWithoutPassword 
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch profile', 
            error: error.message 
        });
    }
});

// Update Profile
app.put('/api/auth/profile', authMiddleware, async (req, res) => {
    try {
        const { profileName, phone, userType } = req.body;

        const result = await callGoogleSheets('getUser', { email: req.user.email });
        const user = result.user;

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        if (profileName) user.profileName = profileName;
        if (phone) user.phone = phone;
        if (userType) {
            user.userType = userType;
            user.isPremium = userType === 'Farmer';
        }

        await callGoogleSheets('saveUser', { user });

        const { password: _, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update profile', 
            error: error.message 
        });
    }
});

// ==========================================
// AI ROUTES (OPENROUTER INTEGRATION)
// ==========================================

app.post('/api/ai/predict-price', async (req, res) => {
    try {
        const { base64Image, weight } = req.body;

        console.log('🔍 Received OpenRouter prediction request:', {
            hasImage: !!base64Image,
            weight,
            timestamp: new Date().toISOString()
        });

        if (!base64Image || !weight) {
            return res.status(400).json({ 
                success: false, 
                message: 'Image and weight are required' 
            });
        }

        if (isNaN(weight) || weight <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid weight value. Must be a positive number.' 
            });
        }

        // Clean up base64 extraction safely
        const splitImage = base64Image.split(',');
        const base64Data = splitImage[1] || splitImage[0];
        const header = splitImage[0];
        const mimeType = header?.match(/:(.*?);/)?.[1] || 'image/jpeg';

        if (!mimeType.startsWith('image/')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid image format. Only image files are allowed.' 
            });
        }

        if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('YOUR_OPENROUTER_API_KEY')) {
            return res.status(500).json({ 
                success: false, 
                message: 'OpenRouter AI service not configured. Please set OPENROUTER_API_KEY.' 
            });
        }

        // Prompt definition explicitly instructing direct JSON schema adherence
        const promptText = `You are an expert livestock appraiser for the Indian market. Analyze this image carefully.

CRITICAL VALIDATION:
1. Verify this is a REAL livestock animal photo (cattle, buffalo, goat, sheep, pig, poultry, horse, etc.)
2. REJECT: cartoons, toys, humans, wild animals, pets, fake/artificial images
3. ACCEPT: Only clear photos of genuine farm/livestock animals

Animal Weight: ${weight} kg

You MUST respond strictly in the following JSON format. Do not wrap the JSON in markdown blocks (like \`\`\`json), do not include any explanatory introductory or closing text. Return ONLY raw JSON text.

If valid livestock:
{
  "is_valid": true,
  "predicted_price": 45000,
  "animal_breed": "Breed name here",
  "justification": "2-3 sentences about breed, health, and value matching current trends.",
  "confidence": 90,
  "market_demand": "High"
}

If invalid image:
{
  "is_valid": false,
  "reason": "Clear explanation showing why it was rejected (e.g., cartoon, human, pet, etc.)"
}

PRICING EXPECTATIONS (Indian Context):
- Cattle: ₹30,000-₹150,000
- Buffalo: ₹40,000-₹200,000
- Goat: ₹8,000-₹40,000
- Sheep: ₹6,000-₹30,000
- Pig: ₹10,000-₹50,000
- Poultry: ₹200-₹2,000`;

        // Standardised OpenRouter multimodal schema mapping structure
        const requestBody = {
            model: OPENROUTER_MODEL,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: promptText
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
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1000,
        };

        console.log(`🤖 Requesting OpenRouter Model: ${OPENROUTER_MODEL}...`);

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY.trim()}`,
                'HTTP-Referer': 'https://livestock-marketplace-8jeh.onrender.com',
                'X-Title': 'Livestock Market App'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ OpenRouter API internal rejection error:', errorData);
            throw new Error(errorData.error?.message || `OpenRouter upstream failed with status ${response.status}`);
        }

        const dataResponse = await response.json();
        let textResponse = dataResponse.choices?.[0]?.message?.content || '{}';

        // Strip any residual markdown formatting strings safely if returned
        textResponse = textResponse.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

        let jsonResponse;
        try {
            jsonResponse = JSON.parse(textResponse);
        } catch (parseError) {
            console.error('❌ Failed to parse raw text response string:', textResponse);
            return res.status(500).json({
                success: false,
                message: 'AI returned invalid structured content format. Please try again.'
            });
        }

        if (jsonResponse.is_valid === false || jsonResponse.error) {
            return res.status(400).json({
                success: false,
                isValid: false,
                message: jsonResponse.reason || jsonResponse.message || 'This does not appear to be a real livestock animal.',
                hint: 'Please upload a clear photo of an actual farm animal.'
            });
        }

        const prediction = {
            predicted_price: Math.round(jsonResponse.predicted_price || 30000),
            animal_breed: jsonResponse.animal_breed || "Unknown Breed",
            justification: jsonResponse.justification || "Price estimated based on visual assessment.",
            confidence: Math.min(Math.max(jsonResponse.confidence || 85, 70), 100),
            market_demand: jsonResponse.market_demand || "Medium"
        };

        res.json({
            success: true,
            isValid: true,
            prediction,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ OpenRouter AI Prediction runtime error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'AI processing failed via OpenRouter.', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Service temporarily unavailable'
        });
    }
});

// ==========================================
// LISTING ROUTES
// ==========================================

// Create Listing
app.post('/api/listings', authMiddleware, async (req, res) => {
    try {
        const {
            itemName, breed, category, weight, health, description,
            predictedPrice, finalPrice, aiExplanation, aiConfidence,
            marketDemand, fileName
        } = req.body;

        if (!itemName || !breed || !weight || !predictedPrice || !finalPrice) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields' 
            });
        }

        const result = await callGoogleSheets('getUser', { email: req.user.email });
        const user = result.user;

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const listingData = {
            id: `listing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            farmer_id: user.id,
            farmer_name: user.profileName,
            farmer_email: user.email,
            item_name: itemName,
            breed: breed,
            category: category || 'Cattle',
            weight: Number(weight),
            health: health || 'Healthy',
            notes: description || '',
            predicted_price: Number(predictedPrice),
            final_price: Number(finalPrice),
            explanation: aiExplanation || '',
            ai_confidence: aiConfidence ? Number(aiConfidence) : null,
            market_demand: marketDemand || 'Medium',
            file_name: fileName || '',
            status: 'active',
            views: 0,
            timestamp: new Date().toISOString()
        };

        await callGoogleSheets('append', { record: listingData });

        res.status(201).json({
            success: true,
            message: 'Listing created successfully',
            listing: {
                id: listingData.id,
                itemName: listingData.item_name,
                breed: listingData.breed,
                finalPrice: listingData.final_price,
                createdAt: listingData.timestamp
            }
        });
    } catch (error) {
        console.error('Create listing error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create listing', 
            error: error.message 
        });
    }
});

// Get All Listings
app.get('/api/listings', async (req, res) => {
    try {
        const { category, status, search, limit = 20 } = req.query;

        const result = await callGoogleSheets('getRecords', { limit: Number(limit) });
        let listings = result.records || [];

        listings = listings.filter(listing => {
            if (status && listing.status !== status) return false;
            if (!status && listing.status !== 'active') return false;
            if (category && category !== 'all' && listing.category !== category) return false;
            
            if (search && search.trim()) {
                const searchLower = search.toLowerCase();
                const searchFields = [
                    listing.item_name,
                    listing.breed,
                    listing.notes,
                    listing.farmer_name
                ].map(field => (field || '').toLowerCase());
                
                if (!searchFields.some(field => field.includes(searchLower))) {
                    return false;
                }
            }
            return true;
        });

        listings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({
            success: true,
            listings: listings.map(listing => ({
                id: listing.id,
                farmerId: listing.farmer_id,
                farmerName: listing.farmer_name,
                itemName: listing.item_name,
                breed: listing.breed,
                category: listing.category,
                weight: listing.weight,
                finalPrice: listing.final_price,
                status: listing.status,
                createdAt: listing.timestamp
            })),
            total: listings.length
        });
    } catch (error) {
        console.error('Get listings error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch listings', 
            error: error.message 
        });
    }
});

// Get My Listings
app.get('/api/listings/my-listings', authMiddleware, async (req, res) => {
    try {
        const result = await callGoogleSheets('getRecords', { 
            email: req.user.email,
            limit: 100 
        });
        
        let listings = result.records || [];
        listings = listings.filter(l => l.farmer_email === req.user.email);
        listings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({
            success: true,
            listings: listings.map(listing => ({
                id: listing.id,
                itemName: listing.item_name,
                breed: listing.breed,
                weight: listing.weight,
                finalPrice: listing.final_price,
                status: listing.status,
                views: listing.views || 0,
                createdAt: listing.timestamp
            })),
            total: listings.length
        });
    } catch (error) {
        console.error('Get my listings error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch your listings', 
            error: error.message 
        });
    }
});

app.get('/', (req, res) => {
    res.send('Welcome to the Livestock Market Backend API Server! Use /health to check status.');
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Livestock Market API Running',
        googleSheets: APP_SCRIPT_URL ? 'Connected' : 'Not Configured',
        openRouterAI: OPENROUTER_API_KEY && !OPENROUTER_API_KEY.includes('YOUR_OPENROUTER') ? 'Configured' : 'Not Configured',
        activeModel: OPENROUTER_MODEL,
        timestamp: new Date().toISOString()
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Internal Server Error', 
        error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Livestock Market Backend Server`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log(`📄 Google Sheets: ${APP_SCRIPT_URL ? '✅ Connected' : '❌ Not Configured'}`);
    console.log(`🤖 OpenRouter: ${OPENROUTER_API_KEY && !OPENROUTER_API_KEY.includes('YOUR_OPENROUTER') ? '✅ Configured' : '❌ Not Configured'}`);
    console.log(`🔮 AI Model: ${OPENROUTER_MODEL}`);
    console.log(`\n⏰ Started at: ${new Date().toLocaleString()}\n`);
});