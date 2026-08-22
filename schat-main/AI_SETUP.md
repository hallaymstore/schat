# Global AI Setup (SCHAT)

## 1) Env variables (server `.env`)

Set one of these providers (recommended order):

### Option A: Gemini (recommended)
- `GEMINI_API_KEY=...`
- `GEMINI_MODEL=gemini-2.0-flash`

### Option B: Groq
- `GROQ_API_KEY=your_groq_api_key_here`
- `GROQ_MODEL=llama-3.3-70b-versatile`

### Option C: OpenRouter (free models)
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free`
- Optional: `PUBLIC_APP_URL=https://your-domain`

### Option D: Any OpenAI-compatible endpoint
- `AI_API_KEY=...`
- `AI_BASE_URL=https://your-provider/openai/v1`
- `AI_MODEL=your-model-id`

Optional controls:
- `AI_PROVIDER=auto` (default: auto; tries gemini -> groq -> openrouter -> custom)
- `AI_RATE_MAX=30` (requests per window per user)
- `AI_RATE_WINDOW_MS=600000` (10 min window)

## 2) Restart server
After setting env variables, restart Node server.

## 3) API endpoint used by global assistant
- `POST /api/assistant/ai` (auth required)

Request body:
```json
{
  "mode": "bot",
  "message": "savol matni",
  "history": [{"role":"user","content":"..."}],
  "context": {"subject":"Fizika","callActive":true,"science":true,"labType":"physics"}
}
```
