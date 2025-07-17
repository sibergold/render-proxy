import dotenv from 'dotenv';
dotenv.config();

export const SERVER_OAUTH_CONFIG = {
    CLIENT_ID: process.env.KICK_CLIENT_ID || process.env.VITE_CENTRAL_CLIENT_ID || '01JZWNP6AVSWRZSN7X648B1AQ2',
    CLIENT_SECRET: process.env.KICK_CLIENT_SECRET || '',
    
    OAUTH_SETTINGS: {
        authorize_url: process.env.KICK_OAUTH_BASE_URL || 'https://id.kick.com/oauth/authorize',
        token_url: process.env.KICK_TOKEN_URL || 'https://id.kick.com/oauth/token',
        api_base: process.env.KICK_API_BASE_URL || 'https://kick.com/api/v2'
    }
};

export function isServerConfigValid() {
    return SERVER_OAUTH_CONFIG.CLIENT_ID !== '' && 
           SERVER_OAUTH_CONFIG.CLIENT_SECRET !== '';
}