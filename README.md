# Profile companion

A small Python chatbot with a local web interface, powered by Gemini. Its only knowledge source is [`data/profile.md`](data/profile.md), converted from the supplied PDF.

## Run

Use Python 3.11 or newer. Clone the repository and install the dependencies:

```bash
git clone https://github.com/arthi-rajendran24/chatbot-arthi-r.git
cd chatbot-arthi-r
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
```

Copy `.env.example` only when creating a new `.env`; keep an existing key file.

1. Open `.env`, paste your key after `GEMINI_API_KEY=`, and save it:

   ```dotenv
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```

2. Start the app from this folder:

   ```bash
   ./run.sh
   ```

3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

If the app is already running, use **Refresh status** after saving the key. No restart is needed. A configured key means one was supplied; the first successful question confirms Gemini access. Stop the server with `Ctrl+C` in its terminal.

If port 8000 is in use, choose another local port:

```bash
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

## Ask questions

Examples:

- What skills are listed in the profile?
- Where did Arthi study, and what degrees are listed?
- What roles did Arthi hold at Pfizer?
- What does the profile say about The Arthi AI Collective?

Ask each question in full. Earlier chat turns are displayed for convenience but aren't sent to Gemini or used as a second knowledge source.

Answers contain exact source passages with citations. Click a source to see its section and highlighted Markdown lines. Missing information produces: **“I couldn't find that information in the profile.”** A service failure appears as an error, rather than pretending information was absent.

## How grounding works

1. Python reads the complete Markdown profile and assigns IDs to its headings and text passages.
2. Gemini receives the profile and the current question, and selects relevant passage IDs using structured JSON. Web search and other tools are disabled.
3. Python validates the IDs, then builds the answer from the original stored passages. Model-written facts are never displayed. Invalid IDs fail closed.
4. Every citation includes the section, filename, and exact line range. A version fingerprint detects if the profile changes before a citation is opened.

This prevents the model from inventing factual answer text. Gemini still judges relevance and whether the profile answers a question, so it can select an irrelevant passage or miss a relevant one. Citations make that decision inspectable. Dates and “Present” are quoted as written in the PDF; they are not independently updated or verified. The chatbot does not calculate, translate, or infer missing facts.

## Change the profile or model

Edit `data/profile.md` to replace or correct the source. Use Markdown headings to organize it. Changes are loaded on the next request; no indexing or embeddings are needed for this small document. The app rejects empty, unreadable, or oversized profiles (over 100 KB), rather than silently cutting off content.

Set `GEMINI_MODEL` in `.env` to another text model available to your Gemini account. The default is taken from Google's [current model documentation](https://ai.google.dev/gemini-api/docs/models). The backend uses the official [Google Gen AI Python SDK](https://github.com/googleapis/python-genai) and its structured-output support.

## Local data and keys

The key stays in `.env` on the Python server. It is never sent to the frontend, returned by API endpoints, or included in Git. Use `chmod 600 .env` to limit access to the file owner. Chat history is held in browser memory and disappears when you reload or start a new conversation.

Each submitted question sends the profile and question to Google's Gemini API. The app runs on `127.0.0.1`; it is intended for local use. Don't expose it publicly without adding authentication and usage controls.

## Verify

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Tests use mocked Gemini responses and temporary key files. They check source validation, citation ranges, missing-key behavior, API error handling, and request validation without making paid model calls. A live Gemini check requires your saved API key.

## Files

- `app.py`: FastAPI server, configuration, and local API.
- `profile_chat.py`: profile parsing, Gemini selection, and source validation.
- `static/`: HTML, CSS, and JavaScript frontend with no build step.
- `data/profile.md`: editable knowledge source.
- `.env`: your private key and model setting.
- `.env.example`: blank configuration template.
- `tests/`: offline verification.
