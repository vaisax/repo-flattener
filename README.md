# Repo Flattener

A sleek web app that flattens GitHub repositories into a single HTML page, with Human and LLM views, a dark theme, and a premium UI featuring animated icons and a starry background.

## Features
- **Input a GitHub Repo URL**: Enter a public repo URL to process its contents.
- **Human View**: Displays repo files with syntax highlighting (via highlight.js) and Markdown rendering (via marked).
- **LLM View**: Generates CXML-formatted text for easy copying to large language models.
- **Dark Mode**: Always-on dark theme with a subtle starry background animation, inspired by xAI's Grok.
- **Animated UI**: Minimal, elegant animations for view toggles (Human/LLM) using SVG icons.
- **File Filtering**: Skips binary files, large files (>50KB), and `.git` directories.

## Prerequisites
- Node.js (v16 or higher)
- npm
- A public GitHub repository URL for testing

## Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/repo-flattener.git
   cd repo-flattener
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run locally:
   ```bash
   node app.js
   ```
4. Open `http://localhost:3000` in your browser, enter a GitHub repo URL (e.g., `https://github.com/axios/axios`), and submit.

## Visit the provided URL (e.g., `https://repo-flattener.vercel.app`).

## Usage
- Enter a public GitHub repo URL (e.g., `https://github.com/<owner>/<repo>`).
- Toggle between **Human View** (rendered files with syntax highlighting) and **LLM View** (CXML format for LLMs) using the animated icons.
- Navigate via the sidebar or table of contents.

## Notes
- Large repos may timeout on Vercel’s free tier due to serverless limits (~10-30s). Use small repos for testing.
- Private repos require GitHub API authentication (not implemented).
- Default branch assumed to be `main`; adjust `zipUrl` in `app.js` if `master`.

## License
MIT License - see [LICENSE](LICENSE) for details.
