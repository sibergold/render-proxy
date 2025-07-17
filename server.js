import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { SERVER_OAUTH_CONFIG, isServerConfigValid } from './server-config.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001','https://render-proxy-production-9134.up.railway.app','https://parachutegame.netlify.app','https://id.kick.com'],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    optionsSuccessStatus: 200
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS proxy endpoint for Kick emotes
app.get('/proxy/emote/:emoteId', async (req, res) => {
    try {
        const { emoteId } = req.params;
        const emoteUrl = `https://files.kick.com/emotes/${emoteId}/fullsize`;

        console.log(`🎭 Proxying Kick emote: ${emoteId} from ${emoteUrl}`);

        const response = await fetch(emoteUrl);

        if (!response.ok) {
            console.error(`❌ Failed to fetch emote ${emoteId}: ${response.status}`);
            return res.status(response.status).json({ error: 'Failed to fetch emote' });
        }

        // Get the content type from the original response
        const contentType = response.headers.get('content-type') || 'image/gif';

        // Set appropriate headers
        res.set({
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        });

        // Stream the image data
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

        console.log(`✅ Successfully proxied emote ${emoteId}`);
    } catch (error) {
        console.error(`❌ Error proxying emote:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// OAuth proxy endpoint
app.post('/oauth/exchange', async (req, res) => {
    try {
        const { code, redirect_uri, code_verifier } = req.body;
        
        console.log('OAuth exchange request:', { code, redirect_uri, code_verifier: !!code_verifier });
        
        if (!code || !redirect_uri || !code_verifier) {
            return res.status(400).json({ 
                error: 'Missing required parameters: code, redirect_uri, code_verifier' 
            });
        }

        // Exchange code for token using Kick's OAuth endpoint
        const tokenResponse = await fetch(SERVER_OAUTH_CONFIG.OAUTH_SETTINGS.token_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: SERVER_OAUTH_CONFIG.CLIENT_ID,
                client_secret: SERVER_OAUTH_CONFIG.CLIENT_SECRET,
                code: code,
                redirect_uri: redirect_uri,
                code_verifier: code_verifier
            })
        });

        console.log('Kick token response status:', tokenResponse.status);
        
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('Kick token error:', errorText);
            return res.status(tokenResponse.status).json({ 
                error: 'Token exchange failed',
                details: errorText 
            });
        }

        const tokenData = await tokenResponse.json();
        console.log('Token exchange successful');
        
        // Return only the access token (don't expose refresh token to client)
        res.json({
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            scope: tokenData.scope
        });

    } catch (error) {
        console.error('OAuth proxy error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get Kick user info endpoint
app.post('/get-kick-user', async (req, res) => {
    try {
        const { access_token } = req.body;
        
        console.log('Get user info request:', { access_token: !!access_token });
        
        if (!access_token) {
            return res.status(400).json({ 
                error: 'Missing required parameter: access_token' 
            });
        }

        // Try multiple API endpoints as Kick API structure might vary
        const endpoints = [
            'https://api.kick.com/public/v1/users', // New official API
            `${SERVER_OAUTH_CONFIG.OAUTH_SETTINGS.api_base}/user`,
            'https://kick.com/api/v1/user',
            'https://kick.com/api/v2/user/me',
            'https://kick.com/api/v1/user/me'
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                console.log('Trying API endpoint:', endpoint);

                const response = await fetch(endpoint, {
                    headers: {
                        'Authorization': `Bearer ${access_token}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                console.log(`API response status for ${endpoint}:`, response.status);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`API error response from ${endpoint}:`, errorText);
                    lastError = new Error(`API request failed: ${response.status} - ${errorText}`);
                    continue; // Try next endpoint
                }

                // Check if response is actually JSON
                const contentType = response.headers.get('content-type');
                console.log('Response content-type:', contentType);

                if (!contentType || !contentType.includes('application/json')) {
                    const responseText = await response.text();
                    console.error(`Non-JSON response from ${endpoint}:`, responseText.substring(0, 200));
                    lastError = new Error(`Expected JSON response but got: ${contentType}`);
                    continue; // Try next endpoint
                }

                const userData = await response.json();
                console.log('User data received from', endpoint, ':', userData);

                // Handle new API format vs old API format
                if (endpoint.includes('api.kick.com/public/v1/users')) {
                    // New API returns data in array format
                    if (userData.data && Array.isArray(userData.data) && userData.data.length > 0) {
                        const user = userData.data[0];
                        console.log('🔄 Getting chatroom ID for user:', user.name);

                        // Get chatroom ID from old API
                        let chatroomId = null;
                        try {
                            const channelResponse = await fetch(`https://kick.com/api/v1/channels/${user.name}`, {
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json'
                                }
                            });

                            if (channelResponse.ok) {
                                const channelData = await channelResponse.json();
                                chatroomId = channelData.chatroom?.id;
                                console.log('Chatroom ID found:', chatroomId);
                            }
                        } catch (error) {
                            console.warn('Could not get chatroom ID:', error);
                        }

                        // Convert to old format for compatibility
                        const result = {
                            id: user.user_id,
                            username: user.name,
                            email: user.email,
                            profile_picture: user.profile_picture,
                            chatroom: { id: chatroomId }
                        };
                        
                        return res.json(result);
                    }
                }

                // Return userData as-is for other endpoints
                return res.json(userData);

            } catch (error) {
                console.error(`Error with endpoint ${endpoint}:`, error);
                lastError = error;
                continue; // Try next endpoint
            }
        }

        // If we get here, all endpoints failed
        throw lastError || new Error('All API endpoints failed');

    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});


app.get('/test-cors', (req, res) => {
    res.json({
        message: 'CORS test successful!',
        origin: req.headers.origin || 'No origin header',
        timestamp: new Date().toISOString(),
        headers: {
            'user-agent': req.headers['user-agent'],
            'referer': req.headers.referer || 'No referer',
            'host': req.headers.host
        }
    });
});

app.options('/test-cors', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        client_id_configured: !!SERVER_OAUTH_CONFIG.CLIENT_ID,
        client_secret_configured: !!SERVER_OAUTH_CONFIG.CLIENT_SECRET,
        config_valid: isServerConfigValid()
    });
});
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        client_id_configured: !!SERVER_OAUTH_CONFIG.CLIENT_ID,
        client_secret_configured: !!SERVER_OAUTH_CONFIG.CLIENT_SECRET,
        config_valid: isServerConfigValid()
    });
});




app.listen(PORT, () => {
    console.log(`OAuth Proxy Server running on ${PORT}`);
    

    if (!SERVER_OAUTH_CONFIG.CLIENT_SECRET) {
        console.warn('⚠️  KICK_CLIENT_SECRET environment variable not set!');
        console.warn('   Set it with: export KICK_CLIENT_SECRET=your_client_secret');
    }
});

export default app;
