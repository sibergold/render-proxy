import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 10000;

// CORS configuration - Allow requests from your Netlify domain
app.use(cors({
    origin: [
        'https://parachutegame.netlify.app',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://localhost:5173', // Vite dev server
        'http://127.0.0.1:5173'  // Vite dev server
    ],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    optionsSuccessStatus: 200
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const CLIENT_ID = process.env.KICK_CLIENT_ID || process.env.CENTRAL_CLIENT_ID;
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || process.env.CENTRAL_CLIENT_SECRET;

// Validation function
function isConfigValid() {
    return CLIENT_ID && CLIENT_SECRET;
}

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
        
        console.log('OAuth exchange request:', { 
            code: !!code, 
            redirect_uri, 
            code_verifier: !!code_verifier 
        });
        
        if (!code || !redirect_uri || !code_verifier) {
            return res.status(400).json({ 
                error: 'Missing required parameters: code, redirect_uri, code_verifier' 
            });
        }

        if (!isConfigValid()) {
            console.error('❌ Missing CLIENT_ID or CLIENT_SECRET');
            return res.status(500).json({ 
                error: 'Server configuration error - missing credentials' 
            });
        }

        // Exchange code for token using Kick's OAuth endpoint
        const tokenResponse = await fetch('https://id.kick.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
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
        console.log('✅ Token exchange successful');

        // Return only necessary token data
        res.json({
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in
        });

    } catch (error) {
        console.error('❌ OAuth exchange error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/get-kick-user', async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });

    try {
        const response = await fetch('https://kick.com/api/v1/user', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            return res.status(500).json({ error: 'Non-JSON response', details: text });
        }
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        client_id_configured: !!CLIENT_ID,
        client_secret_configured: !!CLIENT_SECRET,
        config_valid: isConfigValid(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT
    });
});

// Test endpoint for CORS
app.get('/test', (req, res) => {
    res.json({
        message: 'CORS test successful',
        timestamp: new Date().toISOString(),
        origin: req.headers.origin || 'no-origin',
        userAgent: req.headers['user-agent'] || 'no-user-agent'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Drop Game OAuth Proxy Server',
        status: 'running',
        endpoints: {
            health: '/health',
            test: '/test',
            oauth_exchange: '/oauth/exchange',
            emote_proxy: '/proxy/emote/:emoteId'
        },
        config_valid: isConfigValid()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 OAuth Proxy Server running on port ${PORT}`);
    console.log('📋 Configuration:');
    console.log('   Client ID configured:', !!CLIENT_ID);
    console.log('   Client Secret configured:', !!CLIENT_SECRET);
    console.log('   Config valid:', isConfigValid());
    console.log('   Environment:', process.env.NODE_ENV || 'development');

    if (!CLIENT_SECRET) {
        console.warn('⚠️  CENTRAL_CLIENT_SECRET environment variable not set!');
        console.warn('   This is required for OAuth to work properly.');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Process terminated');
    });
});

export default app;
