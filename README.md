<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0e98dc47-4c39-44d6-b7a4-885bde9ec2de

## Run Locally

**Prerequisites:**  Node.js (v18 or higher recommended)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```env
   # Cognito Configuration (required for authentication)
   VITE_COGNITO_USER_POOL_ID=your_user_pool_id
   VITE_COGNITO_CLIENT_ID=your_client_id
   VITE_COGNITO_REGION=us-east-1
   VITE_COGNITO_DOMAIN=your-cognito-domain
   
   # Gemini API Key (required for AI analysis)
   GEMINI_API_KEY=your_gemini_api_key
   ```
   
   **Note**: See [COGNITO_SETUP.md](COGNITO_SETUP.md) for detailed instructions on configuring Cognito Hosted UI.

3. Run the app:
   ```bash
   npm run dev
   ```

4. Open your browser at `http://localhost:3000`
